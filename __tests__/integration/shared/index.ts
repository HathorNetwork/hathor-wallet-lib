/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Export all public types
export * from './types';

// Export all test helpers
export {
  HathorWalletFactory,
  WalletServiceWalletFactory,
  HathorWalletHelperAdapter,
  WalletServiceHelperAdapter,
  UnifiedWalletHelper,
} from './test_helpers';

// Export the test factory
export { createWalletFacadeTests } from './wallet_facade_tests';
