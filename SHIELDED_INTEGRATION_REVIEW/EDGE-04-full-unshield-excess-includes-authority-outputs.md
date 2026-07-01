# EDGE-04: Full-unshield excess computation in SendTransaction includes authority outputs' mask value, diverging from the prepareTransaction path

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

When `SendTransaction` builds a full-unshield transaction (shielded inputs, zero shielded outputs), it computes the `UnshieldBalanceHeader` excess scalar by summing every transparent output's `value` — with no filter for authority outputs. Authority outputs carry a bitmask (`TOKEN_MINT_MASK = 1n`, `TOKEN_MELT_MASK = 2n`) in their `value` field, not a token amount, and both hathor-core's verifier and ct-crypto explicitly exclude such entries from the balance equation. The sibling implementation of the same computation in `src/utils/transaction.ts` applies the correct guard, so the two paths diverge. The bug is currently latent because `prepareTxData` hard-codes `authorities: 0n` on every output it can produce, but it becomes a real node-rejection bug the moment this code path is reused for a flow that can carry authority outputs.

## Location

- `src/new/sendTransaction.ts:555-562` — unfiltered loop pushing every `out.value` into `transparentOutputEntries`
- `src/new/sendTransaction.ts:485` — the input side of the same computation, which *does* filter authorities (internal asymmetry)
- `src/utils/transaction.ts:1388-1400` — the correct sibling implementation (reference behavior)
- `src/constants.ts:129,135` — `TOKEN_MINT_MASK` / `TOKEN_MELT_MASK` definitions

## Details

The full-unshield branch in `SendTransaction` (gated on `shieldedOutputs.length === 0 && blindedInputsArr.length > 0`) computes the excess blinding factor that the `UnshieldBalanceHeader` must carry. Output-side entries are collected like this (`src/new/sendTransaction.ts:555-562`):

```ts
const transparentOutputEntries: Array<IBlindingEntry> = [];
for (const out of outputs) {
  transparentOutputEntries.push({
    value: out.value,
    valueBlindingFactor: ZERO_TWEAK,
    generatorBlindingFactor: ZERO_TWEAK,
  });
}
```

There is no check on `out.authorities` or on `out.value > 0n`. For an authority output, `value` holds the authority mask (`TOKEN_MINT_MASK = 0b00000001n`, `TOKEN_MELT_MASK = 0b00000010n`, `src/constants.ts:129,135`), so this loop would feed `1n` or `2n` into `computeBalancingBlindingFactor` as if it were a spendable token amount.

The asymmetry is visible inside the very same computation: the *input* side filters correctly at `src/new/sendTransaction.ts:485`:

```ts
} else if (utxo && (utxo.authorities ?? 0n) === 0n && utxo.value > 0n) {
  transparentInputEntries.push({ value: utxo.value, ... });
}
```

And the sibling implementation of the exact same excess computation in `prepareTransaction` (`src/utils/transaction.ts:1388-1400`) documents and applies the intended rule:

```ts
// All outputs contribute (value, vbf=0, gbf=0). Authority outputs
// are skipped because their `value` field is the authority mask,
// not a token amount the verifier sums.
for (const out of txData.outputs) {
  if (out.value > 0n && (out.authorities ?? 0n) === 0n) {
    transparentOutputEntries.push({ value: out.value, ... });
  }
}
```

`computeBalancingBlindingFactor` is only well-defined when the sum of input values equals the sum of output values over the entries it is given. Inflating the output side by an authority mask value breaks that precondition: the returned scalar no longer satisfies `excess = sum(r_in) − sum(r_out)` over the entries the verifier actually sums, so the homomorphic balance check fails.

## Source of truth

- hathor-core skips authority outputs entirely when assembling the transparent-output side of the shielded balance equation: `hathor-core:hathor/verification/transaction_verifier.py:979-980` — `if output.is_token_authority(): continue`.
- ct-crypto's balance verifier skips zero-value transparent entries on both sides, with comments naming authority outputs as the motivating case: `hathor-core:hathor-ct-crypto/src/balance.rs:56-57` (inputs) and `hathor-core:hathor-ct-crypto/src/balance.rs:73-74` (outputs).
- ct-crypto's own full-unshield test (`test_full_unshield_to_transparent_with_excess` in `hathor-core:hathor-ct-crypto/src/balance.rs`) requires input and output value sums to match exactly (both 1000) for the excess to verify.

Net effect: the verifier's balance equation never includes authority output values, so an excess scalar computed over them cannot match what the node checks.

## Impact

If a transaction ever flows through the `SendTransaction` full-unshield branch while carrying an authority output (e.g. a future mint/melt-while-unshielding flow, or any caller that reuses this path with hand-built `IDataOutput`s where `authorities !== 0n`), the wallet would compute an excess blinding factor over an output sum inflated by the mask value (1n or 2n). The resulting `UnshieldBalanceHeader` would not satisfy the node's homomorphic balance equation and the transaction would be rejected (shielded balance mismatch), with a confusing failure far from the actual cause.

Today the path is unreachable with authority outputs: `prepareTxData` hard-codes `authorities: 0n` on every output it builds (`src/new/sendTransaction.ts:237`, `:252`, `:275`) and change outputs are never authority outputs. Hence severity low — this is a latent correctness divergence between two implementations of the same computation, not a currently exploitable bug.

## Recommendation

Mirror the `prepareTransaction` guard in the `SendTransaction` full-unshield loop:

```ts
for (const out of outputs) {
  if (out.value > 0n && (out.authorities ?? 0n) === 0n) {
    transparentOutputEntries.push({
      value: out.value,
      valueBlindingFactor: ZERO_TWEAK,
      generatorBlindingFactor: ZERO_TWEAK,
    });
  }
}
```

Optionally carry over the explanatory comment from `src/utils/transaction.ts:1389-1391` so the two sites stay recognizably in sync. Longer term, consider extracting the excess-computation entry-building into a single shared helper so the two paths cannot diverge again.

## Verification notes

The skeptic panel confirmed the finding on three axes:

1. **The divergence is real.** `src/new/sendTransaction.ts:556-562` pushes every `out.value` with no authority/zero filter, while the input side of the same computation filters at `src/new/sendTransaction.ts:485` — an internal asymmetry within one function — and the sibling path `src/utils/transaction.ts:1392-1399` applies the correct guard with a comment explaining why.
2. **The source of truth agrees with the guarded version.** hathor-core's verifier excludes authority outputs (`transaction_verifier.py:979-980`) and ct-crypto excludes zero-amount entries (`balance.rs:56-57, 73-74`), so an excess computed over mask values would fail node verification.
3. **Latency confirmed, justifying low severity.** `prepareTxData` hard-codes `authorities: 0n` on all outputs it constructs (`sendTransaction.ts:237, 252, 275`), and downstream change outputs are never authority outputs, so no current caller can reach the buggy loop with an authority output. The recommended fix (mirroring the existing guard) was judged appropriate and minimal.
