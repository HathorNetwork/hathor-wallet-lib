# TEST-02: No test covers the 40-bit value ceiling for shielded amounts; largest amount exercised is ~2^26, four orders of magnitude below the 2^40 protocol limit

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

Range proofs in the shielded-outputs protocol are pinned at 40 bits, so shielded values are supposed to live in `[1, 2^40]` (with `min_value = 1` semantics, 2^40 itself still yields a uniform-size proof). wallet-lib has neither a client-side bound on shielded output values nor any test exercising the limit — the largest shielded amount in the entire test suite is `80_000_000n` (~2^26.3). Empirical testing of the installed `@hathor/ct-crypto-node` binding shows over-limit values do not even throw: secp256k1-zkp silently widens the proof, so a 41-bit value produces a 3309-byte proof that fits under the 3328-byte cap and passes verification, while values needing ≥ ~2^42 are rejected only by the node's deserializer size cap — after the wallet has built, signed, and broadcast. Separately, the client-side `Cannot create more than 32 shielded outputs` guard message is asserted by zero tests.

## Location

- `__tests__/integration/shielded_outputs/core.test.ts:86-135` — "large amount (1M+ HTR)" test tops out at `80_000_000n` + `40_000_000n` (lines 101-102)
- `src/new/sendTransaction.ts:504-515` — shielded output pre-crypto guards check only count (min 2, max `MAX_SHIELDED_OUTPUTS`), never value
- `src/shielded/creation.ts:78-97, 168-195` — `proposal.value` passed straight to the crypto provider with no bound
- `src/constants.ts:248-266` — shielded constants are `MAX_SHIELDED_OUTPUTS = 32`, `MAX_RANGE_PROOF_SIZE = 3328`, `MAX_SURJECTION_PROOF_SIZE = 4096`, `MAX_SHIELDED_OUTPUT_SCRIPT_SIZE = 1024`; no shielded value constant exists
- `src/models/shielded_output.ts:92-116` — `serialize()` writes the range proof unchecked; the `MAX_RANGE_PROOF_SIZE` guard exists only on the deserialize path (`:174-176`)

## Details

### 1. No client-side value bound exists

An exhaustive grep over `src/` and `__tests__/` for `2 ** 40`, `1099511627776`, `MAX_SHIELDED_VALUE`, and `40-bit` returns nothing except a comment at `__tests__/integration/shielded_outputs/core.test.ts:88` ("Requires RANGE_PROOF_BITS=40 pinned on both wallet-lib and fullnode"). The only pre-crypto validation at the send layer guards output count (`src/new/sendTransaction.ts:505-515`):

```ts
if (shieldedOutputDefs.length === 1) {
  throw new SendTxError(
    'At least 2 shielded outputs are required to prevent trivial commitment matching.'
  );
}
if (shieldedOutputDefs.length > MAX_SHIELDED_OUTPUTS) {
  throw new SendTxError(
    `Cannot create more than ${MAX_SHIELDED_OUTPUTS} shielded outputs per transaction ` +
      `(requested ${shieldedOutputDefs.length}).`
  );
}
```

`createShieldedOutputs` then forwards `proposal.value` straight to the provider (`src/shielded/creation.ts:84-97` for AmountShielded, `:168-195` for FullShielded):

```ts
cryptoResult = await cryptoProvider.createAmountShieldedOutput(
  proposal.value,
  recipientPubkeyBuf,
  tokenUidBuf,
  vbf
);
```

`MAX_OUTPUT_VALUE` (2^63, `src/constants.ts:107`) is enforced only in transparent output serialization (`src/utils/buffer.ts:287-288`); shielded values never pass through that code path.

### 2. The crypto layer does NOT reject over-limit values

Empirical run against the installed `@hathor/ct-crypto-node` binding (`createAmountShieldedOutput` + `verifyRangeProof` with the HTR asset tag):

