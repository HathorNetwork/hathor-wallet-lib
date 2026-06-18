# GAP3-01: FEE-version token mint/melt/create contaminated by shielded UTXOs builds txs hathor-core deterministically rejects (per-entry FEE_PER_OUTPUT fold never funded; chargeable-input accounting diverges)

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** GAP2-02 (FEE-version token mint/melt with any shielded input builds node-rejected txs) — merged here. Related but distinct: GAP2-06 covers the same FEE-version divergence on the regular shielded *send* path (`SendTransaction.prepareTxData` phantom-output fee).

## Summary

The token-administration builders (`prepareMintTxData`, `prepareMeltTxData`, `prepareCreateTokenData`) fund and declare FEE-version token fees with purely transparent semantics. But UTXO selection deliberately mixes shielded UTXOs into any funding pool, and once a shielded input is present the transaction takes hathor-core's shielded verification path, which (a) charges an extra `FEE_PER_OUTPUT` in HTR on the output side per Mint/Melt header entry for FEE-version tokens — an amount the wallet never funds — and (b) excludes shielded inputs from chargeable-input accounting, while the wallet's `Fee.calculate` includes them. Either divergence makes the node reject the transaction deterministically, after proof-of-work has already been spent. DEPOSIT-version flows happen to balance and are integration-tested; FEE-version flows have zero shielded test coverage.

## Location

- `src/utils/tokens.ts:459-471` — FEE-version fee computed transparently via `calculateFeeForMintAndCreateToken`
- `src/utils/tokens.ts:478-491` — mint/create HTR selection funds exactly `depositAmount + feeAmount`
- `src/utils/tokens.ts:511-513` — full `feeAmount` declared in the `FeeHeader`
- `src/utils/tokens.ts:629` — melt token-input selection (can pull shielded FEE-token UTXOs)
- `src/utils/tokens.ts:682-701` — melt fee via `Fee.calculate` + HTR selection for exactly `depositAmount + feeAmount`
- `src/utils/fee.ts:65-92` — `Fee.calculate` counts shielded token inputs as chargeable (`hasInputs` rule at lines 84-89)
- `src/utils/utxo.ts:102-113` — `bestUtxoSelection` intentionally includes shielded UTXOs
- `src/utils/transaction.ts:1338-1422` — `prepareTransaction` detects shielded inputs and attaches `UnshieldBalanceHeader`; the excess folds transparent outputs + `FeeHeader` entries only (1392-1412), never the per-entry FEE-version term
- `src/utils/transaction.ts:904-1076` — `_attachShieldedHeaders` auto-declares `MintHeader`/`MeltHeader` from authority inputs + token deltas (996, 1071, 1074)
- `__tests__/integration/shielded_outputs/` — no FEE-version coverage (grep `TokenVersion.FEE` is empty)

## Details

### How the contaminated transaction is built

UTXO selection is shielded-inclusive by design (`src/utils/utxo.ts:102-113`):

```ts
// Select any UTXO (transparent or shielded) up to the requested amount.
// hathor-core accepts shielded inputs in transparent-output-only txs
// (see `is_shielded()` gating in verification_service.py); ...
const options: IUtxoFilterOptions = {
  token,
  authorities: 0n,
  only_available_utxos: true,
  order_by_value: 'desc',
};
```

`tokens.ts` contains zero shielded handling. For mint/create it funds exactly the transparent requirement (`src/utils/tokens.ts:478-480`):

```ts
const requiredAmount = depositAmount + feeAmount;
if (requiredAmount > 0) {
  const selectedUtxos = await utxoSelection(storage, NATIVE_TOKEN_UID, requiredAmount);
```

and declares the full transparent fee in a `FeeHeader` (`src/utils/tokens.ts:511-513`). Melt does the same: token inputs at `tokens.ts:629`, fee via `Fee.calculate` at `tokens.ts:682`, HTR funding for exactly `depositAmount + feeAmount` at `tokens.ts:688-701`.

When any selected UTXO is shielded, the pipeline correctly recognizes the tx as shielded: `prepareTransaction` computes and attaches the `UnshieldBalanceHeader` excess blinding factor (`src/utils/transaction.ts:1338-1422`), and `_attachShieldedHeaders` auto-declares `MintHeader`/`MeltHeader` entries from the authority inputs and token deltas (`src/utils/transaction.ts:996-1076`). So the tx reaches hathor-core's shielded balance verifier *with* mint/melt headers attached — there is no way for it to slip through the transparent path.

### Divergence 1: the per-entry FEE_PER_OUTPUT fold is never funded

