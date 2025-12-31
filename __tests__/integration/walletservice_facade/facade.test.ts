/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createWalletFacadeTests } from '../shared/shared_facades_factory';
import { WalletServiceWalletFactory, WalletServiceHelperAdapter } from '../shared/test_helpers';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { initializeServiceGlobalConfigs } from '../helpers/service-facade.helper';

/**
 * Shared test suite for HathorWalletServiceWallet
 *
 * This test file uses the shared facade test factory to validate that
 * HathorWalletServiceWallet correctly implements the common wallet contract.
 *
 * Note: This facade has several methods that are not implemented and will
 * throw "Not implemented" errors. The test factory respects the capability
 * flags and skips tests for unsupported features.
 */

// Test setup
beforeAll(async () => {
  initializeServiceGlobalConfigs();
});

afterAll(async () => {
  await GenesisWalletHelper.clearListeners();
});

// Create the shared test suite for WalletServiceWallet
createWalletFacadeTests(
  'HathorWalletServiceWallet',
  new WalletServiceWalletFactory(),
  new WalletServiceHelperAdapter(),
  {
    // WalletServiceWallet has sync address methods (not async)
    hasAsyncAddressMethods: false,

    // Feature support flags based on implementation
    // Most advanced features are not implemented in WalletServiceWallet
    supportsConsolidateUtxos: false,
    supportsNanoContracts: false,
    supportsGetAddressInfo: false,
    supportsGetTx: false,
    supportsGetFullHistory: false,
    supportsTemplateTransactions: false,
    supportsCheckAddressesMine: false,

    // WalletService requires special initialization (requestPassword mock)
    requiresSpecialInit: true,
  }
);