| Value | Result |
|---|---|
| `0` | throws (`range proof error: failed to generate range proof`) |
| `1` | ok, 3213-byte proof, verifies |
| `2^40 - 1` | ok, 3213 bytes, verifies |
| `2^40` | ok, 3213 bytes, verifies (fits via the `min_value = 1` offset) |
| `2^40 + 12345` | **silently succeeds**, 3309-byte proof, verifies |
| `2^41` | silently succeeds, 3309 bytes, verifies |
| `2^42` | silently succeeds, 3373 bytes (now over the 3328 cap) |
| `2^63 - 1` | silently succeeds, 5070 bytes |

secp256k1-zkp treats `RANGE_PROOF_BITS = 40` as `min_bits` — a floor, not a ceiling — and auto-widens the mantissa for larger values. Consequences:

- A 41-bit value (3309-byte proof) is under the node's 3328-byte cap and node verification enforces nothing beyond `range.start >= 1`, so it can be **accepted on-chain** — with a proof whose size (3309 vs the uniform 3213) leaks that this output commits to a >40-bit value, defeating the constant-proof-size property `RANGE_PROOF_BITS` exists to protect.
- Values needing ≥ ~2^42 are rejected only by the node deserializer's size cap — after the wallet has paid the full UTXO-selection, proving, signing, and mining cost. wallet-lib's own 3328-byte check runs on deserialize only (`src/models/shielded_output.ts:174-176`); `serialize()` (`:92-116`) writes the proof unchecked.

### 3. Test coverage gaps

- Max shielded value ever tested is `80_000_000n` (~2^26.3) at `core.test.ts:101-102`. No boundary test exists at `2^40` / `2^40 + 1` anywhere in unit or integration suites.
- The `'Cannot create more than'` message at `sendTransaction.ts:510-515` is asserted by zero tests (grep over `__tests__/` is empty). The only count-guard assertion is `/At least 2 shielded outputs are required/` at `__tests__/shielded/creation.test.ts:138`, which pins the duplicate guard inside `src/shielded/creation.ts:264-268`, not the `sendTransaction` one. The 32-output bound is pinned only at the header/`Transaction.validate` layers.
- The B.12 failure test (`__tests__/integration/shielded_outputs/utxo_selector.test.ts:319-403`) exercises only a pre-crypto build failure (amount > available); no test covers a crypto-stage failure.

## Source of truth

- hathor-core:hathor-ct-crypto/src/rangeproof.rs:15-16 — `RANGE_PROOF_BITS: usize = 40`; doc comment (lines 8-14): "Using a constant ensures all proofs are the same size regardless of the committed value, preventing proof-size side-channels. 40 bits covers values up to 2^40 − 1 ... Borromean proofs at 40 bits are ~3213 bytes."
- hathor-core:hathor-ct-crypto/src/rangeproof.rs:44-53 — `RangeProof::new` called with `min_value = 1` ("reject zero-amount commitments") and `min_bits = RANGE_PROOF_BITS` ("fixed to prevent size side-channel"); `min_bits` is a floor in secp256k1-zkp, hence the silent widening above 2^40.
- hathor-core:hathor-ct-crypto/src/rangeproof.rs:85-103 — `verify_range_proof` enforces only `range.start >= 1`; no upper bound on the proven range width.
- hathor-core:hathor/verification/transaction_verifier.py:800-827 — `verify_range_proofs` raises only generic `InvalidRangeProofError`; the node gives no graceful "value too large" error.
- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:24 — `MAX_RANGE_PROOF_SIZE = 3328  # Borromean @ 40-bit: 3213 B + headroom`; the deserializer's size cap is the node's only effective ceiling, and it bites post-broadcast.
- Client guide: `SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md:57` lists the range-proof value envelope as a wallet-side concern. Its `[1, 2^64)` figure is RFC-era (Bulletproofs); the shipped core uses 40-bit Borromean proofs, and per review rules core wins.

Since the node enforces no graceful 40-bit check, keeping shielded values within bounds is necessarily a wallet responsibility — and wallet-lib currently neither enforces nor tests it.

## Impact

HTR amounts cannot realistically reach 2^40 (~1.1e12 base units ≈ 11 billion HTR), but custom-token amounts go up to 2^63, so a holder shielding a large supply in one output can plausibly cross 2^40. Concretely:

