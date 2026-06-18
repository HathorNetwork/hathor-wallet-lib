# GAP3-03: prepareTransaction's unshield fallback silently skips shielded inputs with missing UTXO record or missing blindingFactor, producing node-rejected txs where SendTransaction throws

**Severity:** medium - **Status:** confirmed by adversarial review

**Also reported as:** GAP2-04 (excess-fallback silently skips shielded inputs, producing an unbalanced unshield header) — merged here.

## Summary

`transactionUtils.prepareTransaction` contains a fallback that computes the excess blinding factor (and thus the `UnshieldBalanceHeader`) for full-unshield transactions built outside `SendTransaction` — i.e. all token-administration flows. When iterating the tx's inputs, it silently `continue`s past any input whose UTXO record is missing from storage or whose shielded record lacks its `blindingFactor`. The result is a transaction that is mined locally (PoW spent) and then deterministically rejected by the fullnode, either for a missing unshield balance header or for a Pedersen balance mismatch. The equivalent condition in `SendTransaction.prepareTxData` throws a clear `SendTxError` before any mining — the two paths are asymmetric for no good reason.

## Location

- src/utils/transaction.ts:1359-1370 — the silent-skip fallback loop (`if (!utxo) continue;` / `if (!utxo.blindingFactor) continue;`)
- src/new/sendTransaction.ts:471-477 — the strict counterpart that throws `SendTxError` for the same condition
- src/utils/transaction.ts:961-969 — `UnshieldBalanceHeader` is only attached when `txData.excessBlindingFactor` is set
- src/new/wallet.ts:2243→2310, 2450→2510, 2566→2624, 2681→2728, 2797→2842 — token-admin flows that reach the fallback directly
- src/utils/storage.ts:673-681 — the codebase's own comment documenting this exact failure mode

## Details

The fallback exists precisely because token-admin flows bypass `SendTransaction.prepareTxData` — its own comment says so (src/utils/transaction.ts:1338-1340):

```ts
// Full-unshield detection for tx paths that don't go through
// SendTransaction.prepareTxData (notably `createNewToken` /
// `prepareCreateNewToken`, which build txData directly via tokens.ts).
```

Inside it, the input loop degrades silently on bad storage state (src/utils/transaction.ts:1359-1370):

```ts
for (const inp of txData.inputs) {
  const utxo = await storage.getUtxo({ txId: inp.txId, index: inp.index });
  if (!utxo) continue;
  if (utxo.shielded) {
    if (!utxo.blindingFactor) continue;
    shieldedInputs.push({
      value: utxo.value,
      valueBlindingFactor: Buffer.from(utxo.blindingFactor, 'hex'),
      ...
```

Two failure shapes follow:

1. **All shielded inputs skipped** (e.g. every shielded record was overwritten with a bare record): `shieldedInputs.length === 0`, so no excess is computed, `txData.excessBlindingFactor` stays unset, and `createTransactionFromData` never attaches an `UnshieldBalanceHeader` (src/utils/transaction.ts:961-969). The fullnode rejects with "a full-unshield tx … must carry an unshield balance header".
2. **Some shielded inputs skipped**: an excess scalar is computed over an incomplete set of `r_in` terms, so the header is attached but carries the wrong value. The fullnode's balance verification fails with `ShieldedBalanceMismatchError`.

Both rejections happen only after the wallet has already mined the transaction (PoW spent), and surface to the user as an opaque fullnode error rather than an actionable local one.

Contrast with the send path, which treats the identical condition as a hard error before any crypto or mining work (src/new/sendTransaction.ts:471-477):

```ts
if (utxo?.shielded) {
  if (!utxo.blindingFactor) {
    throw new SendTxError(
      `Shielded input ${inp.txId}:${inp.index} is missing blindingFactor — ` +
        'cannot satisfy the homomorphic balance equation.'
    );
  }
```

The bare-record condition is not hypothetical. The codebase documents that a metadata update (first_block confirmation, height change) used to overwrite a correctly-saved shielded UTXO with a record missing `shielded: true` / `blindingFactor`, and names exactly this fullnode rejection as the consequence (src/utils/storage.ts:673-681):

```ts
// Without this, a metadata update (first_block confirmation, height
// change, etc.) overwrites a correctly-saved shielded UTXO with a
// bare record missing `shielded: true` / `blindingFactor`. The next
// send then can't compute the excess blinding factor for the
// unshield path and the fullnode rejects with
// "full-unshield tx … must carry an unshield balance header".
```

That specific write path was fixed, but the fallback still degrades silently. Any future store path — or any third-party `IStore` implementation that fails to round-trip the optional `shielded` / `blindingFactor` / `assetBlindingFactor` fields — silently reintroduces the post-PoW failure for every token-admin flow.

## Source of truth

The fullnode enforces both consequences post-PoW, in `_verify_shielded_balance`:

- hathor-core:hathor/verification/transaction_verifier.py:1038-1042 — a tx with shielded inputs and no shielded outputs **must** carry an unshield balance header:

  ```python
  if has_shielded_inputs_ and not has_shielded_outputs_ and not has_excess:
      raise ShieldedBalanceMismatchError(
          'a full-unshield tx (shielded inputs, no shielded outputs) must carry an '
          'unshield balance header'
      )
  ```

