/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade changeServer tests.
 *
 * The fullnode facade's changeServer modifies the connection URL,
 * which allows us to verify the change by querying the new server's
 * /version endpoint via getVersionData.
 *
 * Shared changeServer tests live in `shared/server_changes.test.ts`.
 */

import HathorWallet from '../../../src/new/wallet';
import { delay } from '../utils/core.util';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { FULLNODE_NETWORK_NAME, FULLNODE_URL } from '../configuration/test-constants';

describe('[Fullnode] server changes', () => {
  let gWallet: HathorWallet;

  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  afterAll(async () => {
    await GenesisWalletHelper.clearListeners();
    await gWallet.stop();
  });

  it('should change to a different server and revert', async () => {
    const testnetUrl = 'https://node1.testnet.hathor.network/v1a/';

    // Changing from our integration test privatenet to the testnet
    await gWallet.changeServer(testnetUrl);
    const serverChangeTime = Date.now().valueOf();

    try {
      await delay(100);

      // Validating the server change with getVersionData
      const networkData = await gWallet.getVersionData();
      expect(networkData.timestamp).toBeGreaterThan(serverChangeTime);
      expect(networkData.network).toMatch(/^testnet.*/);
    } finally {
      // Always revert to the original server, even if assertions fail
      await gWallet.changeServer(FULLNODE_URL);
    }

    await delay(100);

    // Verifying the revert to the privatenet
    const networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime + 200);
    expect(networkData.network).toStrictEqual(FULLNODE_NETWORK_NAME);
  });
});
