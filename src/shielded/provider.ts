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

  // Methods are declared `async` so the returned provider satisfies the
  // uniformly-Promise-typed IShieldedCryptoProvider interface even though the
  // underlying native addon (ct) is synchronous. Returning `Promise<T>` at the
  // interface level lets every caller `await` without defending against a
  // `T | Promise<T>` union.
  return {
    async generateRandomBlindingFactor(): Promise<Buffer> {
      return ct.generateRandomBlindingFactor();
    },

    async createAmountShieldedOutput(
      value: bigint,
      recipientPubkey: Buffer,
      tokenUid: Buffer,
      valueBlindingFactor: Buffer
    ): Promise<ICreatedShieldedOutput> {
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

    async createShieldedOutputWithBothBlindings(
      value: bigint,
      recipientPubkey: Buffer,
      tokenUid: Buffer,
      vbf: Buffer,
      abf: Buffer
    ): Promise<ICreatedShieldedOutput> {
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

    async rewindAmountShieldedOutput(
      privateKey: Buffer,
      ephemeralPubkey: Buffer,
      commitment: Buffer,
      rangeProof: Buffer,
      tokenUid: Buffer
    ): Promise<IRewoundAmountShieldedOutput> {
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

    async rewindFullShieldedOutput(
      privateKey: Buffer,
      ephemeralPubkey: Buffer,
      commitment: Buffer,
      rangeProof: Buffer,
      assetCommitment: Buffer
    ): Promise<IRewoundFullShieldedOutput> {
      const result = ct.rewindFullShieldedOutput(
        privateKey,
        ephemeralPubkey,
        commitment,
        rangeProof,
        assetCommitment
      );
      // IRewoundFullShieldedOutput.tokenUid is `string` (hex) — the
      // single canonical token-UID encoding the shielded module exposes
      // to its consumers (storage, history, balance, fullnode API
      // lookups). The native `ct` module returns a Buffer, so convert
      // at the provider boundary. Without this conversion the Buffer
      // would propagate as if it were a hex string and downstream
      // `fetchTokenData(uid)` would query the fullnode with a garbled
      // id, getting back "Invalid token id" on every shielded receive.
      return {
        value: result.value,
        blindingFactor: result.blindingFactor,
        tokenUid: result.tokenUid.toString('hex'),
        assetBlindingFactor: result.assetBlindingFactor,
      };
    },

    async computeBalancingBlindingFactor(
      value: bigint,
      generatorBlindingFactor: Buffer,
      inputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }>,
      otherOutputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }>
    ): Promise<Buffer> {
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

    async deriveTag(tokenUid: Buffer): Promise<Buffer> {
      return ct.deriveTag(tokenUid);
    },

    async createAssetCommitment(tag: Buffer, blindingFactor: Buffer): Promise<Buffer> {
      return ct.createAssetCommitment(tag, blindingFactor);
    },

    async createSurjectionProof(
      codomainTag: Buffer,
      codomainBlindingFactor: Buffer,
      domain: Array<{ generator: Buffer; tag: Buffer; blindingFactor: Buffer }>
    ): Promise<Buffer> {
      return ct.createSurjectionProof(codomainTag, codomainBlindingFactor, domain);
    },

    async deriveEcdhSharedSecret(privkey: Buffer, pubkey: Buffer): Promise<Buffer> {
      return ct.deriveEcdhSharedSecret(privkey, pubkey);
    },

    async openAmountShieldedCommitment(
      value: bigint,
      vbf: Buffer,
      tokenUid: Buffer
    ): Promise<Buffer> {
      // AmountShielded: token is public, so the value commitment uses
      // the unblinded asset tag as its generator.
      const generator = ct.deriveAssetTag(tokenUid);
      return ct.createCommitment(value, vbf, generator);
    },

    async openFullShieldedCommitment(
      value: bigint,
      vbf: Buffer,
      tokenUid: Buffer,
      abf: Buffer
    ): Promise<{ valueCommitment: Buffer; assetCommitment: Buffer }> {
      // FullShielded: token is hidden, so the asset is committed first
      // (`Tag * G + abf * H`) and the value commitment uses that
      // blinded asset commitment as its generator.
      const tag = ct.deriveTag(tokenUid);
      const assetCommitment = ct.createAssetCommitment(tag, abf);
      const valueCommitment = ct.createCommitment(value, vbf, assetCommitment);
      return { valueCommitment, assetCommitment };
    },
  };
}
