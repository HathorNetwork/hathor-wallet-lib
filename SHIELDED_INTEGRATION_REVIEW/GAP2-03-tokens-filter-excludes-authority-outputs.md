# GAP2-03: tokens[] privacy filter excludes authority outputs, so a token represented only by an authority output + FullShielded value outputs serializes the authority output with token_data 0x80 (an HTR authority output)

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

The privacy filter that decides which token UIDs go into the transaction's public `tokens[]` array deliberately skips authority outputs. If a transaction ever carried an authority output of token X while all of X's value outputs were FullShielded, X would be dropped from `tokens[]` even though the authority output still needs a `token_data` index naming X on the wire. The downstream serializer, `getTokenDataFromOutput`, has no guard for a missing token: `indexOf` returns -1, so it silently emits `(-1 + 1) | 0x80 = 0x80` — an authority output over HTR, which core rejects as consensus-invalid. The exclusion also buys no privacy, because the authority output's wire `token_data` must name the token anyway and core's unused-token check counts authority outputs as token usage. Currently latent: no existing wallet-lib flow can construct this combination.

## Location

- `src/new/sendTransaction.ts:593-604` — `tokensWithVisibleOutput` construction; line 597 excludes authority outputs
- `src/new/sendTransaction.ts:613` — `tokens[]` filtered by that set
- `src/utils/transaction.ts:788-794` — `getTokenDataFromOutput` with no `indexOf === -1` guard
- `src/utils/transaction.ts:854` — the unguarded `token_data` reaches serialization via `createTransactionFromData`

## Details

After outputs are finalized, `SendTransaction.prepareTxData` builds the set of tokens that must appear publicly in `tokens[]` (`src/new/sendTransaction.ts:593-604`):

```ts
const tokensWithVisibleOutput = new Set<string>();
for (const out of outputs) {
  const tokenUid = (out as { token?: string }).token;
  if (!tokenUid || tokenUid === HTR_UID) continue;
  if ((out.authorities ?? 0n) !== 0n) continue; // <-- authority outputs excluded
  tokensWithVisibleOutput.add(tokenUid);
}
for (const so of shieldedOutputs) {
  if (so.shieldedMode !== ShieldedOutputMode.FULLY_SHIELDED) {
    tokensWithVisibleOutput.add(so.token);
  }
}
```

and at line 613:

```ts
tokens: Array.from(tokenMap.keys()).filter(t => tokensWithVisibleOutput.has(t)),
```

The intent of the filter is sound for value outputs: a token referenced only by FullShielded outputs commits its UID inside `asset_commitment`, so listing it in `tokens[]` would leak which asset is being transferred. But the authorities exclusion at line 597 is wrong on both axes:

1. **Correctness.** An authority output is a *transparent* `TxOutput` on the wire; its `token_data` must encode the token's 1-based index into `tokens[]` (plus the 0x80 authority mask). If the token was filtered out, `getTokenDataFromOutput` (`src/utils/transaction.ts:788-794`) produces garbage with no error:

   ```ts
   const tokensWithoutHathor = tokens.filter(token => token !== NATIVE_TOKEN_UID);
   const tokenIndex = tokensWithoutHathor.indexOf(output.token) + 1; // -1 + 1 = 0
   if (output.authorities === 0n) {
     return tokenIndex;
   }
   return tokenIndex | TOKEN_AUTHORITY_MASK; // 0 | 0x80 = 0x80
   ```

   `token_data = 0x80` means "authority output over token index 0", i.e. over HTR. This value flows straight into output serialization via `createTransactionFromData` (`src/utils/transaction.ts:854`), so the wallet would sign and push a malformed transaction with no local error.

2. **Privacy.** The exclusion protects nothing. The authority output's own wire `token_data` already names the token publicly, and core *requires* the token to be listed (see Source of truth). Excluding the token from `tokens[]` cannot hide an asset whose authority output is sitting transparently in the same transaction.

The triggering combination — an authority output of token X plus only-FullShielded value outputs of X — cannot currently be produced through wallet-lib: `prepareTxData` hardcodes `authorities: 0n` on every output it builds (`src/new/sendTransaction.ts:237`, `252`, `275`), the `ISendOutput` union (`src/new/sendTransaction.ts:96`) has no authority variant, and authority flows (delegate/mint/melt) build their tx data through `tokenUtils.prepare*TxData`, bypassing `prepareTxData` and its filter entirely. So this is a latent defect, dead code in its own flow today, that becomes live the moment `prepareTxData` is extended to handle authority outputs alongside shielded ones.

