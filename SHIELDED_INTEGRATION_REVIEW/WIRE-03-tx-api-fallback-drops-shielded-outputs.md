# WIRE-03: Combined output-index space not honored on the tx-API fallback path: shielded-spending inputs are rejected by a transparent-only bounds check and `convertFullNodeTxToHistoryTx` drops `shielded_outputs`

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

When `convertTransactionToHistoryTx` cannot find a spent transaction in local storage, it fetches it from the fullnode's `/transaction` API. On that fallback path it bounds-checks the input index against only the transparent `outputs` array, ignoring `shielded_outputs` — but in core's combined index space, every input that spends a shielded output has `index >= len(outputs)`, so such inputs are always rejected with "Index outside of tx output array bounds". Even if the check were widened, the converter `convertFullNodeTxToHistoryTx` never copies `tx.shielded_outputs` into the resulting `IHistoryTx`, so the downstream slot-resolution logic could not find the shielded entry anyway. The practical consequence is that the sender-local insert after a successful push fails (silently, since it runs in a fire-and-forget IIFE) whenever the spent parent tx is not in storage.

## Location

- `src/utils/transaction.ts:1111-1113` — transparent-only bounds check on the API fallback of `convertTransactionToHistoryTx`
- `src/utils/transaction.ts:1580-1625` — `convertFullNodeTxToHistoryTx` maps `tx.inputs`/`tx.outputs` but never `tx.shielded_outputs`
- `src/api/schemas/txApi.ts:150` — the Zod schema does parse `shielded_outputs` from the API response, so the data is available and then dropped
- `src/utils/transaction.ts:139-157` — `findSpentOutput` only inspects `parentTx.outputs`, so the dropped array cannot be recovered downstream
- `src/template/transaction/interpreter.ts:281` — second caller of `convertFullNodeTxToHistoryTx` affected by the same drop
- `src/new/sendTransaction.ts:839-850` — fire-and-forget caller where the rejection is swallowed

## Details

### Leg 1: the bounds check

`convertTransactionToHistoryTx` (`src/utils/transaction.ts:1084`) iterates the tx's inputs and resolves each spent parent tx. When the parent is not in `storage` (and not in the per-call cache), it falls back to `txApi.getTransaction` and applies this check on the response:

```ts
// src/utils/transaction.ts:1111-1113
if (input.index >= response.tx.outputs.length) {
  return reject(new Error('Index outside of tx output array bounds'));
}
```

The fullnode serializes shielded outputs as a *separate* top-level `shielded_outputs` JSON key, not inside `outputs` (see "Source of truth" below), and an input spending a shielded output carries the combined index `len(outputs) + shielded_array_idx`. So `input.index >= response.tx.outputs.length` is true for **every** shielded-spending input of an API-fetched parent, and the promise rejects before `convertFullNodeTxToHistoryTx` is even called. The wallet's own schema parses the field (`src/api/schemas/txApi.ts:150`: `shielded_outputs: fullnodeTxApiShieldedOutputSchema.array().nullish()`), and no transform in `src/api/txApi.ts` merges shielded outputs into `outputs`, so the correct combined length is readily computable at this call site — it just isn't used.

### Leg 2: the converter drops `shielded_outputs`

Even with a corrected bounds check, the converted history tx is unusable for shielded slot resolution. `convertFullNodeTxToHistoryTx` (`src/utils/transaction.ts:1580-1625`) builds the `IHistoryTx` literal from `tx.inputs` and `tx.outputs` only; the object literal at lines 1598-1614 contains no `shielded_outputs` key and `tx.shielded_outputs` is never read anywhere in the function. The result is passed straight to `resolve(...)` at line 1114 without going through `normalizeShieldedOutputs` (`src/utils/transaction.ts:185`), so the base64-encoded proof/script fields of the API representation are also never converted to the hex form the rest of wallet-lib expects.

Downstream, `findSpentOutput` (`src/utils/transaction.ts:139-157`) looks for a shielded entry by `onChainIndex` only inside `parentTx.outputs`. With the shielded array dropped, it returns `undefined`, `isShieldedSlot` is still true (because `input.index >= spentTx.outputs.length`, line 1158), and the code falls back to `storage.getUtxo` at line 1196. On this code path the parent tx was *absent from storage*, so a UTXO record for it is very unlikely to exist, and the function throws:

```ts
// src/utils/transaction.ts:1198-1202
throw new Error(
  `Input ${input.hash}:${input.index} references a shielded slot the wallet ` +
    `has neither decoded into outputs[] (length ${spentTx.outputs.length}) ` +
    `nor stored as a UTXO record — cannot reconstruct the sender-local insert.`
);
```

(In practice the run never gets this far because Leg 1 rejects first; Leg 2 is what would break next after a naive bounds-check fix.)

The same converter is used by the transaction-template interpreter (`src/template/transaction/interpreter.ts:281`), so any template flow that hydrates a parent tx via the API also sees a history tx with its shielded outputs silently missing.

## Source of truth

