# COMP-09: No pre-validation that shielded values are in [1, 2^40) — out-of-range amounts fail deep inside native crypto with a misleading error

**Severity:** medium - **Status:** confirmed by adversarial review

**Also reported as:** WIRE-05 (no [1, 2^40) value bound enforced before building shielded outputs — two write-ups), CRY-03 (value not pre-validated against the 40-bit range-proof bound), and EDGE-02 (no upper-bound value validation) — all merged here. Related test-coverage gap: TEST-02.

## Summary

ct-crypto range proofs are pinned at 40 bits with `min_value = 1`, so the only values a shielded output may legitimately commit to are in `[1, 2^40)`. The wallet-lib never checks this: `createShieldedOutputs` validates scanPubkey and token-UID lengths up front precisely to avoid confusing downstream failures, but accepts any `bigint` value, and the send-path collection of shielded definitions does the same. Worse than a merely misleading error: because libsecp256k1-zkp treats the 40-bit setting as a *floor* (minimum mantissa), values slightly above `2^40` silently produce a larger-but-still-under-cap range proof that the node **accepts**, breaking the constant-proof-size privacy invariant and leaking that the committed value is huge.

## Location

- `src/shielded/creation.ts:270-309` — upfront validation block (scanPubkey length, token UID lengths, inputGenerators token UIDs) with no value-range check
- `src/shielded/creation.ts:83-98` and `src/shielded/creation.ts:169-196` — `proposal.value` passed straight into the crypto provider
- `src/new/sendTransaction.ts:240-257` — shielded output defs accepted with no value check (phantom output uses `output.value` as-is)
- `src/new/sendTransaction.ts:1060-1112` — `convertHtrChangeIfRequested` constructs a shielded def from change value with no upper-bound check
- `src/models/shielded_output.ts:174-176` — only a *proof-size* cap exists (`MAX_RANGE_PROOF_SIZE = 3328`, `src/constants.ts:254`), which indirectly trips for very large values but with a cryptic message

## Details

The orchestrator deliberately front-loads cheap validation before doing expensive proofs (`src/shielded/creation.ts:270-309`):

```ts
  // Validate inputs upfront before expensive crypto work
  const hasFullShielded = proposals.some(p => p.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED);
  for (const [idx, proposal] of proposals.entries()) {
    const pubkeyBuf = Buffer.from(proposal.scanPubkey, 'hex');
    if (pubkeyBuf.length !== COMPRESSED_PUBKEY_SIZE_BYTES) { ... }
    const tokenBuf = Buffer.from(
      proposal.token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : proposal.token,
      'hex'
    );
    if (tokenBuf.length !== TX_HASH_SIZE_BYTES) { ... }
  }
```

`proposal.value` is never inspected. It then flows directly into the provider for every output (`src/shielded/creation.ts:91-98`, mirrored for FullShielded at `:187-195`):

```ts
    const vbf = await cryptoProvider.generateRandomBlindingFactor();
    cryptoResult = await cryptoProvider.createAmountShieldedOutput(
      proposal.value,
      recipientPubkeyBuf,
      tokenUidBuf,
      vbf
    );
```

Upstream there is no check either. `sendManyOutputsSendTransaction`'s data preparation accepts shielded defs and builds a phantom transparent output from the raw value (`src/new/sendTransaction.ts:240-257`); transparent `OutputValueType` allows up to `2^63 - 1`, so values far above `2^40` sail through UTXO selection. `convertHtrChangeIfRequested` (`src/new/sendTransaction.ts:1102-1109`) likewise pushes `transparentChange.value - additionalFee` into a shielded def with only a lower-bound guard against zero/negative conversion (`:1084-1088`), no upper bound.

An exhaustive search of `src/` found no 40-bit or positivity check anywhere: not in the zod schemas, not in `src/models/shielded_output.ts` (which only enforces proof/script byte sizes at `:175`/`:187`), not in the installed `@hathor/ct-crypto-node` bindings (whose `bigint_to_u64` only rejects negatives and values above `u64`).

