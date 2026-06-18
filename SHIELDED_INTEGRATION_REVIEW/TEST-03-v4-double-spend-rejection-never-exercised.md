# TEST-03: V.4 does not test what it claims: double-spend rejection of a shielded UTXO is never exercised, and on-chain voiding of shielded txs is only ever simulated via hand-fed onNewTx flags

**Severity:** medium - **Status:** confirmed by adversarial review

**Also reported as:** a second TEST-03 write-up (shielded double-spend rejection never exercised) — duplicate deleted; the canonical write-up is a superset (adds H.33 concurrency coverage analysis).

## Summary

The integration test `V.4 — second send of an already-spent shielded UTXO is rejected` performs two sequential *successful* sends and asserts only that no error is thrown — it cannot fail for the reason it exists. No test in the entire suite builds a transaction that actually re-spends a consumed shielded slot and asserts the fullnode rejects it on `push_tx`. Likewise, the conflict→void→balance-reversal lifecycle for shielded transactions (tests A.10 and C.18) is exercised only by feeding wallet-crafted `{...stored, is_voided: true}` payloads through `onNewTx`, never by a real fullnode conflict event. Given that shielded UTXO deletion races were a real shipped bug area, the genuinely negative path — the node rejecting a stale shielded input — is the regression most worth pinning, and it is uncovered.

## Location

- `__tests__/integration/shielded_outputs/shielded_negative.test.ts:105-147` — V.4 body (two successful sends, no rejection asserted)
- `__tests__/integration/shielded_outputs/shielded_negative.test.ts:13-15` — suite header promising server-side `push_tx` rejection tests the file does not contain
- `__tests__/integration/shielded_outputs/ws_message_ordering.test.ts:230-254` — A.10 simulates voiding via `onNewTx`
- `__tests__/integration/shielded_outputs/cross_wallet.test.ts:181-216` — C.18 simulates voiding via `onNewTx`; lines 214-215 admit the real path is "documented for manual testing"
- `__tests__/integration/shielded_outputs/core.test.ts:1730-1829` — the related L.5 regression test asserts the *positive* path only
- `__tests__/integration/shielded_outputs/concurrency.test.ts:83-89` — H.33 tolerates either outcome of concurrent contention

## Details

### 1. V.4 is a positive test wearing a negative test's name

The test is titled "second send of an already-spent shielded UTXO is rejected", and the suite's documented pattern (`shielded_negative.test.ts:13-15`) is:

```
 * Pattern: each test attempts a malformed flow and asserts an error is
 * raised, either client-side (wallet-lib refuses to build the tx) or
 * server-side (fullnode rejects on push_tx).
```

But the body (`shielded_negative.test.ts:132-146`) is two chained successful sends, and the comment concedes the gap:

```ts
    // First send — succeeds.
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const tx1 = await walletA.sendTransaction(addrB, 25n);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletA, tx1!.hash!);

    // Second send chained — wallet should pick a NEW UTXO (the change
    // from tx1) automatically. If for some reason it tried to re-use
    // the spent UTXO from seedTx, the fullnode would reject. We mainly
    // assert no error is thrown — and the recipient's balance reflects
    // both sends.
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const tx2 = await walletA.sendTransaction(addrC, 5n);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletC, tx2!.hash!);
```

The only assertions are not-null checks on successful sends. The test depends on a hidden side channel: *if* the wallet re-selected the spent UTXO, *then* the node would reject, *then* `sendTransaction` would throw. It never constructs the malformed flow itself and never asserts a rejection. If the wallet's UTXO bookkeeping regressed in a way where the node *accepted* a re-spend (e.g., a wallet-side accounting bug that selects a different-but-wrong slot, or a future core change loosening mempool conflict handling), V.4 would still pass. It cannot fail for the reason it exists. Note also that, despite the comment, no balance assertion for the recipients is actually present.

Within the same file, every genuine rejection assertion is client-side: V.1 (`shielded_negative.test.ts:53-62`, `rejects.toThrow(/at least 2 shielded outputs/i)`) and V.3 (`shielded_negative.test.ts:82-97`, `rejects.toThrow()`) both fail during wallet-lib tx construction. Zero tests in the file reach the "server-side: fullnode rejects on push_tx" half of the promised pattern.