For FEE-version tokens, core's Rule M4 fold adds `FEE_PER_OUTPUT` HTR to the output side of the Pedersen balance equation **per Mint/Melt header entry**, on top of the `FeeHeader` entries which are also folded onto the output side. The wallet funds only `depositAmount + feeAmount` and folds only transparent outputs + `FeeHeader` entries into the excess computation (`src/utils/transaction.ts:1392-1412`). Nothing funds the per-entry charge, and the excess scalar lives on G, so it cannot absorb an `H_HTR` amount shortfall. The HTR value equation comes up short by `FEE_PER_OUTPUT × num_entries` and the node raises `ShieldedBalanceMismatchError` — after the wallet has already mined the tx.

Note the wallet *does* auto-declare the Mint/Melt headers; what it never does is fund the per-entry charge those headers trigger. It also cannot simply stuff the charge into the `FeeHeader`, because core's fee check is exact-equality (see Divergence 2) and the per-entry fold is deliberately *outside* the `FeeHeader`.

### Divergence 2: chargeable-input accounting diverges on shielded melts

`Fee.calculate` charges one `FEE_PER_OUTPUT` for a melt with inputs but no outputs (`src/utils/fee.ts:84-89`):

```ts
if (hasInputs && outputCount === 0) {
  fee += FEE_PER_OUTPUT;
}
fee += BigInt(outputCount) * FEE_PER_OUTPUT;
```

Shielded UTXOs pass through `helpers.getDataInputFromUtxo` (`src/utils/helpers.ts:619`) as ordinary `IDataInput`s with `authorities = 0n`, so they count toward `hasInputs`. Core, however, skips shielded inputs entirely when building token info, so for a full melt of shielded FEE-token UTXOs `chargeable_inputs = 0` and the expected fee is `0`. The wallet declares `FEE_PER_OUTPUT` in its `FeeHeader`; core's exact-equality check rejects with `InputOutputMismatch`.

### Why DEPOSIT flows mask this

For DEPOSIT-version tokens the Rule M4 fold moves the 1% deposit/withdraw HTR between sides exactly mirroring what the wallet already funds/produces, so the equation balances. Those flows are covered by `__tests__/integration/shielded_outputs/mint_melt_shielded.test.ts` and `token_creation.test.ts` — which use default DEPOSIT tokens. `grep TokenVersion.FEE` over `__tests__/integration/shielded_outputs/` returns nothing; the only "fee" mentions there are FullShielded output fees, not FEE-version tokens.

## Source of truth

- **Per-entry FEE_PER_OUTPUT fold (both mint and melt):** hathor-core:hathor/verification/transaction_verifier.py:1096-1104, `_fold_mint_melt_entry` FEE branch:

  ```python
  elif version == TokenVersion.FEE:
      # Match transparent semantics: each declared mint/melt action pays
      # one FEE_PER_OUTPUT, regardless of how many shielded recipients ...
      transparent_outputs.append((self._settings.FEE_PER_OUTPUT, htr_uid))
  ```

  Pinned by hathor-core:hathor_tests/tx/test_shielded_mint_melt.py:965-1038 (`test_fee_version_mint_charges_fee_per_output_on_outputs`, `test_fee_version_melt_charges_fee_per_output_on_outputs`, `test_fee_version_charges_per_entry_not_per_amount` — two entries ⇒ two charges).

- **FeeHeader entries also folded onto the output side:** hathor-core:hathor/verification/transaction_verifier.py:987-990.

- **Shielded dispatch:** hathor-core:hathor/transaction/transaction.py:191-193 (`is_shielded()` true on shielded inputs alone); hathor-core:hathor/verification/verification_service.py:333-344 (dispatches `verify_shielded_balance`); mismatch raises `ShieldedBalanceMismatchError` (transaction_verifier.py:1035-1060).

- **Shielded inputs skipped for token info:** hathor-core:hathor/transaction/transaction.py:427-431:

  ```python
  if resolved.mode() != OutputMode.TRANSPARENT:
      # Shielded input: skip for token info (amount is hidden)
      continue
  ```

- **Exact-equality fee check (runs on the shielded branch too):** hathor-core:hathor/verification/transaction_verifier.py:427-430 (`expected_fee != token_dict.fees_from_fee_header` → `InputOutputMismatch`), with `calculate_fee` at hathor-core:hathor/transaction/token_info.py:61-92 charging the no-outputs rule only when `chargeable_inputs > 0`.

## Impact

Any wallet on this branch holding shielded HTR (or shielded FEE-token UTXOs) that performs a FEE-version token administration operation — `mintTokens`, `meltTokens`, or `createNewToken` with a FEE-version token — will, whenever selection pulls in a shielded UTXO, build a transaction that:

1. spends real proof-of-work mining the tx, then
2. is deterministically rejected by every node (`ShieldedBalanceMismatchError` from the unfunded per-entry fold, or `InputOutputMismatch` from the chargeable-input divergence on all-shielded melts).

