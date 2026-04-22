/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  IShieldedCryptoProvider,
  ICreatedShieldedOutput,
  IRewoundAmountShieldedOutput,
  IRewoundFullShieldedOutput,
} from './types';

/**
 * Creates the default shielded crypto provider using @hathor/ct-crypto-node.
 * All function names follow the SHIELDED-OUTPUTS-CLIENT-GUIDE.md specification.
 * Throws if the native addon is not installed.
 */
export function createDefaultShieldedCryptoProvider(): IShieldedCryptoProvider {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, import/no-unresolved, import/no-extraneous-dependencies
  const ct = require('@hathor/ct-crypto-node');

  return {
    generateRandomBlindingFactor(): Buffer {
      return ct.generateRandomBlindingFactor();
    },

    createAmountShieldedOutput(
      value: bigint,
      recipientPubkey: Buffer,
      tokenUid: Buffer,
      valueBlindingFactor: Buffer
    ): ICreatedShieldedOutput {
      const result = ct.createAmountShieldedOutput(
        value,
        recipientPubkey,
        tokenUid,
        valueBlindingFactor
      );
      return {
        ephemeralPubkey: result.ephemeralPubkey,
        commitment: result.commitment,
        rangeProof: result.rangeProof,
        blindingFactor: result.blindingFactor,
      };
    },

    createShieldedOutputWithBothBlindings(
      value: bigint,
      recipientPubkey: Buffer,
      tokenUid: Buffer,
      vbf: Buffer,
      abf: Buffer
    ): ICreatedShieldedOutput {
      const result = ct.createShieldedOutputWithBothBlindings(
        value,
        recipientPubkey,
        tokenUid,
        vbf,
        abf
      );
      return {
        ephemeralPubkey: result.ephemeralPubkey,
        commitment: result.commitment,
        rangeProof: result.rangeProof,
        blindingFactor: result.blindingFactor,
        assetCommitment: result.assetCommitment ?? undefined,
        assetBlindingFactor: result.assetBlindingFactor ?? undefined,
      };
    },

    rewindAmountShieldedOutput(
      privateKey: Buffer,
      ephemeralPubkey: Buffer,
      commitment: Buffer,
      rangeProof: Buffer,
      tokenUid: Buffer
    ): IRewoundAmountShieldedOutput {
      const result = ct.rewindAmountShieldedOutput(
        privateKey,
        ephemeralPubkey,
        commitment,
        rangeProof,
        tokenUid
      );
      return {
        value: result.value,
        blindingFactor: result.blindingFactor,
      };
    },

    rewindFullShieldedOutput(
      privateKey: Buffer,
      ephemeralPubkey: Buffer,
      commitment: Buffer,
      rangeProof: Buffer,
      assetCommitment: Buffer
    ): IRewoundFullShieldedOutput {
      const result = ct.rewindFullShieldedOutput(
        privateKey,
        ephemeralPubkey,
        commitment,
        rangeProof,
        assetCommitment
      );
      return {
        value: result.value,
        blindingFactor: result.blindingFactor,
        tokenUid: result.tokenUid,
        assetBlindingFactor: result.assetBlindingFactor,
      };
    },

    computeBalancingBlindingFactor(
      value: bigint,
      generatorBlindingFactor: Buffer,
      inputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }>,
      otherOutputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }>
    ): Buffer {
      return ct.computeBalancingBlindingFactor(
        value,
        generatorBlindingFactor,
        inputs.map(i => ({
          value: i.value,
          valueBlindingFactor: i.vbf,
          generatorBlindingFactor: i.gbf,
        })),
        otherOutputs.map(o => ({
          value: o.value,
          valueBlindingFactor: o.vbf,
          generatorBlindingFactor: o.gbf,
        }))
      );
    },

    deriveTag(tokenUid: Buffer): Buffer {
      return ct.deriveTag(tokenUid);
    },

    createAssetCommitment(tag: Buffer, blindingFactor: Buffer): Buffer {
      return ct.createAssetCommitment(tag, blindingFactor);
    },

    createSurjectionProof(
      codomainTag: Buffer,
      codomainBlindingFactor: Buffer,
      domain: Array<{ generator: Buffer; tag: Buffer; blindingFactor: Buffer }>
    ): Buffer {
      return ct.createSurjectionProof(codomainTag, codomainBlindingFactor, domain);
    },

    deriveEcdhSharedSecret(privkey: Buffer, pubkey: Buffer): Buffer {
      return ct.deriveEcdhSharedSecret(privkey, pubkey);
    },
  };
}