hathor-core defines a single combined index space over transparent + shielded outputs:

- hathor-core:hathor/transaction/base_transaction.py:347-359 — `resolve_spent_output(index)`: `if index < len(self.outputs): return self.outputs[index]`, else `shielded_idx = index - len(self.outputs)` resolves into `self.shielded_outputs`.
- hathor-core:hathor/transaction/base_transaction.py:361-363 — `is_shielded_output(index)`: `index >= len(self.outputs) and index < len(self.outputs) + len(self.shielded_outputs)`. A shielded-spending input therefore *always* has `index >= len(outputs)`.
- hathor-core:hathor/transaction/base_transaction.py:811-820 — `to_json` emits `data['outputs']` from transparent outputs only and, when present, `data['shielded_outputs']` as a separate key. The `/transaction` resource serializes with `tx.to_json()` (hathor-core:hathor/transaction/resources/transaction.py:62), so the API response the wallet receives matches this shape exactly.

A client honoring core's semantics must treat the valid input-index range as `[0, len(outputs) + len(shielded_outputs))` and must keep `shielded_outputs` available wherever spent-output resolution happens.

## Impact

Concrete scenario: a wallet sends a transaction that spends one of its shielded UTXOs, and the parent tx that created that UTXO is not present in local storage (e.g. storage was cleaned, the wallet is mid-resync, or the per-send `txCache` is cold). After the push succeeds, `SendTransaction` kicks off a sender-local history insert via a fire-and-forget async IIFE (`src/new/sendTransaction.ts:839-850`) with no `catch`: `convertTransactionToHistoryTx` rejects on the bounds check, the rejection is unhandled, and the wallet fails to record its own just-sent transaction. Balances/history stay stale until (and unless) the WebSocket delivery of the same tx compensates. Template-interpreter consumers of `convertFullNodeTxToHistoryTx` additionally get history objects with shielded outputs silently absent.

Severity is medium rather than high because on the common path the parent tx *is* in storage (the input was selected from local UTXOs), so the API fallback is an edge path — but when hit, the failure is both certain and silent.

## Recommendation

Two changes in `src/utils/transaction.ts`:

1. Bounds-check against the combined index space:

```ts
const totalOutputs =
  response.tx.outputs.length + (response.tx.shielded_outputs?.length ?? 0);
if (input.index >= totalOutputs) {
  return reject(new Error('Index outside of tx output array bounds'));
}
```

2. Make `convertFullNodeTxToHistoryTx` carry the shielded outputs into the `IHistoryTx` (with each entry's `onChainIndex` set to `tx.outputs.length + arrayIdx` so `findSpentOutput` can resolve it), and run the result through `normalizeShieldedOutputs` so base64-encoded proof/script fields are converted to the hex representation used everywhere else in wallet-lib. Sketch:

```ts
if (tx.shielded_outputs?.length) {
  histTx.shielded_outputs = tx.shielded_outputs.map((so, i) => ({
    ...so,
    onChainIndex: tx.outputs.length + i,
  }));
  this.normalizeShieldedOutputs(histTx);
}
```

(Exact field mapping should follow whatever shape `normalizeShieldedOutputs` / `findSpentOutput` expect for shielded entries; the key requirements are: don't drop the array, record the on-chain index, and normalize base64 → hex.)

Add a regression test that feeds `convertTransactionToHistoryTx` a tx whose input spends index `len(outputs) + 0` of a parent only reachable via the mocked tx API, asserting the resulting `IHistoryInput` has `type: 'shielded'`.

## Verification notes

The skeptic panel confirmed both legs independently against the worktrees:

- Re-read `src/utils/transaction.ts:1111-1113` and confirmed the check uses only `response.tx.outputs.length`; confirmed via `src/api/schemas/txApi.ts:150` and `src/api/txApi.ts:34-48` that `shielded_outputs` is parsed but never merged into `outputs`, so the rejection is structural, not a serialization quirk.
- Confirmed core's combined index space (`base_transaction.py:347-363`) and separate-key JSON serialization (`base_transaction.py:811-820`, `resources/transaction.py:62` using `tx.to_json()`), so shielded-spending inputs always trip the check.
- Confirmed `convertFullNodeTxToHistoryTx` (`src/utils/transaction.ts:1580-1625`) never reads `tx.shielded_outputs` and that `findSpentOutput` (`:139-157`) only scans `parentTx.outputs`, so the data loss is unrecoverable downstream.
- Noted one nuance versus the original claim: there is a `storage.getUtxo` fallback at `:1196` before the throw at `:1198-1202` that could in principle recover — but on this path the parent tx is absent from storage so the UTXO record is unlikely to exist, and the Leg-1 bounds check rejects first regardless.
- Confirmed the caller at `src/new/sendTransaction.ts:839-850` is an un-caught fire-and-forget IIFE, making the failure silent; and that `src/template/transaction/interpreter.ts:281` shares the converter and therefore the drop. Edge-path frequency (parent usually in storage) supports the medium severity.
