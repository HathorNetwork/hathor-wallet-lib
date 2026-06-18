# TEST-04: A.6 (full-before-bare ws ordering) asserts nothing: `expect(typeof balAfter).toBe('object')` is vacuously true

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

Integration test A.6 in the WS message-ordering suite claims to verify that "the wallet must accept a full payload as the first event for a tx it doesn't yet know about and decrypt correctly", but its only meaningful assertions are `expect(after).not.toBeNull()` and `expect(typeof balAfter).toBe('object')`. Since `HathorWallet.getTxBalance()` always returns a `Record<string, bigint>` object, the `typeof` check can never fail — decryption correctness on the full-first ordering is entirely unverified. A regression that silently stops decoding shielded outputs on this exact path (the same decode-then-clobber bug class that A.9 in the same file was written to catch) would still pass this test. The test's in-line justification ("Same wallet seed-space → cannot rely on credit") is factually wrong: each `generateWalletHelper()` call consumes a distinct precalculated wallet, so a deterministic credit assertion is achievable with the same technique A.9 already uses.

## Location

- `__tests__/integration/shielded_outputs/ws_message_ordering.test.ts:156-174` (test A.6; the vacuous assertions at lines 167-173)
- `__tests__/integration/shielded_outputs/ws_message_ordering.test.ts:185-228` (test A.9, the working technique to copy)
- `src/new/wallet.ts:3040-3053` (`getTxBalance` — always returns an object)
- `__tests__/integration/helpers/wallet.helper.ts:99-105` and `__tests__/integration/helpers/wallet-precalculation.helper.ts:268-275` (each helper call yields a distinct wallet seed)

## Details

The test body (`__tests__/integration/shielded_outputs/ws_message_ordering.test.ts:156-174`):

```ts
it('A.6 — Out-of-order delivery: full arrives before bare announcement', async () => {
  // The wallet must accept a full payload as the first event for a tx that
  // it doesn't yet know about and decrypt correctly.
  const { stored } = await setupReceivedShieldedTx();
  const fresh = await generateWalletHelper();
  await fresh.getAddressAtIndex(0, { legacy: false });
  await fresh.getAddressAtIndex(1, { legacy: false });
  const full = fullWsPayload(stored);
  const bare = bareWsPayload(stored);
  await fresh.onNewTx({ history: full });
  await fresh.onNewTx({ history: bare });
  const after = await fresh.getTx(stored.tx_id);
  expect(after).not.toBeNull();
  // Same wallet seed-space → cannot rely on credit; assert the per-tx delta
  // is consistent (idempotent across the bare follow-up).
  const balAfter = await fresh.getTxBalance(after!);
  // It either decoded (credit > 0) or didn't (= 0); we don't crash.
  expect(typeof balAfter).toBe('object');
});
```

Three independent problems compound here:

1. **The `typeof` assertion is a tautology.** `getTxBalance` is declared `async getTxBalance(...): Promise<Record<string, bigint>>` and unconditionally builds and returns `const balance: Record<string, bigint> = {}` (`src/new/wallet.ts:3040-3053`). `typeof balAfter` is always `'object'`. The assertion can only fail if `getTxBalance` throws — in which case the test would fail anyway without the assertion. The test's own comment at line 172 concedes the actual bar: "It either decoded (credit > 0) or didn't (= 0); we don't crash."

2. **The stated contract is the un-tested part.** The header comment says the wallet must "decrypt correctly" when the full payload is the first event for an unknown tx. Nothing in the test distinguishes "decrypted and credited" from "stored with `outputs=[]` and credited 0n". The full-first-to-fresh-wallet ordering is precisely where the decode-then-clobber bug class lives — the bug A.9 documents at lines 188-194 (the final `addTx(newTx)` in `onNewTx` clobbering decoded outputs back to the empty wire form). A regression reintroducing that class on the full-first permutation passes A.6 unmodified.

3. **The justification for skipping the credit assertion is incorrect.** The comment "Same wallet seed-space → cannot rely on credit" misstates how the helpers work. `generateWalletHelper()` (`__tests__/integration/helpers/wallet.helper.ts:99-105`) calls `precalculationHelpers.test.getPrecalculatedWallet()`, which returns the first **unused** precalculated wallet and marks it used (`wallet-precalculation.helper.ts:268-275`). `fresh` therefore has a different seed than `walletB`, and deterministically **cannot** rewind outputs addressed to walletB's shielded addresses — the credit in this test is always 0n, never "either decoded or didn't". So the current test is not even a nondeterministic smoke test; it is a deterministic 0n-credit scenario mislabeled as one that "may decode". A real full-first decode assertion requires the outputs to be owned by the receiving wallet — which is exactly what A.9 arranges.

