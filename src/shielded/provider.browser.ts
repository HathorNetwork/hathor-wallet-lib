/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { IShieldedCryptoProvider } from './types';

/**
 * Browser-side shielded crypto provider, backed by `@hathor/ct-crypto-wasm`
 * (the wasm-bindgen build of `hathor-ct-crypto`). Mirrors the NAPI provider
 * in `provider.ts` but only exposes the verifier-only surface — see
 * `wasm_bindings.rs` and the plan in
 * `~/.claude/plans/rustling-cooking-lantern.md` for the rationale (no
 * range-proof rewind / ECDH / surjection-proof creation in the browser).
 *
 * Calling any non-verify method on this provider throws — those code
 * paths shouldn't be reached in a browser context (e.g. the explorer
 * doesn't sign or rewind anything; it only verifies user-supplied
 * unblinding payloads against on-chain commitments).
 *
 * The WASM module is loaded via dynamic import so consumers that don't
 * touch shielded data don't pull the artifact (or pay its bundle cost).
 * `wasm-pack --target web` ships an init function that fetches the
 * `.wasm` over HTTP — the caller is responsible for making sure the
 * bundler emits the asset alongside the JS.
 */
export async function createBrowserShieldedCryptoProvider(): Promise<IShieldedCryptoProvider> {
  // Inline import so this module type-checks even when the WASM package
  // is not yet installed in a downstream consumer (the explorer adds it;
  // wallet-lib itself doesn't depend on it).
  /* eslint-disable @typescript-eslint/ban-ts-comment, import/no-unresolved, import/no-extraneous-dependencies, global-require */
  // @ts-ignore — package only present in browser-bundle consumers
  const wasm = await import('@hathor/ct-crypto-wasm');
  /* eslint-enable */

  // wasm-pack `--target web` exposes a default-export init that fetches
  // and instantiates the module. Calling it once before use is required.
  if (typeof wasm.default === 'function') {
    await wasm.default();
  }

  const unsupported = (name: string) => () => {
    throw new Error(
      `${name} is not supported by the browser shielded crypto provider — ` +
        'this provider only exposes the verifier-only commitment surface. ' +
        'Use the Node provider for signing / rewinding.'
    );
  };

  return {
    generateRandomBlindingFactor: unsupported('generateRandomBlindingFactor'),
    createAmountShieldedOutput: unsupported('createAmountShieldedOutput'),
    createShieldedOutputWithBothBlindings: unsupported('createShieldedOutputWithBothBlindings'),
    rewindAmountShieldedOutput: unsupported('rewindAmountShieldedOutput'),
    rewindFullShieldedOutput: unsupported('rewindFullShieldedOutput'),
    computeBalancingBlindingFactor: unsupported('computeBalancingBlindingFactor'),
    createSurjectionProof: unsupported('createSurjectionProof'),
    deriveEcdhSharedSecret: unsupported('deriveEcdhSharedSecret'),

    deriveTag(tokenUid: Buffer): Buffer {
      // wasm-bindgen serializes Vec<u8> as Uint8Array; coerce to Buffer
      // so the rest of wallet-lib (which uses Buffer everywhere) sees a
      // uniform shape.
      return Buffer.from(wasm.deriveTag(tokenUid));
    },

    createAssetCommitment(tag: Buffer, blindingFactor: Buffer): Buffer {
      return Buffer.from(wasm.createAssetCommitment(tag, blindingFactor));
    },

    openAmountShieldedCommitment(value: bigint, vbf: Buffer, tokenUid: Buffer): Buffer {
      // Compose the verify primitive client-side from the same building
      // blocks the Node provider uses, so the two stay in sync without a
      // dedicated open* export in the WASM surface.
      const generator = wasm.deriveAssetTag(tokenUid);
      // wasm-bindgen exposes u64 inputs as JS BigInt; passing through.
      return Buffer.from(wasm.createCommitment(value, vbf, generator));
    },

    openFullShieldedCommitment(
      value: bigint,
      vbf: Buffer,
      tokenUid: Buffer,
      abf: Buffer
    ): { valueCommitment: Buffer; assetCommitment: Buffer } {
      const tag = wasm.deriveTag(tokenUid);
      const assetCommitment = wasm.createAssetCommitment(tag, abf);
      const valueCommitment = wasm.createCommitment(value, vbf, assetCommitment);
      return {
        valueCommitment: Buffer.from(valueCommitment),
        assetCommitment: Buffer.from(assetCommitment),
      };
    },
  };
}
