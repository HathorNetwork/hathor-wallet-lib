# TEST-07: Unblinding-payload scope for mixed-ownership txs (own change + foreign recipient outputs in one tx) is untested — the exact privacy boundary case
**Severity:** medium - **Status:** confirmed by adversarial review

**Also reported as:** a second TEST-07 write-up (mixed-ownership unblinding payload untested) — merged here.

## Summary
`getShieldedUnblindingForTx` must expose openings (value, blinding factors) only for outputs the wallet owns — received outputs and its own shielded change — and never for outputs sent to other recipients. The integration suite tests the two pure poles (a self-send where ALL outputs are owned, and a cross-wallet send where NONE are), but never the mixed transaction where the sender's own shielded change sits next to the recipient's shielded outputs in the same tx. That mixed shape is the only case where inclusion and exclusion must hold simultaneously, and today its correctness rests on an implicit, unpinned storage invariant: the sender's send-time blinding factors for recipient outputs simply happen not to be persisted.

## Location
- `src/new/wallet.ts:1146-1172` — the ownership filter in `getShieldedUnblindingForTx` (`if (!output.blindingFactor) continue;` at line 1154)
- `src/utils/transaction.ts:1250-1273` — sender-local history insert emits `shielded_outputs` entries **without** blinding factors (the implicit guarantee)
- `src/utils/storage.ts:1005` — the only path that persists `blindingFactor`: own-key range-proof rewind in `processSingleTxUtil`
- `__tests__/integration/shielded_outputs/unblinding_encoder.test.ts:42-276` — P suite: P.1/P.2 (recipient-only), P.3 (all-owned self-send, lines 157-233), P.4 (all-foreign, lines 235-275); no mixed case
- `__tests__/integration/shielded_outputs/sparse_decode.test.ts:66-129` — N.1 builds exactly the mixed tx but only asserts spendability
- `__tests__/new/hathorwallet.test.ts:1018-1037` — unit test of the foreign-output skip, mock-based, restates the storage assumption

## Details
The unblinding feature lets a wallet hand third parties (e.g. an explorer) the openings of confidential outputs it owns, so the commitments can be verified. The privacy contract is asymmetric: the wallet may disclose its own openings, but the sender of a shielded payment must never disclose the recipient's openings — even though the sender *generated* those blinding factors at send time and could, if they were retained, decode the recipient's amounts.

The implementation gates ownership on the presence of a stored `blindingFactor`:

```ts
// src/new/wallet.ts:1144-1154
// Build a lookup keyed by on-chain absolute output index for
// shielded outputs the wallet owns (decoded). ... Entries the fullnode
// delivered but we couldn't decode never get appended to
// `tx.outputs[]`, so the `blindingFactor` filter is the
// ownership gate.
...
for (const output of target.outputs) {
  if (!transactionUtils.isShieldedOutputEntry(output)) continue;
  if (!output.blindingFactor) continue;
```

This is correct today only because of how storage is populated:

1. `blindingFactor` is persisted exclusively by the receive-side decryption path — `processSingleTxUtil` rewinds the range proof with the wallet's own shielded keys and stores the recovered factor (`src/utils/storage.ts:1005`).
2. The sender-local insert (`convertTransactionToHistoryTx`) emits the tx's `shielded_outputs` **without** any blinding factors, even though the send pipeline held them moments earlier (`src/utils/transaction.ts:1257-1273` maps only `mode/commitment/range_proof/script/token_data/ephemeral_pubkey/asset_commitment/surjection_proof/decoded`).

So in a mixed tx (sender pays a recipient with a shielded output AND keeps shielded change), the sender's storage ends up with `blindingFactor` set only on the change entry — the recipient entries are present (from the fullnode/sender-local shape) but undecorated, and the filter skips them. Nothing in the codebase *pins* step 2. A plausible future change — persisting send-time blindings for retry, audit logging, or "show what I sent" UX — would decorate the recipient entries too, and `getShieldedUnblindingForTx` would silently start returning the recipients' openings.

The existing tests do not cover this boundary:

- **P.3** (`unblinding_encoder.test.ts:157-233`) is a self-send: every output is owned, so it can only catch under-inclusion, never over-inclusion.
- **P.4** (`unblinding_encoder.test.ts:235-275`) is a cross-wallet send funded by transparent inputs: nothing is owned, payload is empty. It catches over-inclusion only in the degenerate all-foreign case.
- **N.1** (`sparse_decode.test.ts:66-129`) constructs exactly the mixed tx — "A sends 30 HTR FS to B and 20 HTR FS back to itself in the same tx" — but asserts only that the change is later spendable. It never calls `getShieldedUnblindingForTx`. (Confirmed by exhaustive grep: in integration, `getShieldedUnblindingForTx` is called only at `unblinding_encoder.test.ts:75,136,212,266`; `multi_token_shielded.test.ts` Q.3 uses `changeShieldedMode` but never calls the API; `sender_local_insert.test.ts` mentions it only in comments at lines 226 and 297.)
- The **unit** mixed case (`__tests__/new/hathorwallet.test.ts:1018`, `// not decoded — wallet doesn't own. No blindingFactor → skipped.`) hand-builds a foreign entry *without* a `blindingFactor` and asserts it is skipped. That test bakes in the very storage assumption under question: if a future change persisted send-time blindings, the real storage shape would gain `blindingFactor` on foreign entries, but this mock would still omit it — the test would keep passing while production leaked.