What actually happens per value range:

| Value | Behavior |
| --- | --- |
| `0` | Native sign fails (`min_value = 1` > value). Error surfaces as the wrapped `Failed to create shielded output i/N (mode=..., token=...): ... RangeProof...` from `src/shielded/creation.ts:358-364`, after UTXO selection and up to N−1 expensive proofs already ran. |
| `[1, 2^40]` | Works (note: exactly `2^40` still fits 40 bits because of the `min_value = 1` offset — the proven range is `[1, 2^40]` inclusive). |
| `(2^40, ~2^41]` | **Silently succeeds.** libsecp256k1-zkp uses `min_bits` as a floor: mantissa becomes 41 bits, the proof grows to ~3309 B — still under the 3328 cap on both wallet (`src/models/shielded_output.ts:175`) and node side — and the node accepts the transaction. The constant-proof-size privacy property is broken: the oversized proof is observable on-chain and reveals that this output commits to a value above `2^40`. |
| larger | Proof grows past 3328 B and `src/models/shielded_output.ts:176` throws `range proof size 3373 exceeds maximum 3328` at serialization time — after all proofs were computed, with no hint that the amount was the problem. |

## Source of truth

- hathor-core:hathor-ct-crypto/src/rangeproof.rs:15 — `pub const RANGE_PROOF_BITS: usize = 40;` with the comment (lines 7-14): fixed bits "ensures all proofs are the same size regardless of the committed value, preventing proof-size side-channels"; 40 bits covers up to ~1.1 trillion units, "well above the maximum token supply".
- hathor-core:hathor-ct-crypto/src/rangeproof.rs:44 — `1, // min_value: reject zero-amount commitments`.
- hathor-core:hathor-ct-crypto/src/rangeproof.rs:95-101 — verification only enforces `range.start >= 1`; it never checks the proven range's upper bound or an exact proof size, so a 41-bit proof verifies fine.
- hathor-core:hathor/verification/transaction_verifier.py:800-827 — `verify_range_proofs` only calls `verify_range_proof(proof, commitment, generator)`; no node-side cap on the proven upper bound either. Nothing on the node rejects a slightly-oversized-mantissa proof that fits the 3328-byte size cap.
- libsecp256k1-zkp (vendored under secp256k1-zkp-sys 0.10.1, `depend/secp256k1/src/modules/rangeproof/rangeproof_impl.h:162-165`) — sign-side mantissa is `max(bits_needed(value - min_value), min_bits)`, i.e. 40 is a floor, not a cap.
- ct-crypto caller contract (ground-truth ct-crypto reference, "Caller responsibilities") — values must be in `[1, 2^40)`; the binding itself accepts any u64. The client integration guide makes the range check an explicit wallet responsibility.
- ct-crypto tests only exercise values up to `2^40 − 1` (hathor-core:hathor-ct-crypto/src/rangeproof.rs:307,328) and explicitly reject zero (`test_zero_amount_rejected`, :167-181), confirming the supported domain.

## Impact

- **Privacy degradation accepted on-chain (the serious case):** a user or integrator who shields a value in `(2^40, ~2^41]` — e.g. a custom token with large supply, or an aggregated treasury amount; transparent outputs allow up to `2^63 − 1` so nothing else stops this — gets a transaction the node *accepts* whose range proof is visibly larger than every other shielded output's. Anyone watching the chain learns that this particular output commits to a value above `2^40`, defeating the uniform-proof-size design and partially deanonymizing the amount. No layer (wallet, binding, node) prevents it.
- **Misleading failures (the annoying case):** value `0`, or values large enough to exceed the 3328-byte cap, fail only after UTXO selection and all expensive native proof computations, with errors like `Failed to create shielded output 2/3 ... RangeProofError` or `range proof size 3373 exceeds maximum 3328` that say nothing about the amount being out of range. For the change-conversion path the user never even typed the offending number.