### 2. No test anywhere drives a real shielded double-spend rejection

An exhaustive search of the suite confirms the gap is total, not local to V.4:

- `core.test.ts:1730-1829` ("should delete spent shielded UTXOs so the next send does not double-spend") is the regression test for the real L.5 bug — but its final guard (line 1811) asserts the next send **succeeds** ("no double-spend rejection"). It pins the UTXO-deletion fix via storage counts (`core.test.ts:1797-1809`), which is good, but never exercises what the node does when handed a stale shielded input.
- `concurrency.test.ts:83-89` (H.33) races two sends and explicitly tolerates either outcome: "The other may fail due to UTXO lock contention or mempool rejection — that's acceptable here. `expect(fulfilled.length).toBeGreaterThanOrEqual(1)`".
- No test builds a raw transaction (via the transaction utils or a cloned storage UTXO record) with explicit inputs referencing an already-spent shielded slot and pushes it expecting rejection.

### 3. The void lifecycle is only ever simulated

The wallet's handling of a voided shielded tx — debiting credited shielded outputs, restoring spent inputs — is covered only by synthetic events:

`ws_message_ordering.test.ts:243-251` (A.10):

```ts
    const voided = { ...stored, is_voided: true };
    await walletB.onNewTx({ history: voided });
    ...
    const unvoided = { ...stored, is_voided: false };
    await walletB.onNewTx({ history: unvoided });
```

`cross_wallet.test.ts:208-215` (C.18) uses the same technique and openly documents the limitation:

```ts
    await walletB.onNewTx({ history: { ...stored, is_voided: true } });
    ...
    // Voiding a propagated tx requires fullnode-level intervention not
    // exposed via wallet API. Documented for manual testing.
```

These payloads are spreads of the wallet's *own stored* tx record (which already carries decoded `shielded_outputs`), not the wire-shaped history event the fullnode emits when a conflict actually voids a tx. If the real event differs — e.g., the redelivered voided tx arrives in raw wire form without the wallet's enriched shielded fields, exactly the ordering hazard A.9 (`ws_message_ordering.test.ts:215-227`) exists to guard against on the credit side — the simulated tests would keep passing while the real flow breaks.

## Source of truth

- hathor-core:hathor/verification/transaction_verifier.py:506-533 — `verify_conflict` is real, reachable behavior: spending an output already spent by a *confirmed* tx raises `ConflictWithConfirmedTxError` ("transaction has a conflict with a confirmed transaction"), and spending an output of a confirmed-and-voided tx raises `InputVoidedAndConfirmed` (line 517-520). Crucially, line 531 only rejects conflicts with **confirmed** transactions — *mempool* conflicts are accepted and resolved by voiding one side. This means the conflict→void path the wallet must survive is a normal, reachable network condition (two txs spending the same shielded slot both enter the mempool; the loser is voided when the winner confirms), and it is feasible to drive end-to-end in the Docker integration network with two wallet instances sharing a seed.
- The suite's own contract (`__tests__/integration/shielded_outputs/shielded_negative.test.ts:13-15`) promises server-side `push_tx` rejection coverage that the file does not deliver.
- The client integration guide's negative-path expectations (SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md) frame double-spend/conflict survival of shielded UTXO bookkeeping as wallet responsibility — which is precisely the bookkeeping that already shipped a real bug (the `processSingleTx` deleteUtxo skip documented at `core.test.ts:1731-1736`).

## Impact

This is a test-coverage gap, not a product bug — but in the highest-risk area of the integration. Shielded inputs occupy slot indices *beyond* `origTx.outputs` after normalization, which is exactly why the spent-UTXO deletion bug (L.5) shipped: the standard input-consumption loop missed them. The two flows that would catch a recurrence are:

1. **The node rejecting a stale shielded input on push.** Today, if a regression reintroduces stale shielded UTXOs into the selection index, the only signal is V.4 *incidentally* failing via an unasserted side channel — or nothing at all if selection ordering happens to avoid the stale slot in the test's specific topology. Users would hit "input has already been spent" errors on sends in production with no pinning test.
2. **A real on-chain conflict voiding a shielded tx.** The wallet's reversal logic (debit shielded credits, restore inputs) is only proven against payloads the test itself fabricated from already-enriched stored records. If the fullnode's actual redelivery shape for a voided tx lacks the enriched shielded data the simulation assumes, receiver balances could be left wrong (stuck credited, or double-debited) after a conflict — a silent funds-display corruption — and no automated test would notice.

## Recommendation

1. **Make V.4 a true negative.** Before the first send, snapshot the shielded UTXO walletA is about to spend (iterate `walletA.storage.selectUtxos({ token, shielded: true })` as `core.test.ts:1763-1770` already does). After tx1 confirms, build a transaction that *explicitly* references the spent slot — either by passing explicit `inputs: [{ txId: seedTx.hash, index: spentIndex }]` through the send options, or by constructing a raw tx via the transaction utils — push it, and assert rejection:

   ```ts
   await expect(
     walletA.sendManyOutputsTransaction(outputs, {
       inputs: [{ txId: seedTx!.hash!, index: spentSlotIndex }],
     })
   ).rejects.toThrow(/spent|conflict/i);
   ```

   Keep the existing happy-path tail (wallet auto-selects fresh change) as a secondary assertion if desired, but the rejection must be the primary one.

2. **Add one real-conflict lifecycle test.** Instantiate two wallets from the same seed (the precalculated-wallet helpers support this), let both sync, then fire two sends spending the same shielded UTXO from each instance without waiting in between. Core accepts both into the mempool (hathor-core:hathor/verification/transaction_verifier.py:531 rejects only confirmed conflicts) and voids the loser on confirmation. Assert: (a) exactly one tx ends up non-voided, (b) the receiving wallet's balance reflects only the winner, (c) the sender's shielded UTXO index contains only the winner's change. This replaces the `{...stored, is_voided}` simulation in A.10/C.18 with the real fullnode event shape for at least one path; the simulations can stay as fast unit-level checks of the reversal arithmetic.

3. **Fix the suite header** (`shielded_negative.test.ts:13-15`) or fulfill it — as written it documents server-side rejection coverage that does not exist, which misleads future readers into believing the path is pinned.

## Verification notes

The skeptic panel confirmed the finding on all four legs:

1. Read V.4 in full (`shielded_negative.test.ts:105-147`): two sequential successful sends; lines 140-142 literally state "We mainly assert no error is thrown"; the only assertions are `expect(tx).not.toBeNull()`. The test cannot fail on wallet re-selection of a spent shielded UTXO unless the node rejects — which is never asserted. Suite header line 15 promises server-side `push_tx` rejection tests; every `.rejects` in the file (lines 62, 97) is client-side build refusal.
2. Exhaustive grep of the worktree found no test asserting fullnode rejection of a re-spent shielded slot: `core.test.ts:1730-1829` asserts the next send SUCCEEDS (line 1811: "no double-spend rejection"); `concurrency.test.ts:87-89` (H.33) explicitly tolerates either outcome of contention. No test builds a tx with explicit inputs referencing a spent shielded slot.
3. Void lifecycle confirmed simulation-only: `ws_message_ordering.test.ts:243-251` (A.10) and `cross_wallet.test.ts:208-213` (C.18) feed `{...stored, is_voided: true}` via `onNewTx`; `cross_wallet.test.ts:214-215` admits "Voiding a propagated tx requires fullnode-level intervention... Documented for manual testing."
4. Core-side premise verified at hathor-core:hathor/verification/transaction_verifier.py:506-533 (`verify_conflict`, `ConflictWithConfirmedTxError`, `InputVoidedAndConfirmed`); the original finding's cited line range (174-210) was incorrect but the substance holds. Mempool conflicts being allowed (line 531) confirms the recommended two-wallet real-conflict test is feasible in the integration environment.

Severity medium is appropriate: pure test gap, but in an area with multiple shipped double-spend bugs (L.5 at `core.test.ts:1730`, plus the K.8/K.9 token-creation regressions), where the missing negative path is the most valuable regression to pin.