- hathor-core:hathor/verification/transaction_verifier.py:1048-1060 — `verify_balance(...)` with a wrong excess scalar raises `ShieldedBalanceMismatchError('shielded balance equation does not hold')`.

There is no leniency on the core side: the excess scalar must equal the exact sum of input value-blinding factors (transparent terms contribute zero), so omitting even one shielded input's `r` guarantees rejection.

## Impact

Affected flows: `createNewToken` / `prepareCreateNewToken`, `prepareMintTokensData`, `prepareMeltTokensData`, `prepareDelegateAuthorityData`, `prepareDestroyAuthorityData` (src/new/wallet.ts:2310, 2510, 2624, 2728, 2842) — i.e. every token-administration operation that may spend shielded UTXOs (typically the HTR deposit/fee inputs selected automatically).

Concrete scenario: a wallet whose store has lost the `blindingFactor` on a shielded HTR UTXO (custom `IStore`, migration bug, or a regression like the one documented in src/utils/storage.ts) mints a token. Input selection picks the degraded shielded UTXO; the fallback skips it; the tx is built, signed, and mined; the fullnode rejects it. The user pays the PoW cost, gets a cryptic core error, and has no indication that the root cause is local storage state. Worse, in the partial-skip case the wallet attaches a header that looks well-formed, making diagnosis harder.

This is a latent fail-silent inconsistency rather than an active bug today (the known internal trigger was fixed), which is why it is rated medium rather than high.

## Recommendation

Mirror `SendTransaction.prepareTxData`'s behavior in the fallback: fail fast with a descriptive error instead of `continue`. Sketch for src/utils/transaction.ts:1359-1370:

```ts
for (const inp of txData.inputs) {
  const utxo = await storage.getUtxo({ txId: inp.txId, index: inp.index });
  if (!utxo) {
    throw new Error(
      `Input ${inp.txId}:${inp.index} not found in storage — cannot determine ` +
        'whether it is shielded when computing the unshield excess blinding factor.'
    );
  }
  if (utxo.shielded) {
    if (!utxo.blindingFactor) {
      throw new Error(
        `Shielded input ${inp.txId}:${inp.index} is missing blindingFactor — ` +
          'cannot satisfy the homomorphic balance equation.'
      );
    }
    ...
```

Consider also validating `assetBlindingFactor` for FullShielded-mode UTXOs (a FullShielded input with a missing `assetBlindingFactor` would silently fall back to `ZERO_TWEAK` at src/utils/transaction.ts:1367-1369 and likewise produce a wrong excess). This converts a guaranteed post-PoW node rejection into an immediate, actionable local error for all token-administration flows, and brings the two code paths into agreement.

## Verification notes

The skeptic panel confirmed all elements against the worktrees:

1. Silent skip verified verbatim at src/utils/transaction.ts:1360-1363 (`if (!utxo) continue;` / `if (!utxo.blindingFactor) continue;`).
2. Asymmetric strict path verified at src/new/sendTransaction.ts:471-477 (throws `SendTxError` for the identical missing-blindingFactor condition).
3. Reachability verified: `prepareCreateNewToken` (src/new/wallet.ts:2243→2310), `prepareMintTokensData` (2450→2510), `prepareMeltTokensData` (2566→2624), `prepareDelegateAuthorityData` (2681→2728), `prepareDestroyAuthorityData` (2797→2842) all call `prepareTransaction` directly, bypassing `SendTransaction`'s check; the fallback's own comment (src/utils/transaction.ts:1338-1340) confirms these flows depend on it. `UnshieldBalanceHeader` is attached only when `excessBlindingFactor` is set (src/utils/transaction.ts:961-969); an exhaustive grep found no other validation layer.
4. Core consequences verified: hathor-core:hathor/verification/transaction_verifier.py:1038-1042 (header required for full-unshield) and 1048-1060 (`ShieldedBalanceMismatchError` on wrong excess) — both post-PoW rejections.
5. The bare-record trigger is documented in the codebase's own comment at src/utils/storage.ts:673-681, naming the exact fullnode error string.
6. Caveat keeping this medium, not high: the known internal write-path trigger (`processMetadataChanged`) was already fixed, so today the condition requires a custom `IStore` or a future regression — it is a fail-silent latent inconsistency, not an active bug.

## Evidence folded from GAP2-04 (merged duplicate)

- The downstream `isShieldedTx` gate (`src/utils/transaction.ts:993-996`) also degrades when **all** shielded inputs are skipped — the transaction can then additionally lose its Mint/Melt declaration, compounding the node-side rejection modes.
- UTXO selection performs no `blindingFactor`-presence check when handing out shielded UTXOs (`src/utils/utxo.ts:102-114`), and `blindingFactor?` is optional on both `IShieldedOutputEntry` and `IUtxo` (`src/types.ts:352,473`), so the degraded storage state is representable by design and must be guarded at use sites.
