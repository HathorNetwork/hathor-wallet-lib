/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Verifies that, after a real wallet `start()`, the storage's version
 * data is populated AND `transactionUtils.getWeightConstantsFromStorage`
 * resolves to the privnet's reported `(min_tx_weight,
 * min_tx_weight_coefficient, min_tx_weight_k)` rather than the
 * hardcoded {@link TX_WEIGHT_CONSTANTS} mainnet defaults.
 *
 * This is the only weight-constants assertion that genuinely exercises
 * the wallet/fullnode integration: without `start()` actually fetching
 * /version and writing it to storage, the helper would return
 * undefined and the wallet would silently fall back to the hardcoded
 * defaults — the behaviour we're protecting against. Both facades go
 * through this path: `HathorWallet.start()` (src/new/wallet.ts:1712)
 * and `HathorWalletServiceWallet.start()` (src/wallet/wallet.ts).
 *
 * Pure-unit assertions about `getWeightConstantsFromStorage` and
 * `prepareToSend` argument threading live in
 * __tests__/utils/transaction.test.ts.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import type { IStorage } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { TX_WEIGHT_CONSTANTS } from '../../../src/constants';
import transactionUtils from '../../../src/utils/transaction';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] tx weight constants — $name', adapter => {
  let wallet: FuzzyWalletType;
  let storage: IStorage;

  beforeAll(async () => {
    await adapter.suiteSetup();
    const created = await adapter.createWallet();
    wallet = created.wallet;
    storage = created.storage;
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('exposes the network constants via getWeightConstantsFromStorage', async () => {
    const versionData = await wallet.getVersionData();

    // Sanity: this test is only meaningful if the privnet's reported
    // values actually diverge from the hardcoded defaults.
    expect(versionData.minTxWeight).not.toBe(TX_WEIGHT_CONSTANTS.txMinWeight);
    expect(versionData.minTxWeightCoefficient).not.toBe(TX_WEIGHT_CONSTANTS.txWeightCoefficient);
    expect(versionData.minTxWeightK).not.toBe(TX_WEIGHT_CONSTANTS.txMinWeightK);

    const networkConstants = transactionUtils.getWeightConstantsFromStorage(storage);
    expect(networkConstants).toEqual({
      txMinWeight: versionData.minTxWeight,
      txWeightCoefficient: versionData.minTxWeightCoefficient,
      txMinWeightK: versionData.minTxWeightK,
    });
  });
});