A.9 (same file, lines 185-228) demonstrates the correct technique: it takes walletB (which owns the shielded outputs), wipes the tx from `store.history` and its shielded UTXOs from `store.utxos` (lines 200-209) so the next `onNewTx` is a genuinely fresh arrival, replays the ws permutation, and asserts the exact `50n` credit (line 227). Every other test in the suite (A.3 line 121, A.4 line 133, A.7 line 182, A.9 line 227, A.10 lines 239/247/253) asserts an exact `50n` or `0n` balance; A.6 is the only one with no behavioral assertion.

## Source of truth

The client integration guide treats receive-side rewind/decryption as the core wallet obligation and defines its failure modes deterministically, not best-effort: "Wrong recipient: nonce derivation fails → error (expected during scanning); no false positives" and "Rewind failure with wrong key: expected, continue scanning" (SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md:92, 115). A test of the receive path can therefore always assert a deterministic outcome — the exact decrypted credit for the recipient wallet, or exactly 0n for a non-recipient — never merely "an object came back". hathor-core imposes no ordering guarantee on ws history events (bare vs full payload shapes both occur, per the suite's own header at `ws_message_ordering.test.ts:7-13`), which is precisely why the wallet-side test must pin the converged balance for each permutation, as A.3/A.4/A.9 already do.

## Impact

Test-coverage gap only — no runtime behavior is wrong. Concretely: a future refactor of `onNewTx`/`processHistory` that reintroduces the clobber bug (or any decode failure) on the "full payload is the first event" ordering would sail through CI, because A.6 — the only test naming that permutation — cannot fail on a 0n credit. The team would believe the full-first ordering is covered (the test title and comments claim it) when it is not. Mitigating nuance keeping severity at low: the genuine full-first decode path is exact-credit-asserted elsewhere — `setupReceivedShieldedTx` delivers the tx to walletB via the real ws and asserts the exact 50n credit (`ws_message_ordering.test.ts:107`) — so only the synthetic full→bare replay permutation in A.6 is under-asserted.

## Recommendation

Rework A.6 using the A.9 wipe technique so the receiving wallet owns the outputs and the credit is deterministic, then assert the exact value and idempotence after the bare follow-up:

```ts
it('A.6 — Out-of-order delivery: full arrives before bare announcement', async () => {
  const { walletB, txHash, stored } = await setupReceivedShieldedTx();
  const { store } = walletB.storage as any;
  store.history.delete(txHash);
  for (const [key, utxo] of store.utxos.entries()) {
    if (utxo.txId === txHash) store.utxos.delete(key);
  }

  await walletB.onNewTx({ history: fullWsPayload(stored) });   // full first
  const mid = await walletB.getTx(txHash);
  expect((await walletB.getTxBalance(mid!))[NATIVE_TOKEN_UID]).toBe(50n);

  await walletB.onNewTx({ history: bareWsPayload(stored) });   // bare follow-up
  const after = await walletB.getTx(txHash);
  expect((await walletB.getTxBalance(after!))[NATIVE_TOKEN_UID]).toBe(50n); // idempotent
});
```

Alternatively, keep the `fresh` wallet but have walletA send the shielded outputs to `fresh`'s own shielded addresses before the replay. Either way, also fix or delete the misleading "Same wallet seed-space" comment. If a non-recipient variant is still wanted, keep it as a separate explicit `expect(credit).toBe(0n)` test like A.5 (`ws_message_ordering.test.ts:153`) — never `typeof === 'object'`.

## Verification notes

The skeptic panel confirmed all three legs of the finding by direct code reading:

- `ws_message_ordering.test.ts:167-173`: the only assertions in A.6 are `not.toBeNull()` and `typeof balAfter === 'object'`; the comment at line 172 itself admits the bar is "we don't crash".
- `src/new/wallet.ts:3040-3053`: `getTxBalance` always returns a `Record<string, bigint>` object, so the `typeof` assertion is vacuously true.
- Seed claim verified: `generateWalletHelper()` → `getPrecalculatedWallet()` consumes a distinct unused precalculated wallet per call (`wallet-precalculation.helper.ts:268-275`), so `fresh` has a different seed than walletB; the in-test comment "Same wallet seed-space → cannot rely on credit" (line 169) is wrong — the credit is deterministically 0n in the current test, and a deterministic 50n assertion is achievable via the A.9 wipe technique (lines 200-227) or by sending to fresh's own shielded addresses.
- Severity held at low because the genuine full-first decode path is exact-credit-asserted in `setupReceivedShieldedTx` (line 107) via real ws delivery; only the synthetic full→bare permutation is under-asserted.