- For values in (2^40, ~2^42): wallet-lib builds, signs, and broadcasts; the node accepts; the output's range proof is larger than every uniform 3213-byte proof on the chain, leaking the value's magnitude class for that user and weakening the uniformity property for everyone else. Self-inflicted by the sender, no funds at risk.
- For values ≥ ~2^42: the user pays the full build cost and gets a post-broadcast node-side deserialization rejection with no actionable client error.
- No funds or storage state are at risk: a crypto-stage failure occurs before any UTXO is marked as selected in storage (see Verification notes), so the impact is confined to error UX, a privacy edge case, and missing test coverage. A future ct-crypto version bump changing the silent-widening behavior would also regress undetected.

## Recommendation

1. Add a client-side bound enforced before crypto work, next to the existing count guards:

   ```ts
   // src/constants.ts
   /** Range proofs are pinned at 40 bits (hathor-core RANGE_PROOF_BITS).
    *  With min_value = 1, the largest value provable with a uniform-size proof is 2^40. */
   export const MAX_SHIELDED_VALUE: OutputValueType = 2n ** 40n;

   // src/new/sendTransaction.ts (with the count guards at :505-515) and/or the
   // upfront-validation loop in src/shielded/creation.ts (:270+)
   if (def.value < 1n || def.value > MAX_SHIELDED_VALUE) {
     throw new SendTxError(
       `Shielded output value must be in [1, 2^40] (got ${def.value}); ` +
         `range proofs are fixed at 40 bits. Split the amount across multiple outputs.`
     );
   }
   ```

2. Add unit tests pinning the boundary: `2^40` passes the guard; `2^40 + 1n` and `0n` are rejected client-side with the clear message before any provider call (assert with a mock provider that `createAmountShieldedOutput` was never invoked). Optionally an integration test confirming the node accepts a `2^40` output end-to-end.
3. Add a unit test at the `sendTransaction` layer asserting a 33-output request is rejected with the `Cannot create more than 32 shielded outputs` message (`src/new/sendTransaction.ts:510-515`), currently asserted nowhere.
4. Defense-in-depth: add a `MAX_RANGE_PROOF_SIZE` assertion in `ShieldedOutput.serialize()` (`src/models/shielded_output.ts:92-116`) so any future provider producing an oversized proof fails locally instead of post-broadcast.

## Verification notes

The skeptic panel confirmed the headline claim and adjusted two sub-claims:

- **Confirmed:** exhaustive grep over wallet-lib `src/` and `__tests__/` for any 2^40 constant or named bound is empty; `proposal.value` flows unchecked from the public API to the crypto provider; max tested shielded value is `80_000_000n`; the `'Cannot create more than'` message has zero test assertions; the node raises only generic `InvalidRangeProofError`.
- **Empirically pinned (caveat confirmed):** the original hypothesis was an "opaque Rust throw" for values ≥ 2^40. Running the installed `@hathor/ct-crypto-node` binding shows only `0` throws; over-limit values silently produce wider proofs (3309 B at 41 bits — under the 3328-byte cap and verifying true; 3373 B at 42 bits — over the cap, rejected only at node deserialization). The failure mode is therefore a silent proof-size privacy leak (41-bit range) or a late post-broadcast rejection (≥ ~2^42), not a clean client error — which supports the finding's substance.
- **Refuted (drove severity medium → low):** the claim that a crypto-stage throw strands UTXOs in marked-as-selected state is wrong on mechanics. UTXO selection in `prepareTxData` (`bestUtxoSelection` via `_prepareSendTokensData`, `src/new/sendTransaction.ts:1132-1160`) builds only in-memory tx data; `storage.utxoSelectAsInput` is reachable only via `updateOutputSelected` (`:983, :1006`), first invoked in `mineTx` (`:763`), and `run()` (`:932-952`) orders `prepareTx` — which contains `createShieldedOutputs` (`:517`) — before `mineTx`. A crypto-stage failure marks nothing, so no selected-UTXO cleanup test is needed and no fund/state corruption is possible.
- **Verdict:** real missing-test plus missing client-side guard with a genuine privacy edge, but self-inflicted, requiring custom-token amounts above ~1.1e12 base units, and with the state-corruption angle refuted — impact is UX/coverage, hence low.
