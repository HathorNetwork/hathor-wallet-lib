/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade fee-token tests.
 *
 * Tests for service-only behavior: pre-selected input edge cases that exercise
 * the wallet-service's HTR change calculation, the `prepareTxData` /
 * `sendManyOutputsSendTransaction` helper pair, and the `SendTxError` path
 * when fee HTR is unavailable.
 *
 * Shared fee-token tests live in `shared/fee-tokens.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { SendTxError } from '../../../src/errors';
import transactionUtils from '../../../src/utils/transaction';
import { TokenVersion } from '../../../src/types';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { buildWalletInstance, pollForTx } from '../helpers/service-facade.helper';
import { expectFeeAmount } from '../utils/fee-headers.util';

const adapter = new ServiceWalletTestAdapter();

const pinCode = '123456';
const password = 'testpass';

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] fee tokens — pre-selected inputs', () => {
  let feeWallet: HathorWalletServiceWallet;
  let feeWalletAddresses: string[];

  beforeEach(() => {
    const built = buildWalletInstance();
    feeWallet = built.wallet;
    feeWalletAddresses = built.addresses;
  });

  afterEach(async () => {
    if (feeWallet) {
      await feeWallet.stop({ cleanStorage: true });
    }
  });

  it('should fail to send fee tokens when wallet has no HTR to pay the fee', async () => {
    await feeWallet.start({ pinCode, password });
    await GenesisWalletServiceHelper.injectFunds(feeWalletAddresses[0], 1n, feeWallet);

    // Create fee token first (1n fee).
    const tokenAmount = 1000n;
    const createTokenTx = await feeWallet.createNewToken('NoHtrFeeToken', 'NHFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    });
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Drain any remaining HTR by sending it to a known external address.
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const remainingHtr = htrBalance[0]?.balance.unlocked ?? 0n;
    if (remainingHtr > 0n) {
      const drainTx = await feeWallet.sendTransaction(
        WALLET_CONSTANTS.genesis.addresses[0],
        remainingHtr,
        { pinCode }
      );
      await pollForTx(feeWallet, drainTx.hash!);
    }

    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]?.balance.unlocked ?? 0n).toBe(0n);

    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Sending fee tokens without HTR is rejected by the wallet-service builder.
    // feeWalletAddresses[5] is an arbitrary empty address — any non-genesis target works.
    await expect(
      feeWallet.sendTransaction(feeWalletAddresses[5], 100n, {
        token: tokenUid,
        pinCode,
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should calculate correct HTR change when pre-selected inputs generate fee token change', async () => {
    // Verifies that when:
    //   1. User pre-selects inputs (fee token + HTR)
    //   2. Fee token input exceeds output (generates change)
    //   3. Fee token change increments the fee
    // ...the HTR change is correctly calculated considering the updated fee.
    await feeWallet.start({ pinCode, password });
    await GenesisWalletServiceHelper.injectFunds(feeWalletAddresses[0], 20n, feeWallet);

    // Create FBT (1n fee).
    const tokenAmount = 200n;
    const createTokenTx = await feeWallet.createNewToken('PreSelectFeeToken', 'PSFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    });
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    const htrBefore = (await feeWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Pre-select inputs: one FBT UTXO + one HTR UTXO.
    const feeTokenUtxos = await feeWallet.getUtxos({ token: tokenUid });
    const htrUtxos = await feeWallet.getUtxos({ token: NATIVE_TOKEN_UID });
    expect(feeTokenUtxos.utxos.length).toBeGreaterThan(0);
    expect(htrUtxos.utxos.length).toBeGreaterThan(0);
    const feeTokenUtxo = feeTokenUtxos.utxos[0];
    const htrUtxo = htrUtxos.utxos[0];
    // FBT input must exceed the 50n output below for change to be generated.
    expect(feeTokenUtxo.amount).toBeGreaterThan(50n);

    const inputs = [
      { txId: feeTokenUtxo.tx_id, index: feeTokenUtxo.index },
      { txId: htrUtxo.tx_id, index: htrUtxo.index },
    ];

    // External wallet to receive the outputs (so the FBT actually leaves).
    const { addresses: externalAddresses } = buildWalletInstance();

    // Outputs:
    // - 50n FBT to external (1n fee) -> generates FBT change (+1n fee = 2n total fee)
    // - 1n HTR to external
    // HTR cost: 1n output + 2n fee = 3n
    const outputs = [
      { address: externalAddresses[1], value: 50n, token: tokenUid },
      { address: externalAddresses[0], value: 1n, token: NATIVE_TOKEN_UID },
    ];

    const sendTx = await feeWallet.sendManyOutputsTransaction(outputs, {
      inputs,
      pinCode,
    });
    await pollForTx(feeWallet, sendTx.hash!);

    expectFeeAmount(sendTx.headers, 2n);

    const htrAfter = (await feeWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(htrBefore - htrAfter).toBe(3n);

    const tokenAfter = await feeWallet.getBalance(tokenUid);
    expect(tokenAfter[0].balance.unlocked).toBe(150n);
  });

  it('should calculate correct HTR change with prepareTxData when pre-selected inputs generate fee token change', async () => {
    // Same scenario as the test above, but exercises the
    // prepareTxData / sendManyOutputsSendTransaction service helpers directly.
    await feeWallet.start({ pinCode, password });
    await GenesisWalletServiceHelper.injectFunds(feeWalletAddresses[0], 20n, feeWallet);

    const htrBeforeTokenCreation = (await feeWallet.getBalance(NATIVE_TOKEN_UID))[0].balance
      .unlocked;

    const tokenAmount = 200n;
    const createTokenTx = await feeWallet.createNewToken('FeeBasedToken', 'FBT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    });
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    const htrBefore = (await feeWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(htrBeforeTokenCreation - htrBefore).toBe(1n);

    const feeTokenUtxos = await feeWallet.getUtxos({ token: tokenUid });
    expect(feeTokenUtxos.utxos.length).toBeGreaterThan(0);
    const feeTokenUtxo = feeTokenUtxos.utxos[0];
    expect(feeTokenUtxo.amount).toBe(200n);

    // Pick an HTR UTXO with at least 3n (1n output + 2n fee).
    const htrUtxos = await feeWallet.getUtxos({ token: NATIVE_TOKEN_UID });
    const htrUtxo = htrUtxos.utxos.find(utxo => utxo.amount >= 3n);
    expect(htrUtxo).toBeDefined();

    const inputs = [
      { txId: feeTokenUtxo.tx_id, index: feeTokenUtxo.index },
      { txId: htrUtxo!.tx_id, index: htrUtxo!.index },
    ];

    const { addresses: externalAddresses } = buildWalletInstance();
    const outputs = [
      { address: externalAddresses[1], value: 50n, token: tokenUid },
      { address: externalAddresses[0], value: 1n, token: NATIVE_TOKEN_UID },
    ];

    const sendTx = await feeWallet.sendManyOutputsSendTransaction(outputs, {
      inputs,
      pinCode,
    });

    // Run prepareTxData and then materialize the transaction object so we can sign + send.
    const txData = await sendTx.prepareTxData();
    sendTx.transaction = transactionUtils.createTransactionFromData(txData, feeWallet.network);

    expectFeeAmount(txData.headers!, 2n);

    await sendTx.signTx();
    const tx = await sendTx.runFromMining();
    await pollForTx(feeWallet, tx.hash!);

    expectFeeAmount(tx.headers, 2n);

    const htrAfter = (await feeWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(htrBefore - htrAfter).toBe(3n);

    const tokenAfter = await feeWallet.getBalance(tokenUid);
    expect(tokenAfter[0].balance.unlocked).toBe(150n);
  });
});
