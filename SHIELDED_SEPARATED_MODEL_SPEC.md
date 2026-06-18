# Shielded-output indexing: migrate to the SEPARATED / arithmetic model (v2)

Authoritative implementation guide. v2 folds in the adversarial-verification findings
(12-agent workflow) — the design is confirmed correct, but the consumer surface is much
larger than v1 captured, with ~18 correctness traps now made explicit below.

Target: hathor-core's model — `outputs[]` transparent-only + a full `shielded_outputs[]`
list, on-chain index of `shielded_outputs[s]` = `outputs.length + s`, resolve by
`idx < T ? outputs[idx] : shielded_outputs[idx - T]` (base_transaction.py:347-363).

## Invariants (REVISED)
1. **`outputs[]` transparent-only is a POST-NORMALIZE INTERNAL invariant, NOT a wire
   guarantee.** The fullnode/WS can deliver shielded INLINE in `outputs[]` (type:'shielded');
   `normalizeShieldedOutputs` case-(a) extracts them. → **KEEP a wire-form discriminator**
   (rename `isShieldedOutputEntry` → `isInlineShieldedWireEntry`); it stays load-bearing for
   normalize, `convertFullNodeTxToHistoryTx`, and `walletServiceStorageProxy`.
2. **`shielded_outputs[]` MUST be the FULL on-chain-ordered list** (owned + non-owned).
   `resolveSpentOutput(idx)=shielded[idx-T]` silently hits the wrong slot on a partial list
   (the sparse-decode bug `onChainIndex` papered over). Add a dev assertion; every builder
   (sender-local insert, convertFullNodeTx, onNewTx merge) must emit the complete list.
3. **The single ownership/decoded gate is TOP-LEVEL `value !== undefined`.** NOT
   `decoded.address` (wire emits address for non-owned too → would sign foreign inputs), NOT
   `decoded.value` (no such field). Keep `decoded` REQUIRED on the type.

## Types (`src/types.ts` — NOT shielded/types.ts; IHistoryShieldedOutput is standalone here)
- `IHistoryShieldedOutput` gains OPTIONAL owned-marker fields: `value?`, `token?`,
  `blindingFactor?`, `assetBlindingFactor?`. `decoded` and `spent_by` stay as-is.
- Remove `IShieldedOutputEntry` (its OWNERSHIP/appended role only). `IHistoryOutput = ITransparentOutput`.
- Keep the wire discriminator function (renamed) — do NOT delete it; tests import it
  (`realtime_vs_reload.test.ts:561`) and normalize depends on it.

## Resolver (`src/utils/transaction.ts`)
`resolveSpentOutput(parentTx, idx)`:
- `idx in [0,T)`   → `{ kind:'transparent', output }`
- `idx in [T,T+S)` → `{ kind:'shielded', sIndex: idx-T, output }`  **for EVERY slot, owned or not** (non-owned = `value===undefined`, still a valid resolve)
- else (`idx>=T+S` or `idx<0`) → `undefined`
Single resolver; forbid positional `outputs[idx]` for any idx that may be ≥ T.

## Receive (`5c`: processing.ts + utils/storage.ts) — factor a SHARED helper
- `processShieldedOutputs` writes decoded data IN PLACE onto `shielded_outputs[s]`
  (`s = result.index - tx.outputs.length`; assert `0≤s<S`). Keep the `value<=0n` skip
  (0-value stays undecoded → excluded by the gate). Stop building outputs[] entries.
- **Factor the per-output body** (balance + addressMeta + tokenMeta + lock + authority +
  `shieldedMaxIndexUsed` gap-limit + `txTokens/txAddresses` + `saveUtxo` gated on
  `spent_by===null` + `saveLockedUtxo` + spent→`utxoSelectAsInput(false)`) into a shared
  `creditOutput(output, onChainIndex)` helper. Call it from the transparent loop (`idx=i`)
  and a NEW owned-shielded loop over `shielded_outputs[]` (`value!==undefined`, `idx=T+s`).
  Omitting `shieldedMaxIndexUsed` silently breaks owned shielded-address discovery.
- **`processMetadataChanged` MUST gain the parallel owned-shielded loop** (re-save UTXO at
  `T+s` preserving `shielded:true`/blindingFactor; spent→cleanup). Do NOT just delete the
  branch — that strips blinding factors on confirmation and the fullnode rejects the unshield
  (R.12). Reuse the shared helper's save path.

## Per-tx balance (`getTxBalance`, `src/utils/transaction.ts`)
- **ADD a CREDIT loop** over `shielded_outputs[]` (`value!==undefined`) with the same
  authority/lock handling — else owned shielded RECEIVES credit 0 (getTxHistory/getTxById).
- **REWIRE (do not remove)** the input-DEBIT parent-tx fallback through `resolveSpentOutput`
  → `shielded_outputs[idx-T].value`. The spent UTXO is deleted by the time this runs, so
  "skip if UTXO missing" under-debits (the "+8.5M" R.7 bug).

## Send / sign / sender-local-insert (`6`)
- Spend INPUT build + crypto-from-UTXO unchanged (UTXO-keyed by on-chain index).
- **Enumerate ALL findSpentOutput sites with `git grep` per branch (≈13, not 11):**
  sendTransaction (292,1279), wallet (741,3149), storage/storage (781), utils/storage
  (519,600,1241,**1263 spent_by-stamp**,1440), transaction (393,1153,**1501 canUseUtxo**).
  Each: unwrap to `.output`, branch on `kind`. Preserve **in-place mutation** for the
  spent_by-stamp (write onto `shielded_outputs[s]`). Preserve the **stored-UTXO fallback** in
  `getSignatureForTx`/`assemblePartialTransaction` when `resolved.output.decoded?.address` is
  undefined (else silent under-signing). Key ownership off `getAddressInfo(address)` /
  `addressType`, NOT resolver kind (wire emits foreign decoded.address).
