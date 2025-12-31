/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createWalletFacadeTests } from '../shared/shared_facades_factory';
import { HathorWalletFactory, HathorWalletHelperAdapter } from '../shared/test_helpers';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';

/**
 * Shared test suite for HathorWallet (Fullnode Facade)
 *
 * This test file uses the shared facade test factory to validate that
 * HathorWallet correctly implements the common wallet contract.
 */

// Test setup
beforeAll(async () => {});

afterAll(async () => {
  await GenesisWalletHelper.clearListeners();
});

// Create the shared test suite for HathorWallet
createWalletFacadeTests(
  'HathorWallet (Fullnode)',
  new HathorWalletFactory(),
  new HathorWalletHelperAdapter(),
  {
    // HathorWallet has async address methods
    hasAsyncAddressMethods: true,

    // Feature support flags based on implementation
    supportsConsolidateUtxos: true,
    supportsNanoContracts: true,
    supportsGetAddressInfo: true,
    supportsGetTx: true,
    supportsGetFullHistory: true,
    supportsTemplateTransactions: true,
    supportsCheckAddressesMine: true,

    // No special initialization required
    requiresSpecialInit: false,
  }
);
