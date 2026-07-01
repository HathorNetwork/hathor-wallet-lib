# STATE-02: onNewTx 'safety net' triggers a full processHistory on every websocket event whenever history contains shielded outputs the wallet can never decode — non-convergent O(N) reprocess per tx

**Severity:** high - **Status:** confirmed by adversarial review

## Summary

After every processed websocket transaction, `onNewTx` scans the entire stored transaction history and re-runs a full `storage.processHistory()` if any stored tx carries `shielded_outputs` but has no decoded shielded entry in `outputs[]`. The condition is intended to retry transient decryption failures, but it is *permanently true* for any tx whose shielded outputs simply belong to other people — which includes the wallet's own sends to external shielded recipients with transparent change. Once one such tx exists, every subsequent websocket event wipes all metadata (`cleanMetadata`) and replays the entire history, forever. The state can never converge because the retry re-runs the exact same ownership check that excluded those outputs in the first place.

## Location

- src/new/wallet.ts:1851-1867 — the safety-net loop and unconditional `processHistory` retry
- src/new/wallet.ts:1811-1815, 1825-1829 — `shieldedNewlyAvailable` uses the same always-false `hasDecoded` test, forcing `processHistory` on metadata-only updates too
- src/new/wallet.ts:929-937 — all websocket history events route through `enqueueOnNewTx`, so the scan runs per event
- src/shielded/processing.ts:105-111 — ownership gate that makes the condition unsatisfiable for third-party outputs
- src/utils/storage.ts:947-1012 — the only code path that appends decoded shielded entries (what `hasDecoded` tests)
- src/utils/storage.ts:468-534 — `processHistory`: `cleanMetadata()` + full chronological replay with nested per-input `getTx`
- src/new/sendTransaction.ts:157 — shielded change is opt-in (`changeShieldedMode=null` default), so the trigger state is reachable on the default send path

## Details

The safety net (src/new/wallet.ts:1851-1867):

```ts
if (!didProcessHistory && this.storage.shieldedCryptoProvider && this.pinCode) {
  let needsRetry = false;
  for await (const storedTx of this.storage.txHistory()) {
    const hasShielded = (storedTx.shielded_outputs?.length ?? 0) > 0;
    if (!hasShielded) continue;
    const hasDecoded = (storedTx.outputs ?? []).some(o =>
      transactionUtils.isShieldedOutputEntry(o)
    );
    if (!hasDecoded) {
      needsRetry = true;
      break;
    }
  }
  if (needsRetry) {
    await this.storage.processHistory(this.pinCode);
  }
}
```

The intent (per the comment at lines 1836-1850) is to recover txs whose decryption transiently failed, e.g. because the recipient address wasn't yet in the address cache. The flaw is that there is no marker distinguishing **"decryption never attempted"** from **"attempted, and none of these outputs are ours."** A grep across `src/` finds no `shieldedProcessedAt` / `shieldedDecodeAttempted` / retry-guard of any kind; the *only* signal is whether a decoded entry exists in `outputs[]`.

Decoded entries are produced solely by the decryption block in `processNewTx` (src/utils/storage.ts:947-1012), which calls `processShieldedOutputs` and pushes one entry per *successfully decrypted, wallet-owned* output. The ownership gate in `processShieldedOutputs` (src/shielded/processing.ts:105-111):

```ts
for (const [idx, shieldedOutput] of shieldedOutputs.entries()) {
  const address = shieldedOutput.decoded?.address;
  if (!address) continue;

  // Check if this address belongs to our wallet
  const addressInfo = await storage.getAddressInfo(address);
  if (!addressInfo) continue;
```

Outputs addressed to anyone else are skipped before any key derivation. Therefore a tx whose shielded outputs are **all** third-party can never gain a decoded entry — not now, not after any number of `processHistory` retries. The safety net's condition is permanently true and `processHistory` fires on **every** subsequent `onNewTx` (all `wallet:address_history` websocket events route through `enqueueOnNewTx`, src/new/wallet.ts:929-937; sender-local inserts take the same path).

`processHistory` is genuinely heavyweight (src/utils/storage.ts:468-534): it calls `store.cleanMetadata()` — wiping all UTXOs, balances, and address/token metadata — and then replays the *entire* history chronologically through `processNewTx`, with a nested `storage.getTx(input.tx_id)` lookup per input of every tx. Cost per websocket event is O(history × inputs), plus KDF-based decryption for each genuinely owned shielded output, forever.

Two adjacent amplifications:

1. **`shieldedNewlyAvailable` false positive** (src/new/wallet.ts:1811-1815, 1825-1829). The update branch uses the same `storedHasDecodedShielded` test, and the merge at lines 1796-1798 copies `shielded_outputs` from storage onto bare re-deliveries. So a metadata-only update (e.g. `first_block` confirmation) of a stuck tx evaluates `!isNewTx && newHasShielded && !storedHasDecodedShielded` to true and routes to `processHistory` through the update branch as well.
2. Each forced `processHistory` re-executes the full-metadata wipe/replay concurrently with normal event handling, re-running and re-exposing the STATE-01 deletion bug on every event.

One nuance for precision: the per-event *crypto* cost is bounded — the ownership gate at processing.ts:111 short-circuits before `deriveScanPrivkeyForAddress` (line 114) for third-party outputs, and already-decoded txs skip the decryption block via the `alreadyDecoded` check (src/utils/storage.ts:950). The dominant recurring cost is the unconditional `cleanMetadata` + O(N) history replay, plus KDF per **owned** shielded output per replay.

## Source of truth