Selection is indiscriminate by design and the token-admin path offers no opt-out, so this is a reproducible functional break of an entire operation class, not an edge case. No funds are lost and no inflation is possible (the node rejects), which keeps this at high rather than critical.

## Recommendation

Two options, not mutually exclusive:

1. **Safest / simplest:** exclude shielded UTXOs from token-administration funding selection by default (see GAP3-02), so the contaminated path cannot arise. FEE-version token admin then always travels the transparent verification path the builders were written for.

2. **Shielded-aware accounting**, if shielded funding of token admin is desired:
   - In `prepareMintTxData` / `prepareMeltTxData` / `prepareCreateTokenData`, detect whether any selected UTXO has `utxo.shielded === true`. If so and the token is FEE-version, add `FEE_PER_OUTPUT` per prospective Mint/Melt header entry to `requiredAmount` — and keep that amount **out** of the `FeeHeader` (it is consumed by the Rule M4 fold, and adding it to the header would break core's exact-equality check).
   - Align `Fee.calculate` with core by excluding shielded inputs from the chargeable-input (`hasInputs`) count (`src/utils/fee.ts:84-89`), e.g. by threading a `shielded` flag through `IDataInput`/`getDataInputFromUtxo` or passing the UTXO set.
   - The `prepareTransaction` excess computation (`src/utils/transaction.ts:1392-1412`) does not need the fold term added — the per-entry charge is an `H_HTR` amount, not a G-scalar — but the extra funded HTR input must land as a transparent output-side amount (it is consumed by the fold, so the funding input simply has no matching change).

Either way, add integration tests: FEE-version mint, melt, and `createNewToken` funded by shielded HTR, and a melt of shielded FEE-token UTXOs, under `__tests__/integration/shielded_outputs/`.

## Verification notes

The skeptic panel confirmed every element independently, on both sides:

- **Contamination path is real:** `bestUtxoSelection` includes shielded UTXOs by design (`src/utils/utxo.ts:102-113`, with an explanatory comment confirming intent); `tokens.ts` has no shielded exclusion; mint/create and melt fund exactly `depositAmount + feeAmount` (`src/utils/tokens.ts:478-491`, `682-701`).
- **The contaminated tx provably reaches core's shielded branch with mint/melt headers:** `prepareTransaction` attaches `UnshieldBalanceHeader` for shielded inputs (`src/utils/transaction.ts:1338-1422`), `_attachShieldedHeaders` auto-declares `MintHeader`/`MeltHeader` (`src/utils/transaction.ts:996-1076`); core's `is_shielded()` is true on shielded inputs alone and dispatches `verify_shielded_balance`.
- **The fold and the shortfall are pinned by core's own tests** (hathor_tests/tx/test_shielded_mint_melt.py:965-1038, including the two-entries-⇒-two-charges case). A grep for `FEE_PER_OUTPUT` over wallet `src/` shows no shielded-aware adjustment anywhere, and the excess scalar rides on G so it cannot close an `H_HTR` amount gap.
- **Second divergence verified end-to-end:** wallet counts shielded inputs as chargeable (`src/utils/fee.ts:84-89` via `getDataInputFromUtxo`, `src/utils/helpers.ts:619`), core skips them (`transaction.py:427-431`), and the fee check is exact equality on the shielded branch too (`transaction_verifier.py:427-430`).
- **Coverage gap verified:** `grep TokenVersion.FEE` over `__tests__/integration/shielded_outputs/` is empty; the existing S-series mint/melt/creation tests use default DEPOSIT tokens, which is exactly why this bug is invisible to the current suite.
- **One refinement applied:** an earlier phrasing ("never funds nor declares this fold") overstated — the wallet does auto-declare the Mint/Melt headers; what it never does is fund the per-entry charge, and its `FeeHeader` cannot carry it without breaking the exactness check. The report text above reflects this.
- **Severity:** high confirmed — deterministic post-PoW consensus rejection of all FEE-version token-admin operations for any wallet holding shielded UTXOs, with no opt-out in the selection path; no direct fund loss, so not critical.

## Evidence folded from GAP2-02 (merged duplicate)

- The melt-side FeeHeader is computed by `Fee.calculate` over **all** selected inputs, including shielded ones (`src/utils/tokens.ts:681-686`; flat per-input charge at `src/utils/fee.ts:85-87`), while core's `token_dict` excludes shielded inputs from chargeable-input accounting.
- The excess-blinding-factor output entries cover only real outputs + FeeHeader entries (`src/utils/transaction.ts:1388-1418`) — nothing ever funds the per-Mint/Melt-entry `FEE_PER_OUTPUT` charge that core's Rule M4 fold (core commit 040674bc) demands for FEE-version tokens.
- `_attachShieldedHeaders` declares Mint/Melt header entries with no `TokenVersion` awareness at all (`src/utils/transaction.ts:993-1076`).
