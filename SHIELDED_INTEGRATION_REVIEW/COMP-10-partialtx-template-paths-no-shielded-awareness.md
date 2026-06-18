# COMP-10: PartialTx (atomic swap) and transaction-template paths have no shielded awareness

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

The shielded-outputs integration never touched the multi-party PartialTx (atomic swap) subsystem or the transaction-template engine: a grep for `shielded` over `src/models/partial_tx.ts` and `src/template/` returns zero hits, and `git diff master...HEAD` for those paths is empty. Templates therefore cannot emit shielded outputs or the new headers, and the template engine resolves spent outputs by positional indexing into local history — the exact pattern the new `transactionUtils.findSpentOutput` helper was added to replace for shielded-bearing parents. Worse, every template output instruction silently downgrades a shielded address into a transparent P2PKH script via `createOutputScriptFromAddress`. The PartialTx side mostly fails closed (its swap output builder throws on shielded addresses and its fullnode validation rejects out-of-range shielded indices), so this is recorded as a scoping gap with confusing-failure/silent-downgrade modes in the template engine rather than a bug in the primary send/receive flows.

## Location

- src/models/partial_tx.ts (whole file — no shielded handling; positional output checks at lines 483–486)
- src/template/transaction/executor.ts:148-153 (positional `origTx.outputs[index]` on local-history tx), 401, 474, 645, 978, 1072 (`createOutputScriptFromAddress` call sites)
- src/template/transaction/utils.ts:52 (change-output script via `createOutputScriptFromAddress`)
- src/template/transaction/context.ts:130-134 (`addBalanceFromUtxo` positional lookup)
- src/template/transaction/interpreter.ts:268-284 (`getTx` prefers wallet local history)
- src/utils/address.ts:144-149 (shielded → transparent P2PKH silent downgrade)
- src/wallet/partialTxProposal.ts:213-222 (swap output builder — fails fast, for contrast)
- src/utils/transaction.ts:139-157 (`findSpentOutput`, the sparse-decode-aware helper the above paths do not use)

## Details

### Neither subsystem was extended

```
$ grep -rn 'shielded' src/models/partial_tx.ts src/template/
(no hits, exit 1)
$ git diff master...HEAD --stat -- src/models/partial_tx.ts src/template/ src/wallet/partialTxProposal.ts
(empty)
```

The template instruction set has no shielded output/header instructions, so templates cannot construct a `ShieldedOutputsHeader` or shielded recipients at all. PartialTx serialization (`serialize`/`deserialize`) also carries no shielded data, so blinding factors and ephemeral keys could not be exchanged between swap parties even if outputs could be added.

### Template engine: wrong-output resolution hazard on shielded-bearing parents

The wallet's local history stores shielded-bearing parents in "sparse decode" form: shielded entries live in `outputs[]` with their on-chain position recorded in `onChainIndex`, so positional `outputs[i]` is not safe. The main pipeline was fixed with `transactionUtils.findSpentOutput` (src/utils/transaction.ts:139-157), whose doc comment spells out the failure modes of positional access: wrong token-meta debit, wrong UTXO deletion key, signing with the wrong spend key. The template engine does not use it:

```ts
// src/template/transaction/executor.ts:148-153 (execRawInputInstruction)
const origTx = await interpreter.getTx(txId);
// Cache the tokenVersion via addToken
const { token } = origTx.outputs[index];   // positional
...
ctx.balance.addBalanceFromUtxo(origTx, index);
```

```ts
// src/template/transaction/context.ts:130-134
addBalanceFromUtxo(tx: IHistoryTx, index: number) {
  if (tx.outputs.length <= index) {
    throw new Error('Index does not exist on tx outputs');
  }
  const output = tx.outputs[index];        // positional
```

`interpreter.getTx` (src/template/transaction/interpreter.ts:268-284) prefers `this.wallet.getTx(txId)` — i.e. the LOCAL history entry, exactly the sparse-decode structure `findSpentOutput` exists to handle — before falling back to the fullnode API. So a `RawInputInstruction` referencing an input of a shielded-bearing parent can resolve a different output than the one actually spent (wrong token/value in template balance), or throw a confusing generic error.

### Template engine: silent privacy downgrade for shielded addresses

All template output instructions and the change-output helper build scripts through `createOutputScriptFromAddress` (src/template/transaction/executor.ts:401, 474, 645, 978, 1072; src/template/transaction/utils.ts:52), whose shielded branch does not throw — it silently emits a transparent P2PKH to the embedded spend address:

```ts
// src/utils/address.ts:144-149
if (addressType === 'shielded') {
  // For shielded addresses, derive P2PKH script from spend_pubkey
  const spendAddress = addressObj.getSpendAddress();
  const p2pkh = new P2PKH(spendAddress);
  return p2pkh.createScript();
}
```

That fallback exists for legacy callers, but in the template engine it means a user who passes a shielded address to a template gets a fully transparent output with no error and no confidentiality — a silent downgrade rather than a fail-fast rejection.

### PartialTx side: mostly fails closed (verified, not a wrong-output bug)

Two earlier-claimed PartialTx hazards turned out to be overstated on inspection:

- **Output builder throws.** `PartialTxProposal.addOutput` (src/wallet/partialTxProposal.ts:213-222) switches on `addr.getType()`; shielded addresses (`'shielded'` from src/models/address.ts:144-150) hit the `default: throw new AddressError('Unsupported address type')`. Fail-fast, though with an unspecific message.
- **`PartialTx.validate` fails closed.** It consumes the fullnode `/transaction` API (src/models/partial_tx.ts:472-486), where core's `to_json` serializes shielded outputs into a separate `shielded_outputs` key, leaving the `outputs` array transparent-only and positionally correct for transparent indices. An input spending a shielded slot (index ≥ number of transparent outputs) fails the `data.tx.outputs.length <= input.index` check at line 483 and resolves `false` — it rejects rather than resolving the wrong output.

So the remaining PartialTx gap is the absence of shielded support and of a clear, intentional error message — not data corruption.

## Source of truth

- **Unified input index space.** hathor-core defines a single index space over transparent + shielded outputs; inputs with `index >= len(outputs)` spend shielded slots. `resolve_spent_output` / `is_shielded_output` at hathor-core:hathor/transaction/base_transaction.py:347-363:

  ```python
  def resolve_spent_output(self, index: int) -> 'TxOutput | ShieldedOutput':
      if index < len(self.outputs):
          return self.outputs[index]
      shielded_idx = index - len(self.outputs)
      ...
  ```

  Any wallet-lib path resolving spent outputs purely positionally is therefore wrong for shielded-bearing parents — which is why `findSpentOutput` was added for the main pipeline.

- **Fullnode JSON shape.** `to_json` (hathor-core:hathor/transaction/base_transaction.py:788-818, served by hathor-core:hathor/transaction/resources/transaction.py:62) puts shielded outputs in a separate `shielded_outputs` key; the `outputs` array stays transparent-only. This is what makes `PartialTx.validate`'s positional access safe-but-rejecting for shielded indices.

- **Client integration guide.** The guide's checklist covers send/receive/sync flows; it does not require swap or template support, consistent with treating these as advanced paths that may be deferred — but deferred paths should reject shielded inputs/addresses explicitly rather than misbehave.

## Impact

- **Template users (advanced/headless integrations):**
  - A template that pays a shielded address silently produces a transparent P2PKH output to the spend address — funds arrive but with zero confidentiality, and the user is given no indication of the downgrade.
  - A template input referencing an output of a shielded-bearing parent transaction (from local history) can compute the wrong token/value balance or fail with a generic "Index does not exist on tx outputs" error, with no hint that shielded outputs are the cause.
- **Atomic-swap users:** cannot include shielded value in a swap (expected at this stage), and get only a generic `AddressError('Unsupported address type')` / `validate() === false` when they try. Confusing, but funds-safe: nothing resolves the wrong output or signs the wrong key.
- No primary-flow (send/receive/sync) impact; severity low.

## Recommendation

Short term (validate-and-throw, small diffs):

1. In the template engine, reject shielded addresses explicitly instead of relying on the silent downgrade — e.g. at each `createOutputScriptFromAddress` call site (or via a strict variant of the helper):

   ```ts
   const addr = new Address(address, { network: interpreter.getNetwork() });
   if (addr.isShielded()) {
     throw new TxTemplateError('Shielded addresses are not supported in transaction templates');
   }
   ```

2. Route template spent-output resolution through the existing helper: in `execRawInputInstruction` and `TxBalance.addBalanceFromUtxo`, replace `tx.outputs[index]` with `transactionUtils.findSpentOutput(tx, index)` and throw a descriptive error when it returns `undefined`.

3. In `PartialTxProposal.addOutput` / `PartialTx`, replace the generic default-case throw with an explicit message ("shielded addresses are not supported in atomic swaps") and reject inputs whose index falls in a parent's shielded range with the same clarity (per TODO_FIX_40, already tracked).

Long term: design shielded swap support separately — multi-party shielded outputs require exchanging blinding factors/ephemeral keys between participants and extending PartialTx serialization, which is a protocol-level design task, not a patch.

## Verification notes

The skeptic panel confirmed the core claim and trimmed two sub-claims:

- **Confirmed:** zero `shielded` references in src/models/partial_tx.ts and src/template/ (grep exits 1); `git diff master...HEAD` empty for both paths and src/wallet/partialTxProposal.ts — the integration branch never touched these subsystems.
- **Confirmed:** unified input index space in core (hathor-core:hathor/transaction/base_transaction.py:347-363) makes positional spent-output resolution incorrect for shielded-bearing parents.
- **Confirmed (template hazard):** executor.ts:148-153 and context.ts:130-134 positionally index an `IHistoryTx` that interpreter.ts:268-284 preferentially loads from local wallet history — the sparse-decode structure `findSpentOutput` (src/utils/transaction.ts:139-157) exists to handle and which is not used there.
- **Confirmed (worse than "no guard"):** template output instructions silently downgrade shielded addresses to transparent P2PKH via src/utils/address.ts:144-149.
- **Overstated, corrected:** (a) `PartialTx.validate` consumes the fullnode API whose `outputs` array is transparent-only (shielded outputs live under a separate `shielded_outputs` JSON key), so shielded-spending inputs fail the length check at partial_tx.ts:483 and resolve `false` — fails closed, does not resolve the wrong output; (b) `PartialTxProposal.addOutput` already throws `AddressError('Unsupported address type')` for shielded addresses via its `getType()` switch default (partialTxProposal.ts:213-222).
- Net assessment: real scoping gap with concrete confusing-failure and silent-downgrade modes in the template engine; PartialTx side mostly fails closed. Severity **low** is appropriate.
