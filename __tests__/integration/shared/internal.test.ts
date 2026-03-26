/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { FULLNODE_NETWORK_NAME, FULLNODE_URL, NETWORK_NAME } from '../configuration/test-constants';
import Network from '../../../src/models/network';
import { loggers } from '../utils/logger.util';

// XXX: onConnectionChangedState has different behavior between facades
// (fullnode calls reloadStorage/processHistory, service emits 'reload-data').
// It needs refactoring before it can be tested here as a shared test.

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

/**
 * Minimum expected shape for getVersionData across both facades.
 * Both facades should query the fullnode /version endpoint and return
 * the same data. If a backend inconsistency is found for a specific
 * facade, adjust the corresponding adapter's `versionDataOverrides`
 * or skip individual fields here rather than duplicating the test.
 */
const baseVersionDataExpectation = {
  timestamp: expect.any(Number),
  version: expect.any(String),
  network: FULLNODE_NETWORK_NAME,
  minWeight: expect.any(Number),
  minTxWeight: expect.any(Number),
  minTxWeightCoefficient: expect.any(Number),
  minTxWeightK: expect.any(Number),
  tokenDepositPercentage: expect.any(Number),
  rewardSpendMinBlocks: expect.any(Number),
  maxNumberInputs: expect.any(Number),
  maxNumberOutputs: expect.any(Number),
};

describe.each(adapters)('[Shared] internal methods — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  describe('network query methods', () => {
    let wallet: FuzzyWalletType;

    beforeAll(async () => {
      const result = await adapter.createWallet();
      wallet = result.wallet;
    });

    afterAll(async () => {
      await adapter.stopWallet(wallet);
    });

    it('getServerUrl returns the configured fullnode URL', () => {
      expect(wallet.getServerUrl()).toBe(FULLNODE_URL);
    });

    it('getNetwork returns the correct network name', () => {
      expect(wallet.getNetwork()).toBe(NETWORK_NAME);
    });

    it('getNetworkObject returns a Network instance with correct properties', () => {
      const networkObj = wallet.getNetworkObject();
      expect(networkObj).toBeInstanceOf(Network);
      expect(networkObj.name).toBe(NETWORK_NAME);
      expect(networkObj).toMatchObject({
        versionBytes: { p2pkh: 73, p2sh: 135 },
        bitcoreNetwork: {
          name: expect.stringContaining(NETWORK_NAME),
          alias: 'test',
          pubkeyhash: 73,
          scripthash: 135,
        },
      });
    });

    it('getVersionData returns valid version info from the fullnode', async () => {
      const versionData = await wallet.getVersionData();
      expect(versionData).toMatchObject(baseVersionDataExpectation);
    });

    it('getVersionData matches data from a direct fullnode request', async () => {
      const versionData = await wallet.getVersionData();

      // The raw fullnode /version endpoint returns snake_case keys.
      // Both facades transform these to camelCase in getVersionData().
      const directResponse = await axios
        .get('version', {
          baseURL: FULLNODE_URL,
          headers: { 'Content-Type': 'application/json' },
        })
        .catch(e => {
          loggers.test!.log(`Received an error on /version: ${e}`);
          if (e.response) {
            return e.response;
          }
          return {};
        });
      expect(directResponse.status).toBe(200);

      // Map raw snake_case keys to the camelCase keys returned by the facades.
      // This allows us to verify both facades faithfully represent the fullnode.
      const rawToFacade: Record<string, string> = {
        version: 'version',
        network: 'network',
        min_weight: 'minWeight',
        min_tx_weight: 'minTxWeight',
        min_tx_weight_coefficient: 'minTxWeightCoefficient',
        min_tx_weight_k: 'minTxWeightK',
        token_deposit_percentage: 'tokenDepositPercentage',
        reward_spend_min_blocks: 'rewardSpendMinBlocks',
        max_number_inputs: 'maxNumberInputs',
        max_number_outputs: 'maxNumberOutputs',
      };

      const fullnodeData = directResponse.data;
      for (const [rawKey, facadeKey] of Object.entries(rawToFacade)) {
        expect(fullnodeData).toHaveProperty(rawKey);
        expect(versionData).toHaveProperty(facadeKey);
        expect(versionData[facadeKey]).toStrictEqual(fullnodeData[rawKey]);
      }
    });
  });
});
