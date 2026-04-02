/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared sendTransaction() tests.
 *
 * Validates HTR transaction sending behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 *
 * Facade-specific tests (address tracking, custom tokens, fee tokens, multisig signing)
 * live in `fullnode-specific/send-transaction.test.ts`.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { WALLET_CONSTANTS } from '../configuration/test-constants';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] sendTransaction — $name', adapter => {
  let wallet: FuzzyWalletType;
  let walletAddresses: string[];
  let externalWallet: FuzzyWalletType;

  beforeAll(async () => {
    await adapter.suiteSetup();

    // Create a funded wallet
    const created = await adapter.createWallet();
    wallet = created.wallet;
    walletAddresses = created.addresses!;
    const addr = await wallet.getAddressAtIndex(0);
    await adapter.injectFunds(wallet, addr!, 20n);

    // Create a second wallet to receive external transfers
    externalWallet = (await adapter.createWallet()).wallet;
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should not change balance for an internal transfer', async () => {
    const balanceBefore = await wallet.getBalance(NATIVE_TOKEN_UID);
    const unlockedBefore = balanceBefore[0].balance.unlocked;

    // Send within the same wallet
    const addr2 = await wallet.getAddressAtIndex(2);
    await adapter.sendTransaction(wallet, addr2!, 5n);

    const balanceAfter = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(balanceAfter[0].balance.unlocked).toEqual(unlockedBefore);
  });

  it('should decrease balance when sending to an external wallet', async () => {
    const balanceBefore = await wallet.getBalance(NATIVE_TOKEN_UID);
    const unlockedBefore = balanceBefore[0].balance.unlocked;

    // Send to external wallet
    const externalAddr = await externalWallet.getAddressAtIndex(0);
    const sendAmount = 3n;
    await adapter.sendTransaction(wallet, externalAddr!, sendAmount);

    const balanceAfter = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(balanceAfter[0].balance.unlocked).toEqual(unlockedBefore - sendAmount);
  });

  it('should validate full transaction structure', async () => {
    const externalAddr = await externalWallet.getAddressAtIndex(1);
    const { transaction: tx } = await adapter.sendTransaction(wallet, externalAddr!, 1n);

    expect(tx).toEqual(
      expect.objectContaining({
        hash: expect.any(String),
        inputs: expect.any(Array),
        outputs: expect.any(Array),
        version: expect.any(Number),
        weight: expect.any(Number),
        nonce: expect.any(Number),
        timestamp: expect.any(Number),
        parents: expect.arrayContaining([expect.any(String)]),
        tokens: expect.any(Array),
      })
    );

    expect(tx.hash).toHaveLength(64);
    expect(tx.inputs.length).toBeGreaterThan(0);
    expect(tx.outputs.length).toBeGreaterThan(0);
    expect(tx.tokens).toHaveLength(0);
    expect(tx.parents).toHaveLength(2);
    expect(tx.timestamp).toBeGreaterThan(0);

    const recipientOutput = tx.outputs.find(output => output.value === 1n);
    expect(recipientOutput).toStrictEqual(expect.objectContaining({ value: 1n, tokenData: 0 }));
  });

  it('should send a transaction to a P2SH (multisig) address', async () => {
    const p2shAddress = WALLET_CONSTANTS.multisig.addresses[0];

    const { hash, transaction: tx } = await adapter.sendTransaction(wallet, p2shAddress, 1n);

    expect(tx).toEqual(
      expect.objectContaining({
        hash: expect.any(String),
        inputs: expect.any(Array),
        outputs: expect.any(Array),
      })
    );

    const fullTx = await adapter.getFullTxById(wallet, hash);
    expect(fullTx.success).toBe(true);

    const p2shOutput = fullTx.tx.outputs.find(output => output.decoded?.address === p2shAddress);
    expect(p2shOutput).toBeDefined();
    expect(p2shOutput!.value).toBe(1n);
    expect(p2shOutput!.decoded.type).toBe('MultiSig');
  });

  it('should send a transaction with a set changeAddress', async () => {
    const recipientAddr = walletAddresses[1];
    const changeAddr = walletAddresses[0];

    const { hash, transaction: tx } = await adapter.sendTransaction(wallet, recipientAddr, 2n, {
      changeAddress: changeAddr,
    });

    expect(tx.outputs.length).toBe(2);

    const fullTx = await adapter.getFullTxById(wallet, hash);
    expect(fullTx.success).toBe(true);

    const recipientOutput = fullTx.tx.outputs.find(
      output => output.decoded?.address === recipientAddr
    );
    expect(recipientOutput).toBeDefined();
    expect(recipientOutput!.value).toBe(2n);

    const changeOutput = fullTx.tx.outputs.find(output => output.decoded?.address === changeAddr);
    expect(changeOutput).toBeDefined();
  });
});
