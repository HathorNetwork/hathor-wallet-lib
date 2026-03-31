/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared getBalance() tests.
 *
 * Validates balance query behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/get-balance.test.ts`
 * - `service-specific/get-balance.test.ts`
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { getRandomInt } from '../utils/core.util';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] getBalance — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should return zero balance on an empty wallet', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const balance = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(balance).toHaveLength(1);
      expect(balance[0]).toMatchObject({
        token: { id: NATIVE_TOKEN_UID },
        balance: { unlocked: 0n, locked: 0n },
        transactions: 0,
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should reflect injected funds in balance', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const injectedValue = BigInt(getRandomInt(10, 2));
      const addr = await wallet.getAddressAtIndex(0);
      expect(addr).toBeDefined();
      await adapter.injectFunds(wallet, addr!, injectedValue);

      const balance = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(balance[0]).toMatchObject({
        balance: { unlocked: injectedValue, locked: 0n },
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
