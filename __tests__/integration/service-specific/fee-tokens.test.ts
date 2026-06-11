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
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import {
  buildWalletInstance,
  pollForTx,
  pollUntilCondition,
} from '../helpers/service-facade.helper';
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
    // A wallet that only ever received fee tokens — never any HTR — has nothing
    // to pay the per-output fee with, so the wallet-service builder rejects the
    // send. We model that state natively with a second, never-funded wallet
    // (`emptyFeeWallet`) instead of draining the creator wallet's HTR.
    await feeWallet.start({ pinCode, password });
    // feeWallet only needs HTR to mint the fee token (1n) and pay the fee to
    // forward tokens (1n); a comfortable margin keeps the test off the fee
    // boundary, since feeWallet's HTR balance is not what we assert here.
    const feeWalletFunds = 10n;
    await GenesisWalletServiceHelper.injectFunds(feeWalletAddresses[0], feeWalletFunds, feeWallet);

    const tokenAmount = 1000n;
    const createTokenTx = await feeWallet.createNewToken('NoHtrFeeToken', 'NHFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    });
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Wait for the HTR change from token creation (1n flat fee) to be re-indexed
    // before we spend it again to forward tokens — the UTXO index lags tx
    // visibility on the wallet-service, so pollForTx above is not enough.
    await pollUntilCondition(
      () =>
        feeWallet
          .getBalance(NATIVE_TOKEN_UID)
          .then(([b]) => (b?.balance.unlocked ?? 0n) === feeWalletFunds - 1n),
      'feeWallet HTR change indexed after fee-token creation'
    );

    // A fresh wallet that receives only the fee token, never any HTR.
    const { wallet: emptyFeeWallet, addresses: emptyFeeWalletAddresses } = buildWalletInstance();
    await emptyFeeWallet.start({ pinCode, password });
    try {
      // feeWallet pays the HTR fee to forward fee tokens into the empty wallet.
      const forwardAmount = 100n;
      const fundTx = await feeWallet.sendTransaction(emptyFeeWalletAddresses[0], forwardAmount, {
        token: tokenUid,
        pinCode,
      });
      await pollForTx(feeWallet, fundTx.hash!);

      // Wait for the forwarded tokens to reach emptyFeeWallet's balance index
      // (tx visibility leads the UTXO/balance index on the wallet-service, so
      // pollForTx alone is not enough — we poll the derived balance directly).
      // This proves the rejection below fails because of missing HTR, not
      // because the forwarded tokens hadn't been indexed yet.
      await pollUntilCondition(
        () =>
          emptyFeeWallet.getBalance(tokenUid).then(([b]) => b?.balance.unlocked === forwardAmount),
        'emptyFeeWallet received fee tokens'
      );

      const emptyHtrBalance = await emptyFeeWallet.getBalance(NATIVE_TOKEN_UID);
      expect(emptyHtrBalance[0]?.balance.unlocked ?? 0n).toBe(0n);

      // Sending fee tokens without HTR is rejected by the wallet-service builder.
      // feeWalletAddresses[5] is an arbitrary empty address — any external target works.
      await expect(
        emptyFeeWallet.sendTransaction(feeWalletAddresses[5], 50n, {
          token: tokenUid,
          pinCode,
        })
      ).rejects.toThrow(SendTxError);
    } finally {
      await emptyFeeWallet.stop({ cleanStorage: true });
    }
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
