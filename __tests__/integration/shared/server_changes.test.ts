/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared changeServer tests.
 *
 * changeServer is on IHathorWallet but has different semantics per facade:
 * - Fullnode: changes the fullnode connection URL (getServerUrl reflects it)
 * - Wallet Service: changes the wallet-service base URL in config + storage
 *   (getServerUrl still returns the fullnode URL, not the wallet-service URL)
 *
 * Because the two facades expose changeServer/getServerUrl on different
 * endpoints, the only portable assertion is that the wallet remains usable
 * after a change+revert cycle. The fullnode-specific test with getVersionData
 * validation lives in fullnode-specific/server_changes.test.ts.
 *
 * Each adapter must provide `originalServerUrl` so the test can revert
 * the change regardless of which underlying URL changeServer modifies.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] server changes — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  describe('changeServer', () => {
    let wallet: FuzzyWalletType;

    beforeAll(async () => {
      const result = await adapter.createWallet();
      wallet = result.wallet;
    });

    afterAll(async () => {
      if (wallet) {
        // Revert to the adapter's original server URL before stopping.
        // This is critical because changeServer modifies global config
        // that persists across tests.
        await wallet.changeServer(adapter.originalServerUrl);
        await adapter.stopWallet(wallet);
      }
    });

    it('should accept a new server URL without throwing', async () => {
      const newUrl = 'https://node1.testnet.hathor.network/v1a/';
      await expect(wallet.changeServer(newUrl)).resolves.toBeUndefined();
    });
  });
});