- hathor-core:hathor/verification/transaction_verifier.py:1219-1227 — `verify_trivial_commitment_protection` raises `TrivialCommitmentError` unless a shielded tx has ≥ 2 shielded outputs. Mirrored client-side at src/new/sendTransaction.ts:505-509. Consequence: "pay one external shielded recipient" always yields at least two shielded outputs, and if the wallet's change is transparent (the default — `changeShieldedMode=null`, src/new/sendTransaction.ts:157), *all* of the tx's shielded outputs are third-party, creating the permanently-stuck state in the sender's own history.
- hathor-core's `_shielded_output_to_json` serializer includes `decoded.address` on shielded outputs (hathor-core:hathor/transaction/base_transaction.py:82-114), confirming that the wallet's address-based ownership gate is the sole and correct filter — third-party outputs are *correctly* skipped; it is the retry heuristic that misreads this as failure.
- Nothing in the client integration guide or RFC requires (or anticipates) a full-history reprocess per event; the guide's processing model is per-tx trial-decryption with persisted results.

## Impact

Who: any shielded-enabled wallet (crypto provider + pinCode set, which is every shielded wallet — pinCode is retained at construction, src/new/wallet.ts:387) whose history contains at least one tx where every shielded output belongs to someone else. Two default-path ways to get there:

- **(a) Sender side:** the wallet sends shielded outputs to external recipients with transparent change (the default). The sender-local insert (src/utils/transaction.ts:1257-1287) stores the wire-form `shielded_outputs` with no decoded entries, and no future decryption attempt can ever produce one.
- **(b) Receiver side, no action required:** any incoming tx that pays this wallet transparently while also carrying shielded outputs to third parties.

What goes wrong: from that moment on, *every* websocket event — new txs, confirmations, metadata updates — triggers `cleanMetadata()` plus a full chronological replay of the entire history. For a wallet with thousands of txs this turns each incoming event into seconds of CPU and storage churn that never stops, drains battery on mobile, and keeps the wallet flapping through the `PROCESSING` state. The repeated full-metadata rewrite also widens the race window with concurrent event processing and re-executes the STATE-01 UTXO-deletion bug on each pass. No direct fund loss, hence high rather than critical.

## Recommendation

Make the retry condition convergent by persisting the outcome of a decryption attempt:

1. After the decryption block in `processNewTx` runs (src/utils/storage.ts:947-1012), stamp the stored tx — e.g. `shieldedDecodeAttempted: true` (or `shieldedProcessedAt: <timestamp>` / a count of owned outputs found) on the `IHistoryTx` — *regardless* of whether any output turned out to be owned, and `saveTx` it.
2. Change the safety-net test from `!hasDecoded` to `!hasDecoded && !storedTx.shieldedDecodeAttempted`, so only genuinely never-attempted txs (the transient-failure case the net was written for) trigger a retry. Optionally invalidate the marker when the provider or pin changes.
3. Scope `shieldedNewlyAvailable` (src/new/wallet.ts:1815) to the case where `shielded_outputs` were genuinely absent from the stored copy (`!storageTx.shielded_outputs?.length && newHasShielded`), instead of "present but undecoded" — undecoded-because-not-ours must not look like newly arrived data.
4. Consider retrying only the specific stuck tx(s) via `processNewTx` rather than a global `processHistory`, and add a debounce/max-retry guard as defense in depth.

Sketch for the marker check:

```ts
const hasDecoded = (storedTx.outputs ?? []).some(o => transactionUtils.isShieldedOutputEntry(o));
if (!hasDecoded && !storedTx.shieldedDecodeAttempted) {
  needsRetry = true;
  break;
}
```

## Verification notes

Confirmed independently by three reviewers; all converged:

1. The safety-net code exists verbatim at src/new/wallet.ts:1851-1867 and runs after every `onNewTx`; all websocket history events route through `enqueueOnNewTx` (src/new/wallet.ts:929-937). Grep across `src/` finds no decode-attempt marker, debounce, or retry guard of any kind.
2. The condition is permanently true for third-party-only shielded txs: src/shielded/processing.ts:105-111 skips non-wallet addresses before derivation, and src/utils/storage.ts:947-1012 is the only code that appends decoded entries — nothing else can ever satisfy `hasDecoded`.
3. The trigger state is reachable on default paths: hathor-core mandates ≥ 2 shielded outputs (transaction_verifier.py:1219-1227), shielded change is opt-in (src/new/sendTransaction.ts:157), and the sender-local insert stores wire-form `shielded_outputs` without decoded entries (src/utils/transaction.ts:1257-1287). The receiver-side variant requires no action by this wallet at all.
4. Non-convergence and cost verified: `processHistory` (src/utils/storage.ts:468-534) is `cleanMetadata()` + full chronological replay with per-input `getTx`; the replay re-runs the same ownership gate and can never decode non-owned outputs.
5. The `shieldedNewlyAvailable` false positive was verified at src/new/wallet.ts:1811-1815/1825-1829, including the shielded_outputs merge at 1796-1798 that makes metadata-only re-deliveries also trip it.
6. One overstatement in the original finding was corrected: the "KDF per shielded output per tx" cost claim is too strong — the ownership gate short-circuits before key derivation for non-owned outputs (processing.ts:110-114), and already-decoded txs skip the decryption block (src/utils/storage.ts:950). The dominant recurring cost is the O(history) metadata wipe + replay per event, which stands. Severity high confirmed: permanent per-event full reprocess with metadata-rewrite races (and per-event re-execution of STATE-01), but no direct fund loss.
