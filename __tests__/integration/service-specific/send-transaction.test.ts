/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade sendTransaction tests.
 *
 * Tests for service-only behavior: deep transaction structure validation,
 * P2SH target address, changeAddress with getUtxoFromId verification.
 *
 * Shared sendTransaction tests live in `shared/send-transaction.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { buildWalletInstance, pollForTx } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { WALLET_CONSTANTS } from '../configuration/test-constants';

const adapter = new ServiceWalletTestAdapter();

const pinCode = '123456';
const password = 'testpass';

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] sendTransaction', () => {
  let wallet: HathorWalletServiceWallet;
  let walletAddresses: string[];

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('should validate full transaction structure', async () => {
    const gWallet = GenesisWalletServiceHelper.getSingleton();
    const { addresses: recipientAddresses } = buildWalletInstance();
    const sendTransaction = await gWallet.sendTransaction(recipientAddresses[0], 10n, {
      pinCode,
    });

    expect(sendTransaction).toEqual(
      expect.objectContaining({
        hash: expect.any(String),
        inputs: expect.any(Array),
        outputs: expect.any(Array),
        version: expect.any(Number),
        weight: expect.any(Number),
        nonce: expect.any(Number),
        signalBits: expect.any(Number),
        timestamp: expect.any(Number),
        parents: expect.arrayContaining([expect.any(String)]),
        tokens: expect.any(Array),
        headers: expect.any(Array),
      })
    );

    expect(sendTransaction.hash).toHaveLength(64);
    expect(sendTransaction.inputs.length).toBeGreaterThan(0);
    expect(sendTransaction.outputs.length).toBeGreaterThan(0);
    expect(sendTransaction.tokens).toHaveLength(0);
    expect(sendTransaction.parents).toHaveLength(2);
    expect(sendTransaction.timestamp).toBeGreaterThan(0);

    const recipientOutput = sendTransaction.outputs.find(output => output.value === 10n);
    expect(recipientOutput).toStrictEqual(expect.objectContaining({ value: 10n, tokenData: 0 }));

    await pollForTx(gWallet, sendTransaction.hash!);
  });

  it('should send a transaction to a P2SH (multisig) address', async () => {
    const gWallet = GenesisWalletServiceHelper.getSingleton();
    const p2shAddress = WALLET_CONSTANTS.multisig.addresses[0];

    const sendTransaction = await gWallet.sendTransaction(p2shAddress, 5n, { pinCode });

    expect(sendTransaction).toEqual(
      expect.objectContaining({
        hash: expect.any(String),
        inputs: expect.any(Array),
        outputs: expect.any(Array),
      })
    );

    await pollForTx(gWallet, sendTransaction.hash!);

    const fullTx = await gWallet.getFullTxById(sendTransaction.hash!);
    expect(fullTx.success).toBe(true);

    const p2shOutput = fullTx.tx.outputs.find(output => output.decoded?.address === p2shAddress);
    expect(p2shOutput).toBeDefined();
    expect(p2shOutput!.value).toBe(5n);
    expect(p2shOutput!.decoded.type).toBe('MultiSig');
  });

  it('should send a transaction with a set changeAddress', async () => {
    ({ wallet, addresses: walletAddresses } = buildWalletInstance());
    await wallet.start({ pinCode, password });

    // Fund the wallet so it has UTXOs to spend
    await GenesisWalletServiceHelper.injectFunds(walletAddresses[0], 10n, wallet);

    const sendTransaction = await wallet.sendTransaction(walletAddresses[1], 4n, {
      pinCode,
      changeAddress: walletAddresses[0],
    });

    expect(sendTransaction.outputs.length).toBe(2);

    let recipientIndex;
    let changeIndex;
    sendTransaction.outputs.forEach((output, index) => {
      if (output.value === 4n) {
        recipientIndex = index;
      } else if (output.value === 6n) {
        changeIndex = index;
      }
    });

    expect(recipientIndex).toBeDefined();
    expect(changeIndex).toBeDefined();

    await pollForTx(wallet, sendTransaction.hash!);
    const recipientUtxo = await wallet.getUtxoFromId(sendTransaction.hash!, recipientIndex);
    expect(recipientUtxo).toStrictEqual(
      expect.objectContaining({ address: walletAddresses[1], value: 4n })
    );
    const changeUtxo = await wallet.getUtxoFromId(sendTransaction.hash!, changeIndex);
    expect(changeUtxo).toStrictEqual(
      expect.objectContaining({ address: walletAddresses[0], value: 6n })
    );
  });
});
