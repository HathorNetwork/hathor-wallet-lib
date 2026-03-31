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
 * Facade-specific tests live in:
 * - `fullnode-specific/send-transaction.test.ts`
 * - `service-specific/send-transaction.test.ts`
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] sendTransaction — $name', adapter => {
  let wallet: FuzzyWalletType;
  let externalWallet: FuzzyWalletType;

  beforeAll(async () => {
    await adapter.suiteSetup();

    // Create a funded wallet
    wallet = (await adapter.createWallet()).wallet;
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
});
