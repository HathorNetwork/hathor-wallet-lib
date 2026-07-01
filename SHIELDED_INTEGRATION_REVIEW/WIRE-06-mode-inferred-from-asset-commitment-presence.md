# WIRE-06: normalizeShieldedOutputs infers mode from `asset_commitment` presence, ignoring the node's canonical `mode` discriminator

**Severity:** info - **Status:** confirmed by adversarial review

**Also reported as:** a second WIRE-06 write-up (mode inferred from asset_commitment) — duplicate deleted; no materially unique evidence.

## Summary

When `normalizeShieldedOutputs` extracts shielded entries that arrive nested inside `outputs[]` (the legacy `to_json_extended` shape), it derives `mode` from whether `asset_commitment` is present, discarding the explicit integer `mode` field the node now sends and that hathor-core's serializer docstring explicitly designates as the canonical discriminator. With today's two modes (1 = AmountShielded, 2 = FullShielded) the inference produces identical results, so nothing is currently broken — but any future mode value would be silently coerced to 1 or 2 and fed into the wrong rewind path instead of being rejected. A secondary, related hygiene point: `ensureHex` distinguishes base64 from hex purely by character set rather than by per-field knowledge of the documented wire encodings.

## Location

- `src/utils/transaction.ts:192-195` — `mode` inferred from `asset_commitment` presence in case (a) extraction
- `src/utils/transaction.ts:260-266` — `ensureHex` character-set heuristic
- `src/types.ts:339-361` — `IShieldedOutputEntry` (the nested-in-`outputs[]` wire entry type) does not declare `mode`, so the node-sent value is invisible to the extraction code
- `src/api/schemas/txApi.ts:104` and `src/schemas.ts:182` — zod schemas DO accept `mode: z.number().optional()`, so the value survives parsing and is then dropped
- `src/shielded/processing.ts:130-131` — the downstream consumer that already implements the correct prefer-explicit-mode pattern, but only sees what the normalizer produced

## Details

`normalizeShieldedOutputs` handles two delivery shapes. In case (a) — shielded entries nested inside `tx.outputs[]` with `type: 'shielded'` — the extraction synthesizes each `IHistoryShieldedOutput` like this (`src/utils/transaction.ts:192-204`):

```ts
shieldedEntries.push({
  mode: output.asset_commitment
    ? ShieldedOutputMode.FULLY_SHIELDED
    : ShieldedOutputMode.AMOUNT_SHIELDED,
  commitment: this.ensureHex(output.commitment),
  ...
```

The node serializes an explicit `'mode': output.mode().value` on every shielded entry, but the wallet's nested-entry type `IShieldedOutputEntry` (`src/types.ts:339-361`) does not even declare a `mode` field, so the extraction code never reads it. The zod schemas at `src/api/schemas/txApi.ts:104` and `src/schemas.ts:182` both accept `mode: z.number().optional()`, meaning the value is parsed and available at runtime — the normalizer simply overwrites it with the inference.

Case (b) (a separate `shielded_outputs[]` array, `src/utils/transaction.ts:230-247`) does the opposite: it preserves whatever `mode` the node sent untouched and only hex-converts the byte fields.

Downstream, `src/shielded/processing.ts:128-131` already implements the recommended pattern:

```ts
const isFullShielded =
  shieldedOutput.mode === ShieldedOutputMode.FULLY_SHIELDED ||
  (shieldedOutput.mode === undefined && !!shieldedOutput.asset_commitment);
```

But for case-(a) transactions, this code only ever sees the normalizer's re-inferred 1/2, never the node's value. And note the boolean shape: for case (b), a hypothetical unknown mode (e.g. 3) passes through the normalizer intact, then evaluates `isFullShielded === false` here and is routed to `rewindAmountShieldedOutput` — i.e. misclassified rather than rejected in both shapes.

The wallet's enum values match core exactly (`node_modules/@hathor/ct-crypto-provider/src/types.ts:11-14`: `AMOUNT_SHIELDED = 1`, `FULLY_SHIELDED = 2`), and core only emits `asset_commitment` for FullShielded outputs, so the inference is provably equivalent to the discriminator for all transactions today.

**Secondary point — `ensureHex` (`src/utils/transaction.ts:260-266`):** detection is purely character-set based (`/^[0-9a-fA-F]+$/` → already hex, anything else → decode as base64). Core's `_shielded_output_to_json` documents fixed per-field encodings: `commitment`/`ephemeral_pubkey`/`asset_commitment` are hex; `range_proof`/`script`/`surjection_proof` are base64. A base64 payload composed entirely of hex-alphabet characters would be misdetected as hex, but the probability is roughly `(22/64)^len` (22 of 64 base64 symbols are hex characters), which is negligible (≲ 1e-15) for these field sizes. Safe in practice, but the safety argument lives only in comments — a small test pinning the assumption would anchor it.

