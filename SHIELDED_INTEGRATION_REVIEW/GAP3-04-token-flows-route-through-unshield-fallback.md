# GAP3-04: Premise corrections: token flows DO route through the unshield fallback, Mint/Melt headers ARE declared, and DEPOSIT-version shielded token ops are integration-tested

**Severity:** info - **Status:** confirmed by adversarial review

## Summary

During the review there was a suspected gap that the token-operation entry points (`createNewToken`, `mintTokens`, `meltTokens`, `delegateAuthority`, `destroyAuthority`) might bypass the shielded-header machinery, producing transactions that the fullnode rejects (missing `UnshieldBalanceHeader` and/or undeclared mint/melt). This finding records that the premise is **false**: all five entry points funnel through `transactionUtils.prepareTransaction`, whose full-unshield fallback sets `txData.excessBlindingFactor` before the transaction object is built, which in turn fires the `_attachShieldedHeaders` gate that constructs the Mint/Melt declaration headers core requires. DEPOSIT-version token operations funded by shielded HTR are exercised end-to-end against a real node by the `mint_melt_shielded` integration suite. The real residual gaps are tracked separately as GAP3-01 (FEE-version divergences), GAP3-02 (consent/opt-out), and GAP3-03 (silent-skip robustness).

## Location

- src/utils/transaction.ts:1338-1422 — full-unshield fallback in `prepareTransaction` (sets `excessBlindingFactor`)
- src/utils/transaction.ts:1425 — `createTransactionFromData` runs after the fallback
- src/utils/transaction.ts:883, 888 — `_attachShieldedHeaders` called from both the TCT and regular-tx branches
- src/utils/transaction.ts:993-1076 — `isShieldedTx` gate plus Mint/Melt delta computation and header construction
- src/new/wallet.ts:2310 (`createNewToken` path), :2510 (`mintTokens`), :2624 (`meltTokens`), :2728 (`delegateAuthority`), :2842 (`destroyAuthority`) — all call `transactionUtils.prepareTransaction`
- __tests__/integration/shielded_outputs/mint_melt_shielded.test.ts:55, 99, 147, 196, 244 — scenarios S.0-S.4
- __tests__/integration/shielded_outputs/token_creation.test.ts — additional TCT coverage

## Details

### (a) All token entry points route through the fallback

Each of the five token-operation methods in `src/new/wallet.ts` builds an `IDataTx` via the `tokens.ts` helpers and then calls `transactionUtils.prepareTransaction(txData, pin, this.storage, ...)`:

- `createNewToken` → src/new/wallet.ts:2310
- `mintTokens` → src/new/wallet.ts:2510
- `meltTokens` → src/new/wallet.ts:2624
- `delegateAuthority` → src/new/wallet.ts:2728
- `destroyAuthority` → src/new/wallet.ts:2842

`prepareTransaction` contains a fallback specifically for these paths (which do not go through `SendTransaction.prepareTxData`):

```ts
// src/utils/transaction.ts:1347-1421 (abridged)
if (
  !txData.excessBlindingFactor &&
  (!txData.shieldedOutputs || txData.shieldedOutputs.length === 0)
) {
  const shieldedInputs: Array<IBlindingEntry> = [];
  ...
  for (const inp of txData.inputs) {
    const utxo = await storage.getUtxo({ txId: inp.txId, index: inp.index });
    ...
    if (utxo.shielded) { ... shieldedInputs.push({ value, valueBlindingFactor, generatorBlindingFactor }); }
    ...
  }
  if (shieldedInputs.length > 0) {
    ...
    const excess = await cryptoProvider.computeBalancingBlindingFactor(
      0n, ZERO_TWEAK, [...shieldedInputs, ...transparentInputs], transparentOutputEntries
    );
    txData.excessBlindingFactor = excess;   // :1420
  }
}
const network = storage.config.getNetwork();
const tx = this.createTransactionFromData(txData, network);  // :1425
```

The key ordering fact: `txData.excessBlindingFactor` is set at line 1420, **before** `createTransactionFromData` runs at line 1425. The fallback also folds fee-header amounts into the transparent output side (src/utils/transaction.ts:1402-1412) so the G-term sum stays correct.

