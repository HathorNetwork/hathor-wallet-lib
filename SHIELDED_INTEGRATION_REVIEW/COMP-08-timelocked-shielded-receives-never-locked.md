# COMP-08: Timelocked shielded receives are treated as never locked — wallet offers them for spending and builds txs the node rejects

**Severity:** high - **Status:** confirmed by adversarial review (merged severity: the EDGE-01 panel rated this high after explicit debate; the COMP-08/STATE-06 panels independently rated medium)

**Also reported as:** EDGE-01 (timelock dropped when receiving a shielded output, rated high) and STATE-06 (timelocked shielded outputs recorded as unlocked) — merged here.

## Summary

The wallet can *send* timelocked shielded outputs (the timelock is baked into the on-chain script), but on the *receive* side it never learns about that timelock. The fullnode's JSON for shielded outputs decodes only the address — no `timelock` field — and `processNewTx` copies that minimal `decoded` block verbatim instead of parsing the script hex it already holds. Since `isOutputLocked` treats an absent timelock as "unlocked", a timelocked shielded UTXO is stored unlocked, counted as available balance, and offered to the input selector before the lock expires. Any tx built from it fails script verification on the node (`OP_CHECKTIMESTAMPVERIFY`).

## Location

- src/utils/storage.ts:990 — decoded shielded entry built as `decoded: { ...so?.decoded, address: result.address }`; no script parse for timelock
- src/utils/storage.ts:1033 — `isOutputLocked` evaluated against that decoded block
- src/utils/storage.ts:1139 — UTXO persisted with `timelock: output.decoded.timelock || null` → always `null` for fullnode-delivered shielded receives
- src/utils/transaction.ts:305-316 — `isOutputLocked`: `undefined` timelock → unlocked
- src/utils/transaction.ts:1487-1512 — `canUseUtxo` re-checks the same decoded entry, so the whole spend path agrees the UTXO is spendable
- Send side that makes the scenario reachable: src/new/wallet.ts:1997 (`...(o.timelock != null ? { timelock: o.timelock } : {})` in the shielded proposal), src/shielded/creation.ts:326-338 (`timelock: proposal.timelock ?? null` threaded into `createOutputScript`)

## Details

**The send side supports timelocked shielded outputs.** `HathorWallet.sendManyOutputsTransaction` threads a caller-supplied `timelock` into the shielded output proposal (src/new/wallet.ts:1997), and `createShieldedOutputs` bakes it into the on-chain P2PKH script:

```ts
// src/shielded/creation.ts:326-338
const scriptHex = transactionUtils
  .createOutputScript(
    {
      address: proposal.address,
      value: proposal.value,
      timelock: proposal.timelock ?? null,
      ...
    },
    network
  )
  .toString('hex');
```

So a timelocked shielded P2PKH script (with `OP_CHECKTIMESTAMPVERIFY`) is a first-class artifact the library itself produces.

**The receive side drops the timelock.** When `processNewTx` decrypts a wallet-owned shielded output, it appends a synthetic history entry whose `decoded` block is just the fullnode's decoded plus the recovered address:

```ts
// src/utils/storage.ts:985-1008 (excerpt; the decoded line is :990)
tx.outputs.push({
  type: 'shielded',
  value: result.decrypted.value,
  token_data: so?.token_data ?? 0,
  script: so?.script ?? '',
  decoded: { ...so?.decoded, address: result.address },
  ...
});
```

The fullnode's `so.decoded` for a shielded output contains *only* `address` (see Source of truth), so `decoded.timelock` is `undefined` even when the script hex — sitting right there in `so.script` — encodes a timelock. The wallet never parses that script.

**Downstream, undefined means unlocked.** The lock check is:

```ts
// src/utils/transaction.ts:310-315
return (
  output.decoded.timelock !== undefined &&
  output.decoded.timelock !== null &&
  refTs < output.decoded.timelock
);
```

