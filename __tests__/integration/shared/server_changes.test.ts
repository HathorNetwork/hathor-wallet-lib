/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared changeServer tests.
 *
 * Both facades implement changeServer on IHathorWallet. Although the
 * underlying URL they modify differs (fullnode connection URL vs.
 * wallet-service base URL), getVersionData() is the universal
 * observable side-effect: it routes through whichever URL changeServer
 * modifies, returning FullNodeVersionData with a `network` field that
 * distinguishes testnet from privatenet.
 *
 * Each adapter provides:
 * - `originalServerUrl`: the URL to revert to after tests
 * - `testnetServerUrl`: a real testnet endpoint for validation
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { delay } from '../utils/core.util';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { FULLNODE_NETWORK_NAME } from '../configuration/test-constants';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] server changes — $name', adapter => {
  // Captured after suiteSetup (config initialized) but before any test
  // mutates it via changeServer. Safe to use in afterAll for revert.
  let serverUrlBeforeTests: string;

  beforeAll(async () => {
    await adapter.suiteSetup();
    serverUrlBeforeTests = adapter.originalServerUrl;
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
        await wallet.changeServer(serverUrlBeforeTests);
        await adapter.stopWallet(wallet);
      }
    });

    it('should change to a testnet server and verify via getVersionData', async () => {
      await wallet.changeServer(adapter.testnetServerUrl);

      try {
        await delay(100);

        const testnetData = await wallet.getVersionData();
        expect(testnetData.network).toMatch(/^testnet.*/);
      } finally {
        // Always revert, even if assertions fail
        await wallet.changeServer(serverUrlBeforeTests);
      }

      await delay(100);

      // Verify the revert to the privatenet
      const revertedData = await wallet.getVersionData();
      expect(revertedData.network).toStrictEqual(FULLNODE_NETWORK_NAME);
    });
  });
});
