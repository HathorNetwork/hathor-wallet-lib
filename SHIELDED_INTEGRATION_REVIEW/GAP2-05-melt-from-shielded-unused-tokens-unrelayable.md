# GAP2-05: Melt-from-shielded with createAnotherMelt=false and no token change is unrelayable: the MeltHeader forces the token into tokens[] but header entries and FullShielded outputs do not count as token usage (UnusedTokensError); wallet has no guard

**Severity:** low - **Status:** confirmed by adversarial review

## Summary

When a wallet melts an exact amount of a token whose balance is held in shielded (FullShielded) UTXOs, with `createAnotherMelt: false` and no token change output, the resulting transaction has `tokens = [X]` but zero outputs that reference token X. Core's mempool-hardened `verify_tokens` rejects such a transaction with `UnusedTokensError` — and unlike the transparent case, the token cannot be dropped from `tokens[]` because the MeltHeader's `token_index` must point into it. The wallet builds, signs, and mines this transaction without any guard, so the user only learns of the problem at relay time.

## Location

- `src/utils/tokens.ts:593` — `const tokensArray = [authorityMeltInput.token];` (unconditional)
- `src/utils/tokens.ts:643-655` — token change output only created when `foundAmount > amount`
- `src/utils/tokens.ts:657-667` — melt-authority output only created when `createAnotherMelt` is true
- `src/utils/tokens.ts:737-742` — `tokensArray` returned as the tx `tokens` field with no usage check
- `src/utils/transaction.ts:993-1075` — shielded-tx detection and MeltHeader emission keyed on `tokensArray` membership (entries at 1063-1068)
- `src/new/sendTransaction.ts:593-613` — the existing "tokens with visible output" filter, which lives only in the send path and is bypassed by the melt flow

## Details

`prepareMeltTxData` (`src/utils/tokens.ts`) unconditionally sets the tx token array to the melted token:

```ts
const inputs: IDataInput[] = [authorityMeltInput];
const outputs: IDataOutputWithToken[] = [];
const tokensArray = [authorityMeltInput.token];   // tokens.ts:593
```

The only two places an output referencing token X can be added are:

1. **Change output** — only when the selected UTXOs overshoot the melt amount (`tokens.ts:643-655`):

```ts
if (foundAmount > amount) {
  const cAddress = await storage.getChangeAddress({ changeAddress });
  outputs.push({ ..., token, authorities: 0n, isChange: true });
}
```

2. **New melt authority output** — only when `createAnotherMelt` is true (`tokens.ts:657-667`):

```ts
if (createAnotherMelt) {
  const newAddress = meltAuthorityAddress || (await storage.getCurrentAddress());
  outputs.push({ ..., token, authorities: 2n, value: TOKEN_MELT_MASK, ... });
}
```

The withdraw output (when any) is HTR (`token: NATIVE_TOKEN_UID`), so it never references X. The function returns `{ inputs, outputs, tokens: tokensArray, headers }` (`tokens.ts:737-742`) with no check that any output actually uses X.

The scenario is reachable end-to-end:

- `bestUtxoSelection` selects shielded UTXOs indiscriminately, so a token held fully (or sufficiently) in FullShielded outputs gets shielded inputs selected (`src/utils/utxo.ts:102-114`).
- The melt flow (`src/new/wallet.ts:2616-2624`) goes through `prepareTransaction`, which computes the `excessBlindingFactor` for shielded-inputs / no-shielded-outputs transactions (`src/utils/transaction.ts:1347-1421`), making `isShieldedTx` true at `transaction.ts:993-995`.
- The MeltHeader emission logic (`transaction.ts:1014-1068`) then declares a melt entry with `tokenIndex = tokensArray.indexOf(token) + 1 = 1`, because the per-token delta is negative (shielded inputs are counted via the helpers that preserve token/value, `src/utils/helpers.ts:619-628`) and a melt authority input is present.

Result: a transaction with `tokens = [X]`, a MeltHeader entry referencing index 1, shielded inputs of X, and **no transparent or AmountShielded output carrying token X**.

Two structural facts make this unfixable post-hoc:

1. **Header entries and FullShielded outputs do not count as token usage.** Core's `verify_tokens` builds the seen-index set from transparent output `token_data`, AmountShielded outputs, and nano actions only — never from Mint/MeltHeader entries or FullShielded outputs (which intentionally omit `token_data` for privacy).
2. **The token cannot be removed from `tokens[]`.** The MeltHeader `token_index` is bounds-checked against `len(tx.tokens)`, so a melt of a non-HTR token requires that token listed.

So the wallet must either add an X-referencing output or refuse to build this shape. It currently does neither: the only unused-token mitigation in the codebase is the `tokensWithVisibleOutput` filter in `SendTransaction.prepareTxFromData` (`src/new/sendTransaction.ts:593-613`), which the melt flow does not pass through — and which works by *dropping* the token from `tokens[]`, a strategy unavailable here anyway.