So at src/utils/storage.ts:1033 the output is classified unlocked, the per-token balance credits it as `unlocked` rather than `locked`, and the UTXO record is saved with `timelock: null` (src/utils/storage.ts:1139) — it is never registered in the locked-UTXO index, and the time-based unlock sweep has nothing to do. `canUseUtxo` (src/utils/transaction.ts:1487-1512) re-derives the answer from the same stored `decoded` entry, so UTXO selection happily picks the locked output as a tx input.

**There is no compensating path.** An exhaustive search of the shielded receive pipeline (processing.ts, storage.ts, sync/stream.ts) finds no other place that parses the shielded script into `decoded`. The one path that *does* parse it — `convertTransactionToHistoryTx`'s `shielded_outputs` emission at src/utils/transaction.ts:1259-1272 (`parseScript(so.script, ...)` → `decoded: parsed?.toData()`) — only runs for the **sender's own local insert**, never for the receiving wallet, and the websocket re-delivery of the same tx from the fullnode overwrites history with the fullnode's minimal decoded anyway.

## Source of truth

- **hathor-core emits no timelock in shielded `decoded`.** `_shielded_output_to_json` (hathor-core:hathor/transaction/base_transaction.py:82-113) builds the decoded block as `data['decoded'] = {'address': script_type.address}` — address only, even though `parse_address_script` has the full parsed script (including timelock) in hand. Transparent outputs, by contrast, get a decoded block with `timelock`. A client therefore cannot rely on the node's decoded block for shielded timelocks; it must parse the script itself (the script bytes are always provided).
- **Core accepts timelocked shielded scripts.** `ShieldedTxOutput` constrains the script only by a 1024-byte size cap (hathor-core:hathorlib/transaction/shielded_tx_output.py:27,143 in the vendored hathorlib; mirrored in hathor/transaction/shielded_tx_output.py); there is no restriction to non-timelocked scripts.
- **Core verifies spends of shielded outputs with the same script evaluation as transparent ones.** The verifier resolves an input index past `len(spent_tx.outputs)` into the `shielded_outputs` array and runs the standard `script_eval` on the resolved script (hathor-core:hathor/verification/transaction_verifier.py:140-146, 181-187, 202-203, 226-228). An attempt to spend a timelocked shielded output before its lock raises `InvalidInputData` from `OP_CHECKTIMESTAMPVERIFY`, and the node rejects the transaction.

## Impact

Concrete scenario — both halves use officially supported flows:

1. Wallet A sends Wallet B a shielded output with `timelock = T` (supported via `sendManyOutputsTransaction`'s `timelock` field on a shielded output, wallet.ts:1997 → creation.ts:331).
2. Wallet B receives and decrypts it. Because the fullnode's decoded carries no timelock and wallet-lib doesn't parse the script, B's storage records the UTXO as unlocked.
3. Before `T`: B's balance shows the funds as **available** (wrong — a transparent timelocked receive would show them as locked), and any send that needs them selects this UTXO. The tx is fully built, signed, range-proofed, and pushed — then **rejected by the fullnode** with a script verification error. Depending on the caller, this surfaces as an opaque push failure; the UTXO may also be left marked `selected_as_input`, temporarily wedging the funds until the selection is released.

No funds are lost and no consensus rule is bypassed (the node correctly rejects the spend), which is why this is medium rather than high: the damage is incorrect balance/locked reporting plus node-rejected transactions in a niche but explicitly supported flow.

## Recommendation

In `processNewTx` (src/utils/storage.ts:985-1008), enrich the decoded shielded entry from the locally available script instead of trusting the fullnode's minimal decoded block. The script hex is already normalized on `so.script`, and the parser already exists (`parseScript` from src/utils/scripts.ts, exactly as the sender-local path uses it at src/utils/transaction.ts:1261):

```ts
const parsed = so?.script ? parseScript(Buffer.from(so.script, 'hex'), storage.config.getNetwork()) : null;
tx.outputs.push({
  type: 'shielded',
  ...
  decoded: { ...(parsed?.toData() ?? so?.decoded), address: result.address },
  ...
});
```

`P2PKH.toData()` returns `{ type, address, timelock }`, so this also fixes `decoded.type` for free, and the address recovered from decryption still wins via the explicit override. The UTXO save at src/utils/storage.ts:1139 then picks up the real timelock with no further changes, the locked-UTXO index registers it, and `canUseUtxo`/balance reporting become correct.

Add the regression test first (per project practice): a unit test where `processNewTx` ingests a tx whose shielded output script encodes a future timelock and the fullnode-shaped `decoded` contains only `address`; assert the stored UTXO has the timelock set, the balance reports the amount as locked, and `canUseUtxo` returns false until `refTs >= timelock`. An integration test in `__tests__/integration/shielded_outputs/` covering wallet-to-wallet timelocked shielded send/receive would close the end-to-end gap — the only existing timelock integration test (`__tests__/integration/shared/send-many-outputs.test.ts:152`) exercises transparent outputs only.

## Verification notes

The skeptic panel confirmed every link in the chain:

1. **Receive path drops the timelock:** src/utils/storage.ts:990 spreads `so?.decoded` (fullnode-provided) with no script parse; hathor-core's `_shielded_output_to_json` (base_transaction.py:108-112) provably emits `decoded = {address}` only for shielded outputs.
2. **Undefined timelock means spendable everywhere:** `isOutputLocked` (src/utils/transaction.ts:305-316) returns false for `undefined`; the UTXO is saved with `timelock: null` (src/utils/storage.ts:1139), skipping the locked-UTXO index; `canUseUtxo` (src/utils/transaction.ts:1487-1512) re-checks the same stored entry — the entire spend path agrees.
3. **Scenario is reachable:** the public send API threads `timelock` into shielded proposals (src/new/wallet.ts:1997) and the script builder honors it (src/shielded/creation.ts:331).
4. **Node rejects the early spend:** core caps shielded scripts at 1024 bytes but otherwise accepts any script, and evaluates spent shielded scripts identically to transparent ones via `script_eval` (transaction_verifier.py:140-146, 181-187, 202-203, 226-228), so `OP_CHECKTIMESTAMPVERIFY` fails the tx.
5. **No compensating mechanism or test coverage:** exhaustive search found no other timelock enrichment in the shielded receive path (the `parseScript` call in `convertTransactionToHistoryTx` only serves the sender's local insert and is overwritten by WS re-delivery), and nothing under `__tests__/integration/shielded_outputs/` mentions timelocks.

Severity medium was agreed: wrong balance display plus node-rejected spends, no fund loss, niche but supported flow.

## Evidence folded from EDGE-01 / STATE-06 (merged duplicates)

- **EDGE-01 — griefing vector and wasted PoW.** Anyone can send a wallet a timelocked shielded output and degrade its sending reliability until the lock expires; the doomed spend is built, signed, and proof-of-work mined before the node rejects it. Trigger-surface nuance: the typed public `ISendShieldedOutput` API (`src/new/sendTransaction.ts:83-90`) exposes no timelock field and the phantom output hardcodes `timelock: null` (`src/new/sendTransaction.ts:251`), so the wallet-facade forwarding at `src/new/wallet.ts:1997` serves untyped JS callers and direct `createShieldedOutputs` use — but the wire format fully supports timelocked shielded scripts, so any external sender triggers the bug for every receiving wallet.
- **STATE-06 — the wrong state never self-corrects.** Because `isLocked` is false, `saveLockedUtxo` is skipped (`src/utils/storage.ts:1152`), so `processUtxoUnlock` has nothing to process when the lock expires; `memory_store.selectUtxos` filters on the stored `timelock: null` (`src/storage/memory_store.ts:764`). Self-send vs receive divergence: the sender-local insert parses the script (`src/utils/transaction.ts:1260-1270`) while the WS delivery of the same tx stores it unlocked, producing nondeterministic locked state depending on how the tx entered storage.
