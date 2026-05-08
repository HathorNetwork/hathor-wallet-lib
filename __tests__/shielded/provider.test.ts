/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createDefaultShieldedCryptoProvider } from '../../src/shielded/provider';

/**
 * Round-trip the verify-only commitment primitives against the real
 * ct-crypto-node bindings. Builds an output with `createAmountShielded` /
 * `createShieldedOutputWithBothBlindings` (which pin the blinding
 * factors via the caller-supplied vbf/abf), then recomputes the
 * commitments via the new `openAmountShieldedCommitment` /
 * `openFullShieldedCommitment` and asserts byte equality.
 *
 * If the prebuilt native addon is not available for the current
 * platform — e.g. in a CI matrix entry without ct-crypto-node prebuilds —
 * we skip rather than fail; the verifier surface is exercised on every
 * platform where the rest of the shielded test suite already runs.
 */

const provider = (() => {
  try {
    return createDefaultShieldedCryptoProvider();
  } catch {
    return null;
  }
})();

const describeIfProvider = provider ? describe : describe.skip;

// Small valid secp256k1 pubkey for ECDH inside the create paths. Doesn't
// matter which point we pick — verification is independent of the
// recipient key.
const RECIPIENT_PUBKEY = Buffer.from(
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  'hex'
);

const HTR_TOKEN_UID = Buffer.alloc(32, 0);

describeIfProvider('shielded crypto provider — verifier-only primitives', () => {
  it('openAmountShieldedCommitment recomputes the commitment built by createAmountShieldedOutput', async () => {
    const p = provider!;
    const value = 1234n;
    const vbf = await p.generateRandomBlindingFactor();

    const created = await p.createAmountShieldedOutput(
      value,
      RECIPIENT_PUBKEY,
      HTR_TOKEN_UID,
      vbf as Buffer
    );

    const recomputed = await p.openAmountShieldedCommitment(value, vbf as Buffer, HTR_TOKEN_UID);

    expect(created.commitment.equals(recomputed)).toBe(true);
  });

  it('openFullShieldedCommitment recomputes both commitments for a FullShielded output', async () => {
    const p = provider!;
    const value = 5678n;
    const customToken = Buffer.alloc(32, 0xaa);
    const vbf = await p.generateRandomBlindingFactor();
    const abf = await p.generateRandomBlindingFactor();

    const created = await p.createShieldedOutputWithBothBlindings(
      value,
      RECIPIENT_PUBKEY,
      customToken,
      vbf as Buffer,
      abf as Buffer
    );

    const recomputed = await p.openFullShieldedCommitment(
      value,
      vbf as Buffer,
      customToken,
      abf as Buffer
    );

    expect(created.commitment.equals(recomputed.valueCommitment)).toBe(true);
    expect(created.assetCommitment).toBeDefined();
    expect(created.assetCommitment!.equals(recomputed.assetCommitment)).toBe(true);
  });

  it('a tampered vbf produces a different value commitment', async () => {
    const p = provider!;
    const value = 100n;
    const vbf = await p.generateRandomBlindingFactor();

    const created = await p.createAmountShieldedOutput(
      value,
      RECIPIENT_PUBKEY,
      HTR_TOKEN_UID,
      vbf as Buffer
    );

    // Flip one byte of vbf.
    const tampered = Buffer.from(vbf as Buffer);
    tampered[0] ^= 0x01;

    const recomputed = await p.openAmountShieldedCommitment(value, tampered, HTR_TOKEN_UID);

    expect(created.commitment.equals(recomputed)).toBe(false);
  });
});