## Source of truth
- The client integration guide treats blinding factors as spend secrets: AmountShielded creation "Returns: ... `value_blinding_factor` kept secret (needed for spending)" and FullShielded adds "`asset_blinding_factor` kept secret" (`SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md:32,36`). Disclosing a recipient's vbf/abf lets anyone open the commitment and recover the confidential amount, defeating the scheme for that output.
- hathor-core's rewind primitive demonstrates this directly: anyone holding the blinding/nonce can recover `(value, blinding, message)` from the proof (`hathor-core:hathor-ct-crypto/src/` `rewind_range_proof`; guide checklist line 98).
- User-stated invariant for this integration (recorded project decision): "Only wallet-owned outputs (received + change). Never expose blindings of outputs sent to other recipients."

## Impact
No bug exists today — the implementation behaves correctly. The risk is regression without detection on a privacy boundary:

1. A future PR persists send-time blinding factors on the sender's history entries (a natural feature: retry after crash, sender-side audit, or sender "view amount" UX).
2. The `!output.blindingFactor` ownership gate now passes for the recipient's outputs in every mixed tx.
3. A sender who shares an unblinding payload with an explorer (the designed flow for `encodeShieldedUnblindingPayload`) publishes the recipient's value and blinding factor — permanently deanonymizing the recipient's confidential output on-chain.
4. Neither the unit suite (mock omits the field) nor the integration suite (no mixed-tx call site) fails; the leak ships silently.

Affected parties: recipients of shielded payments from any wallet that later shares unblinding data — i.e. the exact users the confidentiality feature exists to protect.

## Recommendation
Add an integration test P.5 in `__tests__/integration/shielded_outputs/unblinding_encoder.test.ts` that exercises the mixed-ownership tx end-to-end through real storage (not mocks), asserting on on-chain indices rather than array lengths:

```ts
it('P.5 — sender of a mixed tx exposes ONLY its own change opening, never the recipient outputs', async () => {
  const sender = await generateWalletHelper();
  const recipient = await generateWalletHelper();
  await GenesisWalletHelper.injectFunds(sender, await sender.getAddressAtIndex(0), 200n);

  const rAddr = await recipient.getAddressAtIndex(0, { legacy: false });
  // Recipient FS output + sender's own shielded change in the SAME tx
  // (via changeShieldedMode, like Q.3 in multi_token_shielded.test.ts).
  const tx = await sender.sendManyOutputsTransaction(
    [{ address: rAddr, value: 30n, token: NATIVE_TOKEN_UID,
       shielded: ShieldedOutputMode.FULLY_SHIELDED }],
    { changeShieldedMode: ShieldedOutputMode.FULLY_SHIELDED }
  );
  await waitForTxReceived(sender, tx!.hash!);
  await waitForTxReceived(recipient, tx!.hash!);

  // Ground truth from the tx itself: which on-chain shielded index is the
  // recipient's. (Recipient's own view gives its indices authoritatively.)
  const recipientOpening = await recipient.getShieldedUnblindingForTx(tx!.hash!);
  const recipientIndices = recipientOpening.outputs.map(o => o.index);
  expect(recipientIndices.length).toBe(1);

  const senderOpening = await sender.getShieldedUnblindingForTx(tx!.hash!);
  const senderIndices = senderOpening.outputs.map(o => o.index);

  // Exactly one owned output (the change), disjoint from the recipient's.
  expect(senderIndices.length).toBe(1);
  for (const idx of recipientIndices) {
    expect(senderIndices).not.toContain(idx);
  }
  // And the sender payload must not contain the recipient's vbf.
  const leaked = senderOpening.outputs.find(o =>
    recipientOpening.outputs.some(r => r.vbf === o.vbf));
  expect(leaked).toBeUndefined();
});
```

Optionally harden the unit layer too: a unit test that builds the history entry the way `convertTransactionToHistoryTx` actually does (call the real converter on a tx with `shieldedOutputs`) and asserts the resulting foreign entries carry no `blindingFactor` — pinning the storage-shape invariant itself, not just the filter's reaction to it.

## Verification notes
The skeptic panel verified every claim against the worktree:
- The filter exists verbatim at `src/new/wallet.ts:1154` (`if (!output.blindingFactor) continue;`), with the comment at lines 1146-1153 explicitly calling it "the ownership gate".
- `blindingFactor` persistence was traced to a single writer: the own-key rewind in `src/utils/storage.ts:1005`. The sender-local insert path (`src/utils/transaction.ts:1257-1273`) was read in full and confirmed to omit blinding factors — and nothing (test or assertion) pins that omission.
- Exhaustive grep over `src/` and `__tests__/` confirmed `getShieldedUnblindingForTx` is exercised in integration only at `unblinding_encoder.test.ts:75,136,212,266` — none of which is a mixed-ownership tx. `sparse_decode.test.ts` N.1 (line 66) builds the mixed tx but asserts only spendability; `sender_local_insert.test.ts` references the API only in comments (lines 226, 297).
- The unit foreign-output case (`__tests__/new/hathorwallet.test.ts:1018`) was confirmed to be mock-based: it would still pass if a future change persisted send-time blindings, which is precisely the regression mode the proposed P.5 catches.
- Classified as a genuine test gap (no current bug); medium severity is justified because the guarded property is a privacy boundary (recipients' commitment openings) protected only by an implicit, unpinned storage invariant.

## Evidence folded from the duplicate write-up

- The only integration call sites of `getShieldedUnblindingForTx` are `__tests__/integration/shielded_outputs/unblinding_encoder.test.ts:75,136,212,266` — all pure-pole ownership.
- `__tests__/integration/shielded_outputs/multi_token_shielded.test.ts:230-247,286-304` (Q.3/Q.4) build genuinely mixed txs via `changeShieldedMode` but assert only balances, never the unblinding payload boundary.