Note: the purely transparent melt-all shape (`createAnotherMelt: false`, exact amount) has the same `UnusedTokensError` exposure — the core rule predates the shielded branch — but there the wallet could at least theoretically drop X from `tokens[]`. The shielded variant is strictly worse because the MeltHeader pins X into `tokens[]`.

## Source of truth

- hathor-core:hathor/verification/transaction_verifier.py:476-504 — `verify_tokens` builds `seen_token_indexes` from `tx.outputs` token indexes, then "Consider shielded output token indexes" adds **only** `AmountShieldedOutput` token_data (491-495); FullShieldedOutput and Mint/MeltHeader entries are excluded. Any token index in `tx.tokens` not in the set raises `UnusedTokensError` (501-504).
- hathor-core:hathor/verification/verification_params.py:33,54 — `harden_token_restrictions` defaults to False but is set `True` in `VerificationParams.for_mempool`, i.e. the rule is enforced at relay/mempool acceptance.
- hathor-core:hathor/verification/transaction_verifier.py:634-662 — `verify_mint_melt_headers_well_formed` bounds every MeltHeader `entry.token_index` to `[1, len(tx.tokens)]` (`InvalidMintMeltHeaderError` otherwise), so the melted token must be present in `tokens[]`.

## Impact

A user melting the exact remaining amount of a token whose balance sits in shielded UTXOs, with `createAnotherMelt: false` (e.g. destroying the last melt authority while burning the rest of the supply, withdraw paid in HTR), gets a transaction that the wallet happily signs and mines, only to have the full node reject it at relay with `UnusedTokensError`. Consequences:

- Wasted signing and proof-of-work, plus a confusing node-side error with no wallet-side hint of the cause.
- No fund loss: inputs are not consumed since the tx never enters the mempool.
- The common case is accidentally saved by the default `createAnotherMelt: true`, which adds an X-referencing authority output — making this a non-default-configuration footgun rather than a mainline breakage. Hence severity low.

## Recommendation

In `prepareMeltTxData` (`src/utils/tokens.ts`), detect the doomed shape and fail fast (or make the authority change output mandatory for shielded melts). Sketch:

```ts
// after change/authority output decisions, before returning
const hasShieldedTokenInput = selectedUtxos.utxos.some(u => isShieldedUtxo(u));
const hasTokenReferencingOutput =
  foundAmount > amount /* change */ || createAnotherMelt /* authority */;
if (hasShieldedTokenInput && !hasTokenReferencingOutput) {
  throw new SendTxError(
    'Melting shielded-held tokens with createAnotherMelt=false and no change ' +
      'produces an unrelayable transaction (unused token): add a change or ' +
      'keep the melt authority output.'
  );
}
```

Alternatively, force the melt-authority output whenever the inputs include shielded UTXOs and no other X-referencing output exists, documenting that shielded melts always re-create the authority. Per project convention (explicit options over inference), the fail-fast error is the safer first step; a follow-up could extend the same guard to the purely transparent melt-all shape, which shares the exposure.

## Verification notes

The skeptic panel confirmed every link in the chain:

1. `tokens.ts:593` unconditionally sets `tokensArray = [X]`, returned as `tokens` at `tokens.ts:737-742`; the only X-referencing outputs come from change (`643-655`, requires `foundAmount > amount`) or the melt authority (`657-667`, requires `createAnotherMelt`).
2. The scenario is reachable: `bestUtxoSelection` selects shielded UTXOs indiscriminately (`src/utils/utxo.ts:102-114`); the melt flow (`src/new/wallet.ts:2616-2624`) reaches `prepareTransaction`, which computes `excessBlindingFactor` for shielded-inputs/no-shielded-outputs (`src/utils/transaction.ts:1347-1421`), so `isShieldedTx` is true and a MeltHeader with `tokenIndex = 1` is emitted (`transaction.ts:993-1075`; shielded input token/value preserved via `src/utils/helpers.ts:619-628`).
3. Core source of truth verified: `verify_tokens` counts transparent outputs + AmountShielded outputs + nano actions only; FullShieldedOutput and Mint/MeltHeader entries are excluded, raising `UnusedTokensError`; enforced at relay via `harden_token_restrictions=True` in `VerificationParams.for_mempool`.
4. MeltHeader `token_index` is bounds-checked against `len(tx.tokens)`, so X cannot be dropped from `tokens[]` — the shielded variant is structurally unfixable without an X-referencing output.
5. No wallet guard exists: the tokens-visible-output filter lives only in the send path (`src/new/sendTransaction.ts:593-613`), which the melt flow bypasses; a grep for any unused-token / `createAnotherMelt` guard in the melt path found nothing.
6. Severity low is appropriate: relay-time rejection after signing/PoW (wasted work, confusing error, no fund loss) in a non-default configuration.