## Source of truth

- **Authority outputs count as token usage** — hathor-core:hathor/verification/transaction_verifier.py:487-489: `verify_tokens` builds `seen_token_indexes` from `txout.get_token_index()` over *all* transparent outputs, authority outputs included, then (lines 502-503) requires the seen indexes to exactly cover `1..len(tx.tokens)`. Listing the token of an authority output in `tokens[]` is therefore consensus-required; omitting it is a wallet-side bug, and including it is not a leak.
- **token_data 0x80 is invalid** — token index 0 resolves to HTR, and HTR cannot carry authorities: hathor-core:hathor/verification/transaction_verifier.py:447-450 asserts `NATIVE` token info has `not can_mint` / `not can_melt`; hathor-core:hathor/transaction/transaction.py:483-486 raises `InvalidToken('output at index N has mint authority, but no input has it')` since HTR authority inputs cannot exist. Either way the transaction is rejected by the full node.
- **FullShielded privacy rationale** — the comment block at `src/new/sendTransaction.ts:580-592` correctly describes why FullShielded-only tokens must be filtered; it just over-applies the rule to authority outputs, whose token is already public.

## Impact

No user is affected today: the trigger is unreachable through any current wallet-lib code path. The risk is forward-looking: any future change that lets `prepareTxData` emit authority outputs (or any external caller that reuses the `tokensWithVisibleOutput` pattern) combined with FullShielded value outputs of the same token would produce a transaction that the wallet signs and broadcasts without error, and that the full node rejects with `InvalidToken` — or, in the worst framing, a transaction whose authority output silently references the wrong token (HTR) at the wire level. The failure mode is silent at the point of corruption (`getTokenDataFromOutput` returns a plausible-looking byte), making it expensive to debug when it eventually fires.

## Recommendation

Two independent fixes, both cheap:

1. Delete the authorities exclusion at `src/new/sendTransaction.ts:597`. An authority output's token is public on the wire and consensus-required in `tokens[]`, so it should always count as "visible":

   ```ts
   for (const out of outputs) {
     const tokenUid = (out as { token?: string }).token;
     if (!tokenUid || tokenUid === HTR_UID) continue;
     tokensWithVisibleOutput.add(tokenUid);
   }
   ```

2. Make `getTokenDataFromOutput` (`src/utils/transaction.ts:788-794`) fail fast instead of silently emitting index 0 for a missing non-HTR token:

   ```ts
   const idx = tokensWithoutHathor.indexOf(output.token);
   if (idx === -1 && output.token !== NATIVE_TOKEN_UID) {
     throw new Error(`Token ${output.token} not found in tx tokens array`);
   }
   const tokenIndex = idx + 1;
   ```

   This converts any future recurrence of this class of bug (a token dropped from `tokens[]` for any reason) into an immediate local error instead of a signed, node-rejected transaction.

## Verification notes

The skeptic panel confirmed all cited code paths:

- `src/new/sendTransaction.ts:597` excludes authority outputs from `tokensWithVisibleOutput`; `tokens[]` is filtered at line 613.
- `src/utils/transaction.ts:790-794` has no `indexOf === -1` guard; a dropped token yields `token_data 0 | 0x80 = 0x80`, reaching the wire via `createTransactionFromData` (`src/utils/transaction.ts:854`).
- Core rejection confirmed: hathor-core:hathor/transaction/transaction.py:483-486 raises `InvalidToken` for an HTR mint authority output (no HTR authority input can exist), and hathor-core:hathor/verification/transaction_verifier.py:447-450 asserts NATIVE has no mint/melt.
- The privacy claim was verified against hathor-core:hathor/verification/transaction_verifier.py:487-489: authority outputs are counted in `seen_token_indexes`, so the exclusion buys zero privacy and actively violates the unused-token rule.
- Severity was adjusted medium → low because the trigger is unreachable through any current path, not merely unlikely: `prepareTxData` hardcodes `authorities: 0n` on every output (`src/new/sendTransaction.ts:237`, `252`, `275`); `ISendOutput` (`src/new/sendTransaction.ts:96`) has no authority variant; the public APIs `prepareTransaction`/`createTransactionFromData` take caller-supplied `tokens[]` and bypass the filter; and authority flows (delegate/mint/melt) build tx data via `tokenUtils.prepare*TxData`, skipping `prepareTxData`. The finding stands as a real latent correctness defect with a sound, low-cost fix — defensive hardening rather than a live bug.