- **`onNewTx` per-slot merge** (wallet.ts ~1786): for each `s`, if `newTx.shielded_outputs[s].value===undefined`
  and storage has it, copy value/token/decoded/blinding from storage. The whole-array
  `if (!newTx.shielded_outputs)` guard is insufficient (WS re-delivers a bare-but-present
  array → clobbers decoded data → L.5 regression).
- **`needsRetry`/`shieldedNewlyAvailable`**: switch to `shielded_outputs.some(value!==undefined)`
  AND add an ownership gate (owned undecoded slot exists), else fully-non-owned shielded txs
  trigger `processHistory` on every WS event.
- **API-fetch bounds guard** (transaction.ts ~1137 "Index outside of tx output array bounds"):
  change to `idx >= outputs.length + (shielded_outputs?.length ?? 0)` — else EVERY shielded
  spend with an out-of-storage parent is rejected.

## Wire/parse fixes (do these WITH the resolver, not after)
- **`convertFullNodeTxToHistoryTx`**: thread `shielded_outputs` into histTx + run base64→hex;
  drop the inline-shielded guard from `outputs.map`. (Prereq: resolver returns undefined for
  shielded idx if S=0.)
- **`walletServiceStorageProxy.convertFullNodeToHistoryTx`**: SECOND dropper — thread
  `shielded_outputs` too, or assert WS-facade is shielded-unsupported and rely on getUtxo fallback.
- **`normalizeShieldedOutputs`**: do NOT strip decoded fields (Case-(b) runs on every addTx incl.
  re-deliveries — stripping wipes owned data). Make extraction unconditional/partition so a tx
  with shielded in BOTH arrays doesn't double-count.
- **`processUtxoUnlock`** (storage.ts ~1440/1497): narrow `output.value` (now optional) — resolve
  value/address from the stored locked UTXO when the wire entry's value is undefined.

## Template / PartialTx (assert-and-exclude, with a test)
- `addBalanceFromUtxo`/`executor.ts:150`/`partial_tx.validate` do positional `outputs[idx]`.
  Either route through `resolveSpentOutput`, or explicitly `assert idx < T` / reject shielded
  with a clear message AND add a test that references a shielded input. No bare "defer" assumptions.

## Migration — RESOLVED: none needed (changelog note only)
Confirmed by the maintainer: NO persistent-store wallet (mobile/headless/wallet-service) ran a
published `-shielded` prerelease against on-disk history — only ephemeral/memory stores. So there
is NO sparse-append data on disk in the wild → **no migration code, no store-version bump.** Add a
CHANGELOG note documenting the internal model change. (Still key the SEPARATED decryption-idempotence
check off `shielded_outputs.some(value!==undefined)` — that's the natural decoded marker, not a
migration concern.)

## Tests
- **`sparse_decode.test.ts` N.1-N.8 are BLACK-BOX balance assertions = the acceptance gate.**
  COMMENT-ONLY edits (update the narrative); the assertions MUST pass unmodified — esp. N.7/N.8
  (owned MIDDLE/last slot). Do not "rewrite assertions."
- `edge_cases.test.ts` `outputs.push` is the SEND API (`{address,value,token,shielded}`) — leave it.
- Unit fixtures that build `IShieldedOutputEntry`/`onChainIndex` (storage.test.ts:455-595,
  transaction_shielded.test.ts:14-90, hathorwallet.test.ts makeTx 935-1025) must move decoded
  data onto `shielded_outputs[]` in-place or they won't tsc; recompute expected index as `T+s`.
  Re-express the getShieldedUnblindingForTx "fallback" test (1061) as a PRIMARY non-prefix-slot test.
- ADD unit coverage (catches divergence without Docker): resolver boundaries (idx=T, T+S-1, T+S,
  <0, non-owned slot); getTxBalance shielded credit + debit-with-deleted-UTXO; processNewTx
  shielded credit (numTransactions + maxIndex advance); processMetadataChanged preservation;
  onNewTx per-slot merge; convertFullNodeTxToHistoryTx threading; canUseUtxo timelock on shielded.
- Integration Docker image is `alpha-v3` (spec semantics from v4). The retained wire-normalize
  layer must tolerate BOTH shapes (inline + separate); keep the inline-wire tests
  (ws_message_ordering, core.test.ts two-phase) as the v3-compat guard.

## Sequencing (unchanged; shared helper lands in 5c)
1. **5b** — types (keep decoded required; rename wire discriminator), `resolveSpentOutput`,
   getTxBalance credit+debit, convertFullNodeTx + WS-proxy threading, API-bounds guard, enumerate
   + convert all findSpentOutput sites, processUtxoUnlock narrowing.
2. **5c** — shared `creditOutput` helper, write-in-place processing, processNewTx + processMetadataChanged
   shielded loops, drop append/onChainIndex/recovery.
3. **6** — send/sign/sender-insert resolver swaps, onNewTx per-slot merge, needsRetry gate,
   template/partial_tx assert-exclude.
4. **7** — fixtures/assertions per the Tests section (comment-only for N-series); add unit coverage.
5. **8** — reconcile model-touching fixes; do NOT strip decoded in normalize.
6. **Validate** — full shielded integration suite on pr-8 (Docker, fresh net): green incl. N.7/N.8, R.7, R.12, L.5.
7. **feat** — same rework (note feat has unblinding.ts + the getShieldedUnblindingForTx factoring); unit + integration.
