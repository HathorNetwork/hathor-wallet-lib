# EDGE-05: Shielding an entire balance to a single recipient is impossible — the ≥2-output rule plus the 1-min range proof leave no decoy option

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

hathor-core requires that a transaction with any shielded outputs carry at least two of them (trivial-commitment protection), and the wallet-lib correctly hard-throws when exactly one is requested. The natural escape hatch — adding a zero-value "decoy" shielded output — is impossible because the ct-crypto range proof hardcodes `min_value = 1`, so a value-0 shielded output can never be built. As a result, the simple intent "shield my entire balance to one address" fails hard whenever the selected inputs exactly cover value + fee (no change to convert), and the wallet offers no graceful path, auto-split, or documented guidance. The caller *can* work around it manually by splitting the amount into two shielded outputs to the same address, so this is a missing-UX/documentation gap rather than a strict protocol impossibility (except the degenerate value-1 case, which cannot be split).

## Location

- src/new/sendTransaction.ts:504-515 — hard throw on exactly one shielded output (pre-crypto validation)
- src/shielded/creation.ts:263-268 — same rule enforced again inside `createShieldedOutputs`
- src/new/sendTransaction.ts:1060-1088 — `convertHtrChangeIfRequested` no-ops when there is no HTR change output (or change ≤ fee), so `changeShieldedMode` cannot supply the second output in the no-change case

## Details

The wallet validates the shielded output count before doing any crypto work:

```ts
// src/new/sendTransaction.ts:504-509
// Validate shielded output count before expensive crypto work
if (shieldedOutputDefs.length === 1) {
  throw new SendTxError(
    'At least 2 shielded outputs are required to prevent trivial commitment matching.'
  );
}
```

and again defensively in the creation helper:

```ts
// src/shielded/creation.ts:264-268
if (proposals.length === 1) {
  throw new Error(
    'At least 2 shielded outputs are required (hathor-core trivial-commitment rule)'
  );
}
```

Both checks faithfully mirror the consensus rule (see Source of truth), so the throw itself is correct. The problem is that the wallet provides no path to *satisfy* the rule when the user has only one shielded recipient:

1. **Zero-value decoy is impossible.** A second, zero-value shielded output to a throwaway/own address would be the classic decoy technique, but ct-crypto hardcodes `min_value = 1` when creating range proofs, so `createRangeProof`/`create*ShieldedOutput` with value 0 throws inside `RangeProof::new`. Zero-value shielded outputs cannot exist on this chain by design.

2. **Shielded change cannot rescue the no-change case.** The `changeShieldedMode` option converts the HTR change output into a shielded output (which would provide the second output). But `convertHtrChangeIfRequested` returns early when no HTR change output exists, or when change ≤ the additional fee:

```ts
// src/new/sendTransaction.ts:1081-1088
if (changeIdx === -1) return { addedFee: 0n };

const transparentChange = partialHtrTxData.outputs[changeIdx];
if (transparentChange.value <= additionalFee) {
  // Conversion would produce a zero or negative shielded value —
  // keep the transparent change so we don't silently drop funds.
  return { addedFee: 0n };
}
```

So when a user shields their entire balance to one recipient — i.e., selected UTXOs exactly equal value + fee, producing no change — there is exactly one shielded output, no change to convert, no decoy possible, and the send fails with `'At least 2 shielded outputs are required to prevent trivial commitment matching.'`

3. **No auto-split logic exists anywhere in wallet-lib.** A search of `src/` confirms there is no fallback that splits a single shielded recipient amount into two outputs, and neither the error message nor any documentation tells callers about the manual workaround (send two shielded outputs of `v-1` and `1`, or any split with each part ≥ 1, to the same address).

## Source of truth

- **Core consensus rule** — hathor-core:hathor/verification/transaction_verifier.py:1219-1227: `verify_trivial_commitment_protection` raises `TrivialCommitmentError('at least 2 shielded outputs are required to prevent trivial commitment matching ...')` whenever `0 < len(tx.shielded_outputs) < 2`. Note core is *stricter* than the RFC text: the RFC summary (SHIELDED_INTEGRATION_REVIEW/reference/rfc-summary.md:12) describes a wallet-side rule allowing "at least 2 shielded outputs (or include a transparent output)" — core accepts no transparent-output alternative, and core wins.
- **Zero-value commitments forbidden** — hathor-core:hathor-ct-crypto/src/rangeproof.rs:42-44: `RangeProof::new(SECP256K1, 1 /* min_value: reject zero-amount commitments */, ...)`. Creation with `amount = 0` fails — asserted by the test `test_zero_amount_rejected` at hathor-core:hathor-ct-crypto/src/rangeproof.rs:166-181. Verification also independently rejects `range.start < 1` at hathor-core:hathor-ct-crypto/src/rangeproof.rs:95-101, so even a hand-rolled zero-value proof would be rejected on-chain.

