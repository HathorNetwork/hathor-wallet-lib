# STATE-01: Voided/reorged spending txs permanently destroy the wallet's UTXO records: unconditional input-delete loop in processHistory + irreversible local spent_by stamping

**Severity:** high - **Status:** confirmed by adversarial review

## Summary

Two mechanisms added by this branch break the wallet's ability to recover a UTXO after the transaction that spent it is voided (double-spend conflict resolution or reorg). First, `processHistory` now runs a per-tx input-deletion loop for **every** tx in history — including voided ones — so a voided spender deletes the origin tx's perfectly-unspent UTXO on every reprocess, even after a full wipe-and-resync. Second, `processNewTx` now locally stamps `spent_by` onto the stored origin tx and persists it, with no code path that ever clears the stamp when the spender is voided; the `spent_by === null` gate then permanently blocks UTXO re-creation. The result is a wallet that shows a balance it cannot spend, for both transparent and shielded UTXOs (shielded entries cannot even be healed by fullnode redelivery).

## Location

- src/utils/storage.ts:511-533 — unconditional input-delete loop inside `processHistory`'s history iteration (no `is_voided` guard)
- src/utils/storage.ts:905-911 — `processNewTx`'s voided early-return (does NOT protect the loop above, which runs after it)
- src/utils/storage.ts:1259-1272 — local `origOutput.spent_by = tx.tx_id` stamping + `store.saveTx(origTx)`, with no reversal path
- src/utils/storage.ts:1105 — `if (output.spent_by === null)` gates UTXO re-creation during reprocess
- src/storage/memory_store.ts:1121-1126 — `cleanMetadata` wipes utxos/metadata but NOT `this.history`, so stamps survive every reprocess
- src/new/wallet.ts:1785-1798 — shielded decoded-entry merge preserves the stale stamp across fullnode redelivery
- src/new/wallet.ts:1825-1830 — voided-state changes route to `processHistory`, the path that can no longer resurrect the UTXO

## Details

### Mechanism 1: unconditional input-delete loop in processHistory

`processHistory` iterates the full stored history and calls `processNewTx` per tx. `processNewTx` correctly ignores voided txs (src/utils/storage.ts:905-911):

```ts
  // We ignore voided transactions
  if (tx.is_voided)
    return { ... };
```

But the new input-deletion loop added right after the `processNewTx` call inside the iteration has no such guard (src/utils/storage.ts:511-533):

```ts
  for await (const tx of store.historyIter(undefined, { order: 'asc' })) {
    const processedData = await processNewTx(storage, tx, { ... });
    ...
    for (const input of tx.inputs) {
      const origTx = await storage.getTx(input.tx_id);
      if (!origTx) continue;
      ...
      const output = transactionUtils.findSpentOutput(origTx, input.index);
      if (!output?.decoded?.address) continue;
      if (!(await storage.isAddressMine(output.decoded.address))) continue;
      await store.deleteUtxo({ txId: input.tx_id, index: input.index, ... });
    }
  }
```

`historyIter` yields voided txs unfiltered, and nothing ever removes voided txs from stored history. So the sequence on any `processHistory` run is: `cleanMetadata` wipes the UTXO map → the origin tx's `processNewTx` re-saves the UTXO → the (voided) spender's iteration deletes it again. A diff against master confirms this loop is a new addition: master's `processHistory` had no input deletion at all (the only delete loop lived in `processSingleTx`, the live-tx path, which is never invoked for voided history entries). Because the fullnode's address history includes voided txs, even a fresh sync from scratch with one voided spend of an own output reproduces the deletion.

### Mechanism 2: irreversible local spent_by stamping

`processNewTx` now mutates the **stored origin tx** when processing a spender (src/utils/storage.ts:1259-1272):

```ts
  const dirtyOrigTxs = new Map<string, IHistoryTx>();
  for (const input of tx.inputs) {
    const origTx = dirtyOrigTxs.get(input.tx_id) ?? (await store.getTx(input.tx_id));
    ...
    origOutput.spent_by = tx.tx_id;
    dirtyOrigTxs.set(input.tx_id, origTx);
  }
  for (const origTx of dirtyOrigTxs.values()) {
    await store.saveTx(origTx);
  }
```

This is the only local writer of `spent_by` in src/ (repo-wide grep), and there is no code anywhere that clears it when the recorded spender becomes voided. The stamp is persisted into history, which `cleanMetadata` deliberately does not wipe (src/storage/memory_store.ts:1121-1126). On the next reprocess, the UTXO-rebuild gate skips the stamped output (src/utils/storage.ts:1103-1105):

```ts
    // Add utxo to the storage if unspent
    // This is idempotent so it's safe to call it multiple times
    if (output.spent_by === null) {
```

So even if mechanism 1 were fixed, the stamped origin output would never have its UTXO re-created.

### Why redelivery cannot heal it (shielded outputs)

For transparent outputs, a fullnode redelivery of the origin tx (with the correct `spent_by = null`, see Source of truth) would overwrite the stamp via `addTx`. hathor-core's address index does republish a tx when its `spent_by` changes (`has_spent_by_changed_since_last_call`, hathor/indexes/address_index.py:55-69), and the wallet routes that to `processMetadataChanged` — a transient heal. But the voided spender remains in stored history forever, so the **next** `processHistory` run (any voided change, the shielded decryption safety-net at src/new/wallet.ts:1836+, or a wallet restart) re-deletes the UTXO via mechanism 1 with no fresh republish to heal it.

For shielded outputs even the transient heal is impossible: the decoded entry's `spent_by` is set once at decode time, and the `onNewTx` merge logic deliberately preserves the **stored** decoded entries over the wire payload (src/new/wallet.ts:1785-1791):

