/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { delay } from '../utils/core.util';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { FULLNODE_NETWORK_NAME, FULLNODE_URL } from '../configuration/test-constants';

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
      await adapter.stopWallet(wallet);
    });

    it('should change to a different server and revert', async () => {
      const testnetUrl = 'https://node1.testnet.hathor.network/v1a/';

      // Changing from our integration test privatenet to the testnet
      await wallet.changeServer(testnetUrl);
      const serverChangeTime = Date.now().valueOf();

      try {
        await delay(100);

        // Validating the server change with getVersionData
        let networkData = await wallet.getVersionData();
        expect(networkData.timestamp).toBeGreaterThan(serverChangeTime);
        expect(networkData.network).toMatch(/^testnet.*/);
      } finally {
        // Always revert to the original server, even if assertions fail
        await wallet.changeServer(FULLNODE_URL);
      }

      await delay(100);

      // Verifying the revert to the privatenet
      const networkData = await wallet.getVersionData();
      expect(networkData.timestamp).toBeGreaterThan(serverChangeTime + 200);
      expect(networkData.network).toStrictEqual(FULLNODE_NETWORK_NAME);
    });
  });
});