Together these two source-of-truth constraints mean: any tx with shielded outputs needs ≥ 2 of them, and every one of them must commit to a value ≥ 1.

## Impact

A user (or an application built on wallet-lib) tries the most natural shielding operation: "shield everything I have to this one shielded address."

- If the selected funds exactly cover value + fee (the typical "send max" flow computes precisely this), there is no change output. The tx then has exactly one shielded output; `changeShieldedMode` no-ops; the send fails hard with `SendTxError: At least 2 shielded outputs are required...`.
- The error gives no recovery guidance, so the integrating app cannot easily distinguish "user error" from "protocol shape constraint with a known workaround."
- The only true impossibility is total value 1 (cannot be split into two ≥ 1 parts); everything else is achievable manually but undocumented.

No funds are at risk and no invalid transaction can be produced (the wallet fails closed, matching core), hence **low** severity. This is a usability/completeness gap in a flagship flow ("shield my balance"), not a correctness bug.

## Recommendation

1. **Document the limitation** in the shielded-outputs integration docs and in the thrown error message: a single-recipient shield requires either a second shielded recipient, shielded change, or a manual split of the amount into two shielded outputs to the same address (each ≥ 1).
2. **Optionally add an auto-split path** (behind an explicit named option, per project convention of explicit options over inference — e.g. `autoSplitSingleShieldedOutput: true`): when exactly one shielded output is requested and no shielded change materializes, split the amount `v` into two outputs to the same `(address, scanPubkey)`, e.g. `v - 1` and `1` (or a randomized split to avoid a recognizable pattern), both with the same `shieldedMode`. Each output needs its own ephemeral keypair and blinding, which the existing `createShieldedOutputs` path already handles for N outputs. Reject `v < 2` with a clear error ("amount too small to satisfy the 2-output minimum").
3. Account for the per-output fee of the extra shielded output (`FEE_PER_FULL_SHIELDED_OUTPUT` / `FEE_PER_AMOUNT_SHIELDED_OUTPUT`) when auto-splitting, mirroring the bookkeeping already done in `convertHtrChangeIfRequested`.

Sketch (inside the `shieldedOutputDefs.length === 1` branch in src/new/sendTransaction.ts, replacing the throw when the option is set):

```ts
if (shieldedOutputDefs.length === 1) {
  if (options.autoSplitSingleShieldedOutput && shieldedOutputDefs[0].value >= 2n) {
    const def = shieldedOutputDefs[0];
    const part = 1n + BigInt(Math.floor(Math.random() * Number(def.value - 1n)));
    shieldedOutputDefs = [
      { ...def, value: part },
      { ...def, value: def.value - part },
    ];
  } else {
    throw new SendTxError(
      'At least 2 shielded outputs are required to prevent trivial commitment matching. ' +
        'To shield to a single recipient, add shielded change or split the amount into two outputs.'
    );
  }
}
```

## Verification notes

The skeptic panel independently confirmed every evidence citation:

1. Wallet throws on exactly one shielded output at src/new/sendTransaction.ts:505-509 and again at src/shielded/creation.ts:264-268.
2. Core requires ≥ 2 shielded outputs whenever any exist (hathor-core:hathor/verification/transaction_verifier.py:1219-1227, `TrivialCommitmentError`); core is stricter than the RFC summary's "or include a transparent output" alternative (rfc-summary.md:12) — core wins.
3. Zero-value decoy is impossible: ct-crypto hardcodes `min_value = 1` (hathor-core:hathor-ct-crypto/src/rangeproof.rs:42-44), the unit test at rangeproof.rs:166-181 asserts amount-0 proof creation fails, and verification rejects `range.start < 1` (rangeproof.rs:95-101).
4. `convertHtrChangeIfRequested` no-ops with no HTR change output (src/new/sendTransaction.ts:1081) or change ≤ fee (src/new/sendTransaction.ts:1084-1088), so `changeShieldedMode` cannot supply the second output in the exact-funds case.
5. No auto-split/decoy logic exists anywhere in wallet-lib `src/`.

Framing caveat accepted by the panel: "impossible" is slightly overstated — a caller can manually split the amount into two ≥ 1 shielded outputs to the same address via the existing API (except total value 1). The finding is therefore a missing graceful path / documentation gap, and the low severity and recommendation stand as written.
