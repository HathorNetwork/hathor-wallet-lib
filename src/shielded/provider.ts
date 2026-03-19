/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  IShieldedCryptoProvider,
  IDecryptedShieldedOutput,
  ICreatedShieldedOutput,
  ShieldedOutputMode,
} from './types';

/**
 * Creates the default shielded crypto provider using @hathor/ct-crypto-node.
 * Throws if the native addon is not installed.
 */
export function createDefaultShieldedCryptoProvider(): IShieldedCryptoProvider {
  // Dynamic require so wallet-lib doesn't fail to import when addon is absent
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const addon = require('@hathor/ct-crypto-node');
  const cryptoAddon = addon.loadNativeAddon();

  return {
    decryptShieldedOutput(
      recipientPrivkey, ephemeralPubkey, commitment, rangeProof, tokenUid, assetCommitment
    ): IDecryptedShieldedOutput {
      const result = cryptoAddon.decryptShieldedOutput(
        recipientPrivkey, ephemeralPubkey, commitment, rangeProof, tokenUid, assetCommitment
      );
      return {
        value: result.value, // already bigint from cryptoAddon wrapper
        blindingFactor: result.blindingFactor,
        tokenUid: result.tokenUid.toString('hex'),
        assetBlindingFactor: result.assetBlindingFactor,
        outputType: assetCommitment
          ? ShieldedOutputMode.FULLY_SHIELDED
          : ShieldedOutputMode.AMOUNT_SHIELDED,
      };
    },

    deriveEcdhSharedSecret(privkey, pubkey) {
      return cryptoAddon.deriveEcdhSharedSecret(privkey, pubkey);
    },

    createShieldedOutput(value, recipientPubkey, tokenUid, fullyShielded): ICreatedShieldedOutput {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Shielded output value exceeds safe integer range');
      }
      const result = cryptoAddon.createShieldedOutput(
        Number(value), recipientPubkey, tokenUid, fullyShielded
      );
      return result;
    },
  };
}