## Source of truth

hathor-core's serializer is explicit that consumers must use `mode`, not infer it:

- hathor-core:hathor/transaction/base_transaction.py:85-91 (docstring of `_shielded_output_to_json`): "The `mode` field is the int value of `OutputMode` ... (1 = AmountShielded, 2 = FullShielded ...). It is the canonical mode discriminator on the wire; downstream consumers should rely on it instead of inferring mode from the presence of `asset_commitment`/`surjection_proof`."
- hathor-core:hathor/transaction/base_transaction.py:96 — `'mode': output.mode().value` is sent on every shielded entry.
- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:30-34 — `OutputMode` currently defines only `AMOUNT_ONLY = 1` and `FULLY_SHIELDED = 2` (plus `TRANSPARENT = 0`, never serialized as a shielded entry), and `asset_commitment` is emitted iff the output is a `FullShieldedOutput` (base_transaction.py:103-106). This is why the inference is equivalent today.

## Impact

No current bug — for every transaction a present-day node can produce, the inferred mode equals the wire mode. This is forward-compatibility hygiene:

- If hathor-core ever adds a mode 3 (or any new variant), case-(a) normalization would silently relabel it as 1 or 2 depending on `asset_commitment` presence, and case-(b) entries would reach `processing.ts` with `mode: 3` and be routed to the AmountShielded rewind path. Either way the wallet would attempt the wrong unblinding instead of failing loudly with "unknown shielded output mode", producing confusing downstream errors (rewind failures, wrong balances) that are hard to trace back to a protocol version skew.
- The `ensureHex` heuristic affects no one today; it is listed only as a comment-anchored assumption worth a regression test.

## Recommendation

1. In the case-(a) extraction (`src/utils/transaction.ts:192-195`), prefer the node's discriminator and fall back to inference only for pre-mode nodes:

```ts
mode: output.mode ?? (output.asset_commitment
  ? ShieldedOutputMode.FULLY_SHIELDED
  : ShieldedOutputMode.AMOUNT_SHIELDED),
```

   This requires adding `mode?: ShieldedOutputMode` to `IShieldedOutputEntry` in `src/types.ts` (the zod schemas already accept it).

2. In `src/shielded/processing.ts:128-131`, replace the boolean `isFullShielded` with an explicit three-way resolution that rejects (or skips with a logged warning) any `mode` value that is neither 1, 2, nor `undefined`, instead of defaulting unknown modes to the AmountShielded path.

3. Optionally, add a small unit test for `ensureHex` documenting the per-field encodings core emits (commitment/ephemeral_pubkey hex; range_proof/script/surjection_proof base64) and asserting round-trip idempotence, so the character-set heuristic's safety assumption is pinned by a test rather than only by comments.

## Verification notes

The skeptic panel confirmed all elements of the finding:

1. **Code as described:** `src/utils/transaction.ts:193-195` reads exactly `mode: output.asset_commitment ? ShieldedOutputMode.FULLY_SHIELDED : ShieldedOutputMode.AMOUNT_SHIELDED` in the case-(a) branch; `IShieldedOutputEntry` declares no `mode` field while both zod schemas accept it optionally — so the node-sent value is parsed, available, and dropped.
2. **Source of truth verbatim:** the core docstring at base_transaction.py:85-91 says consumers "should rely on it instead of inferring mode from the presence of asset_commitment/surjection_proof", and `'mode': output.mode().value` is unconditionally serialized.
3. **Equivalence today:** core's `OutputMode` has only values 1 and 2 for shielded entries, `asset_commitment` is emitted iff FullShielded, and the wallet enum values match (ct-crypto-provider types.ts:11-14) — confirming info severity, not a live bug.
4. **Nuance verified:** `src/shielded/processing.ts:130-131` already implements the prefer-explicit-mode fallback, but the case-(a) normalizer overwrites `mode` before processing sees it; case (b) preserves the node's mode. A hypothetical mode 3 is misrouted in both shapes (re-inferred in (a); `isFullShielded === false` → AmountShielded rewind in (b)), so "silently misclassified as AmountShielded" holds.
5. **ensureHex verified:** pure character-set detection at transaction.ts:260-266; per core's documented encodings, misdetection requires a base64 payload entirely within the hex alphabet — probability `(22/64)^len`, negligible at these field sizes.