`delegateAuthority` and `destroyAuthority` spend only authority UTXOs. Authority outputs can never be shielded (core's `verify_authority_restriction` rejects shielded authorities with `ShieldedAuthorityError`), so the fallback finds no shielded inputs for them and they correctly remain fully transparent — no headers, no gate firing.

### (b) The Mint/Melt declaration gate fires for contaminated token ops

`createTransactionFromData` calls `_attachShieldedHeaders` from both branches — the `CreateTokenTransaction` branch at src/utils/transaction.ts:883 and the regular `Transaction` branch at :888. Inside, the Mint/Melt block is gated on:

```ts
// src/utils/transaction.ts:993-995
const isShieldedTx =
  (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) ||
  !!txData.excessBlindingFactor;
```

Because the fallback set `excessBlindingFactor` first, a token op funded by shielded UTXOs ("contaminated") enters the declaration block (:996-1076), which:

- Computes per-token deltas counting **both** transparent and shielded sides: transparent outputs (:1029-1034, authority outputs excluded at :1031), shielded outputs (:1035-1038), and inputs (:1039-1047, authority inputs routed into `mintAuthorityTokens`/`meltAuthorityTokens` at :1041-1044 instead of the delta). Shielded input values are known to the wallet from its own UTXO store, so the delta is exact.
- Declares `MintHeader` only when the delta is positive AND the tx is a TCT or carries a mint authority input (:1056, :1058-1062); symmetric for `MeltHeader` with a melt authority (:1057, :1063-1068).
- For TCTs, uses a `NEW_TOKEN_KEY` sentinel remapped to `tokenIndex = 1` (:1001-1009), matching core's TCT rule.
- Pushes Mint/Melt headers **last** (:1070-1075), after `ShieldedOutputsHeader` (:952) and `UnshieldBalanceHeader` (:969), with any `FeeHeader` arriving via `txData.headers` in the constructor options (:865) — so the canonical ascending header order Fee(0x11) < Shielded(0x12) < Unshield(0x13) < Mint(0x14) < Melt(0x15) holds.

For DEPOSIT-version tokens, the wallet's implicit HTR deposit burn / withdraw output mirrors core's deposit/withdraw folds, so the augmented balance equation closes without any extra wallet-side work.

### (c) Integration coverage exists

`__tests__/integration/shielded_outputs/mint_melt_shielded.test.ts` exercises exactly these paths against a real node:

- S.0 (:55) — `createNewToken` funded by ONLY shielded HTR (relies on the `prepareTransaction` fallback + `UnshieldBalanceHeader`, per the test's own comment)
- S.1 (:99) — mint more tokens directly to a FULLY_SHIELDED output
- S.2 (:147) — melt a FULLY_SHIELDED-held custom-token UTXO into transparent HTR
- S.3 (:196) — melt an AMOUNT_SHIELDED-held custom-token UTXO
- S.4 (:244) — `mintTokens` with shielded HTR funding the deposit

plus `token_creation.test.ts` in the same directory for TCT-specific scenarios.

## Source of truth

The wallet-side construction satisfies every core rule that the suspected gap would have violated:

- hathor-core:hathor/verification/transaction_verifier.py:581-612 — `verify_no_undeclared_mint_melt`: transparent surplus/deficit on a non-HTR token in a shielded tx must be covered by a Mint/Melt header entry. The wallet's delta computation produces exactly these entries.
- hathor-core:hathor/verification/transaction_verifier.py:672-691 — Rule M1: Mint/Melt headers are valid only when the tx carries a `ShieldedOutputsHeader` **or** `UnshieldBalanceHeader`. The fallback-set `excessBlindingFactor` guarantees the `UnshieldBalanceHeader` is present in the full-unshield case.
- hathor-core:hathor/verification/transaction_verifier.py:1144-1202 — Rule M2: each Mint/Melt entry needs a matching transparent authority input, with an explicit TCT exemption for `token_index == 1`. The wallet gates declarations on authority presence (:1056-1057) and uses the sentinel remap for TCT.
- hathor-core:hathor/verification/token_creation_transaction_verifier.py:45-56 — a shielded TCT must have exactly one MintHeader entry with `token_index = 1`. Satisfied by the `NEW_TOKEN_KEY` sentinel + `tokenIndex = 1` remap.
- hathor-core:hathor/verification/transaction_verifier.py (`verify_authority_restriction`, called at :616) — authorities can never be shielded (`ShieldedAuthorityError`), which is why `delegateAuthority` / `destroyAuthority` are structurally incapable of triggering the shielded paths.

## Impact

None — this is a premise-correction entry. Its purpose is to prevent the review from double-reporting a "token operations bypass shielded headers" gap that does not exist, and to document the verified routing so future reviewers do not have to re-trace it. Without this record, the same false positive would likely be re-raised whenever someone audits `tokens.ts`/`wallet.ts` in isolation, since the header attachment happens two layers down in `prepareTransaction` → `createTransactionFromData` → `_attachShieldedHeaders`.

## Recommendation

No action beyond the genuinely open findings GAP3-01 (FEE-version divergences), GAP3-02 (consent/opt-out gap), and GAP3-03 (silent-skip robustness). When fixing those:

- Keep the S.0-S.4 suite in `__tests__/integration/shielded_outputs/mint_melt_shielded.test.ts` green — it is the regression net for this entire routing chain.
- Extend it with FEE-version token scenarios so the GAP3-01 fixes get the same end-to-end coverage the DEPOSIT-version paths already have.

## Verification notes

The skeptic panel re-read every cited line rather than trusting the original tracer:

- Entry points confirmed by direct grep: all five `prepareTransaction` call sites in src/new/wallet.ts (:2310, :2510, :2624, :2728, :2842).
- Ordering confirmed: the fallback sets `txData.excessBlindingFactor` at src/utils/transaction.ts:1420; `createTransactionFromData` runs at :1425; `_attachShieldedHeaders` is invoked at :883 (TCT) and :888 (regular tx); the `isShieldedTx` gate at :993-995 keys on shielded outputs OR `excessBlindingFactor`.
- Delta semantics confirmed: shielded output values counted at :1035-1038; shielded input values via `txData.inputs` at :1039-1047 (wallet-known values); authority inputs/outputs excluded (:1031, :1041-1044); mint gated on authority-or-TCT (:1056), melt on melt authority (:1057); `tokenIndex = tokensArray.indexOf(token) + 1` (:1060, :1065); headers pushed last (:1071, :1074) so ascending header-id order holds.
- Core counterparts confirmed at the cited lines in /tmp/review-hathor-core-shielded (Rules M1, M2, `verify_no_undeclared_mint_melt`, the TCT one-entry rule, and the authority-can't-be-shielded restriction).
- Test scenarios confirmed at the cited lines (S.0:55, S.1:99, S.2:147, S.3:196, S.4:244) and verified to exercise the contaminated-token-op paths described above.
- Severity "info" is appropriate: this entry confirms correct behavior and corrects a review premise; it requests no code change.