```ts
      const storedDecoded = (storageTx.outputs ?? []).filter(o =>
        transactionUtils.isShieldedOutputEntry(o)
      );
      const alreadyOnNewTx = newTx.outputs.some(o => transactionUtils.isShieldedOutputEntry(o));
      if (storedDecoded.length > 0 && !alreadyOnNewTx) {
        newTx.outputs.push(...storedDecoded);
      }
```

A redelivered origin tx carrying `spent_by = null` from the fullnode therefore keeps the stale stamped entry.

### The visible inconsistency

The per-output balance credit in `processNewTx` is applied unconditionally **before** the `spent_by` gate (src/utils/storage.ts:1066-1101), and the voided spender contributes no debit (its `processNewTx` early-returns). So after the spender is voided the wallet reports the funds in its balance, but the corresponding UTXO record is gone (mechanism 1) and can never be rebuilt (mechanism 2). UTXO selection finds nothing to spend; the wallet displays a phantom balance until a full storage wipe plus a sync against a fixed client.

## Source of truth

hathor-core defines `spent_by` as the **non-voided** spender only — a voided spender does not count (hathor-core:hathor/transaction/transaction_metadata.py:142-154):

```python
    def get_output_spent_by(self, index: int) -> Optional[bytes]:
        ...
        for h in spent_set:
            tx2 = tx.storage.get_transaction(h)
            tx2_meta = tx2.get_metadata()
            if not bool(tx2_meta.voided_by):
                # There may be only one spent_by.
                assert spent_by is None
                spent_by = tx2.hash
        return spent_by
```

So once the spender is voided, core reports the origin output's `spent_by` as null again and republishes the origin tx via the address index (`has_spent_by_changed_since_last_call`, hathor-core:hathor/transaction/transaction_metadata.py:157-165 / hathor/indexes/address_index.py:55-69). The wallet's local stamp directly contradicts core semantics, with no reconciliation path; and during initial sync the origin tx is delivered with `spent_by = null` already, so a history containing one voided spend hits the bug through mechanism 1 alone.

## Impact

- **Who:** any wallet (transparent or shielded) whose history contains a tx that spent its own UTXO and was later voided. Voided txs are routine in Hathor — every double-spend conflict resolution and every reorg produces them, and initial sync delivers them as part of address history.
- **What:** the spent-then-resurrected UTXO is deleted from the UTXO set on every `processHistory` and is never rebuilt, while the balance still includes it. The wallet shows funds it cannot select for spending ("insufficient funds" / missing UTXOs on send despite a positive balance).
- **Recovery:** none within this client. A full wipe-and-resync re-triggers mechanism 1 (voided spender is in fullnode history). For shielded outputs, fullnode redelivery of the origin tx is also ignored due to the decoded-entry merge. Funds are not lost on-chain — a different/fixed client can spend them — hence high rather than critical.

## Recommendation

1. **Gate the processHistory delete loop on voided status** — one-line guard at src/utils/storage.ts:511:

   ```ts
   if (!tx.is_voided) {
     for (const input of tx.inputs) { ... deleteUtxo ... }
   }
   ```

2. **Make the local spent_by stamp reversible** — either:
   - On a voided-state change for tx T, scan stored origin txs whose outputs have `spent_by === T.tx_id` and reset them to `null` before reprocessing; or
   - Preferably, stop mutating persisted history: keep the locally-inferred spent-by in a separate, rebuildable metadata map (wiped by `cleanMetadata`), and let persisted `spent_by` reflect only fullnode-provided values — which already follow core's voided-aware semantics.

3. **For shielded entries**, ensure whichever fix is chosen also refreshes the decoded entries' `spent_by` (the merge at src/new/wallet.ts:1785-1798 must not pin a stale stamp across redelivery).

4. **Regression test** (unit, against MemoryStore): receive UTXO → spend it (own tx) → deliver the spender again with `is_voided: true` → run the voided-update path (`processHistory`) → assert the original UTXO is selectable again and `getBalance` matches the UTXO set. Repeat for a shielded UTXO.

## Verification notes

Confirmed independently by three reviewers via static trace (review worktree has no node_modules; the recommended regression test was not executed, but the code chain is unambiguous):

- The delete loop (src/utils/storage.ts:511-533) was traced to run inside `historyIter` for every tx with no `is_voided` guard; `memory_store.historyIter` yields voided txs unfiltered and `deleteUtxo` deletes by `txId:index` key unconditionally. `git diff master...HEAD` confirms both the loop and the stamping block are new on this branch (master's only delete loop was in `processSingleTx`, never invoked on the voided path).
- Repo-wide grep confirms storage.ts:1267 is the only local `spent_by` assignment and that no code clears it; `cleanMetadata` does not touch history, and the rebuild gate at storage.ts:1105 skips stamped outputs permanently.
- hathor-core's `get_output_spent_by` excluding voided spenders (transaction_metadata.py:150) confirms the local stamp diverges from core semantics with no reconciliation.
- One nuance: for transparent outputs the real-time void path can be transiently healed by core's address-index republish (`processMetadataChanged` re-saves the UTXO when wire `spent_by === null`), but the voided spender stays in history forever, so the next `processHistory` re-deletes it — end state matches the finding.
- Balance inconsistency confirmed: output credit at storage.ts:1066-1101 precedes the `spent_by` gate and the voided spender's debit is skipped, yielding a credited balance with no selectable UTXO.
- Severity high agreed: funds shown but unspendable, routine trigger, not fixable by resync in this client; not critical because funds remain spendable on-chain by a corrected implementation.