## Recommendation

Add an explicit range check to the upfront validation loop in `createShieldedOutputs` (`src/shielded/creation.ts:272-288`), alongside the existing scanPubkey/token checks:

```ts
const MAX_SHIELDED_VALUE = 1n << 40n; // ct-crypto RANGE_PROOF_BITS = 40

if (proposal.value < 1n || proposal.value >= MAX_SHIELDED_VALUE) {
  throw new Error(
    `Shielded output ${idx}: value must be in [1, 2^40) — confidential range proofs are fixed at 40 bits (got ${proposal.value})`
  );
}
```

Mirror the same check where shielded defs are first accepted in `sendManyOutputsSendTransaction` (`src/new/sendTransaction.ts:240`), so API callers get the error before any UTXO selection, and it implicitly covers `convertHtrChangeIfRequested` if placed where defs are consumed. Ideally export the bound as a constant in `src/constants.ts` next to `MAX_RANGE_PROOF_SIZE`. Rejecting exactly `2^40` is deliberately one unit conservative (that value technically still fits due to the `min_value = 1` offset) and keeps the invariant simple and safe.

## Verification notes

- Confirmed no value-range pre-validation exists anywhere in wallet-lib: the upfront block at `src/shielded/creation.ts:270-309` checks scanPubkey length (:274), token UID length (:283) and inputGenerators token UIDs (:299-308) but never `proposal.value`; exhaustive grep of `src/` for 40-bit/positivity checks found only `MAX_SHIELDED_OUTPUTS`, `MAX_RANGE_PROOF_SIZE = 3328` (`src/constants.ts:254`), and proof-/script-size checks in `src/models/shielded_output.ts:175,187`. The installed `@hathor/ct-crypto-node` binding's `bigint_to_u64` only rejects negative/`> u64` values.
- Confirmed the source of truth: `RANGE_PROOF_BITS = 40` and `min_value = 1` in hathor-core:hathor-ct-crypto/src/rangeproof.rs:15,44; tests exercise at most `2^40 − 1`; core verifier (hathor-core:hathor/verification/transaction_verifier.py:800-827) checks only proof validity plus `min >= 1` — never the upper bound or exact proof size.
- Mechanism correction discovered during adversarial review (worsens the finding): only value `0` fails inside native crypto. For values above `2^40`, libsecp256k1-zkp treats `min_bits` as a floor (`rangeproof_impl.h:162-165`), so `(2^40, ~2^41]` yields a node-accepted 41-bit proof (~3309 B, under the 3328 cap on both sides) that breaks the constant-proof-size privacy invariant, while larger values fail wallet-lib's own serialization cap with a cryptic size error after all proofs were computed.
- Verdict: finding real; recommendation correct and slightly conservative (rejects exactly `2^40`, which is safe). Severity raised from low to medium because a window of out-of-range values produces node-accepted transactions with privacy-degrading variable-size proofs, and nothing node-side rejects them.

## Evidence folded from WIRE-05 / CRY-03 / EDGE-02 (merged duplicates)

- The pre-crypto checks in `SendTransaction` cover only shielded output *count* (min 2, `MAX_SHIELDED_OUTPUTS`) — `src/new/sendTransaction.ts:504-515`; the wallet facade maps user outputs into proposals with no value check (`src/new/wallet.ts:1981-2019`).
- The only value check anywhere in the shielded path is on the *receive* side: post-rewind `recoveredValue <= 0n` (`src/shielded/processing.ts:203`), lower bound only.
- `MAX_OUTPUT_VALUE = 2^63` (`src/constants.ts:107`) is a transparent serialization bound never applied to shielded values, and `MAX_RANGE_PROOF_SIZE` is enforced only at (de)serialization (`src/models/shielded_output.ts:175`), never on the creation path before expensive proofs.
