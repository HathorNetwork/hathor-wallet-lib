/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export { ShieldedOutputMode } from './types';

export type {
  IShieldedOutput,
  IShieldedOutputDecoded,
  IDecryptedShieldedOutput,
  ICreatedShieldedOutput,
  IShieldedCryptoProvider,
  IProcessedShieldedOutput,
  IRewoundAmountShieldedOutput,
  IRewoundFullShieldedOutput,
} from './types';

// Provider implementations live with their respective ct-crypto packages:
//   - Node:    @hathor/ct-crypto-node    → createDefaultShieldedCryptoProvider()
//   - Browser: @hathor/ct-crypto-wasm    → createBrowserShieldedCryptoProvider()
//   - Mobile:  built into the app target (RN native module)
//
// Install whichever crypto package matches your runtime, then wire it in via
// `wallet.setShieldedCryptoProvider(createXxxShieldedCryptoProvider())`.
