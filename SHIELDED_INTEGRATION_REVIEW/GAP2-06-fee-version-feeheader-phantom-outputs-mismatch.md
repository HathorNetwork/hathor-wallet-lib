# GAP2-06: FeeHeader for FEE-version tokens is computed over phantom shielded outputs and shielded inputs, diverging from core's transparent-only exact-fee equation — every shielded send of a FEE-version token is built and then rejected

**Severity:** high - **Status:** confirmed by adversarial review

## Summary

When building a shielded transaction, `SendTransaction.prepareTxData` computes the FEE-version-token portion of the `FeeHeader` by running `Fee.calculate` over an outputs list that still contains the phantom transparent stand-ins for every shielded output, and over an inputs list that includes shielded UTXOs. hathor-core computes the expected fee over the transparent-only `token_dict` (shielded outputs live in the header and are never in `tx.outputs`; shielded inputs contribute nothing) plus the flat per-shielded-output fee, and enforces strict equality against the FeeHeader — overpayment is rejected too. The wallet therefore over-declares the fee by roughly one `FEE_PER_OUTPUT` per shielded output of a FEE-version token, so every such transaction is built, signed, mined and then rejected by the node with `InputOutputMismatch`. DEPOSIT-version tokens have no per-output fee and are unaffected, which is why the existing shielded integration suites (all DEPOSIT tokens) pass.

## Location

- src/new/sendTransaction.ts:248-257 — phantom transparent outputs (real token uid, `authorities: 0n`) pushed into `txData.outputs` for every requested shielded output
- src/new/sendTransaction.ts:310-317 — shielded inputs pushed into `txData.inputs` with their token/value, indistinguishable from transparent inputs to the fee calc
- src/new/sendTransaction.ts:342-346 — `Fee.calculate(partialInputs, partialOutputs, ...)` runs with phantoms still present
- src/new/sendTransaction.ts:354-364 — per-shielded-output `shieldedFee` added on top
- src/new/sendTransaction.ts:415-417 — `FeeHeader` built from the inflated `totalFee`
- src/new/sendTransaction.ts:428-433 — phantoms removed from `outputs` only here, after the fee was already computed
- src/utils/fee.ts:67-90 — fee rules: per non-authority output of a FEE-version token, plus flat input rule at lines 85-87; no phantom/shielded awareness
- src/constants.ts:371, 377, 383 — `FEE_PER_OUTPUT = 1n`, `FEE_PER_AMOUNT_SHIELDED_OUTPUT = 1n`, `FEE_PER_FULL_SHIELDED_OUTPUT = 2n`

## Details

For each shielded output requested by the caller, `prepareTxData` adds a phantom transparent output so that UTXO selection accounts for the value:

```ts
// src/new/sendTransaction.ts:246-257
// Phantom output for UTXO selection (removed after shuffle).
const phantom: IDataOutput = {
  address: output.address,
  value: output.value,
  timelock: null,
  authorities: 0n,
  token: output.token,
  type: getAddressType(output.address, network),
};
phantomOutputs.add(phantom);
txData.outputs.push(phantom);
```

The transparent fee is then computed while those phantoms are still in the list:

```ts
// src/new/sendTransaction.ts:337-346
const partialInputs = [...txData.inputs, ...partialTxData.inputs];
const partialOutputs = [...txData.outputs, ...partialTxData.outputs] as IDataOutputWithToken[];

// calculate the fee based in the inputs and outputs, including the change output
// fee is always in HTR
const fee = await Fee.calculate(
  partialInputs,
  partialOutputs,
  await tokens.getTokensByManyIds(this.storage, new Set(tokenMap.keys()))
);
```

`Fee.calculate` (src/utils/fee.ts:67-90) charges, for every FEE-version token, `outputCount * FEE_PER_OUTPUT` where `outputCount` counts every non-authority output carrying that token — phantoms included — and applies a flat `FEE_PER_OUTPUT` when the token has chargeable inputs but zero outputs (lines 85-87). It also counts shielded inputs as chargeable, because user-supplied shielded UTXOs are pushed into `txData.inputs` with their token and `authorities` derived the same way as transparent ones (src/new/sendTransaction.ts:310-317), and the function has no notion of input mode.

The per-shielded-output fee is then added (src/new/sendTransaction.ts:354-364), the `FeeHeader` is created from `totalFee` (lines 415-417), and only afterwards are the phantoms filtered out of the final outputs list (lines 428-433):

```ts
// src/new/sendTransaction.ts:428-433
// Remove phantom outputs (shielded) from the final outputs list.
if (phantomOutputs.size > 0) {
  outputs = outputs.filter(out => !phantomOutputs.has(out));
}
```

So the wire transaction carries N shielded outputs in the header and no corresponding transparent outputs, but its FeeHeader was priced as if those N outputs were transparent FEE-token outputs *in addition to* the shielded-output fee. There is no guard anywhere in the shielded path that rejects or special-cases FEE-version tokens.

Worked example — send 100 of FEE-version token X into two FullShielded outputs, with exact transparent X inputs and no change:

| | Wallet FeeHeader | Core expected fee |
|---|---|---|
| FEE-token output term | 2 phantoms × FEE_PER_OUTPUT = 2 | 0 chargeable outputs, chargeable inputs > 0 → flat FEE_PER_OUTPUT = 1 |
| Shielded-output term | 2 × FEE_PER_FULL_SHIELDED_OUTPUT = 4 | 2 × FEE_PER_FULL_SHIELDED_OUTPUT = 4 |
| **Total** | **6** | **5** |

Core enforces strict equality, so the transaction is rejected with `InputOutputMismatch: Fee amount is different than expected`.

The mismatch is structural, not a one-off: any transaction with N ≥ 1 shielded FEE-token outputs over-declares by approximately N × FEE_PER_OUTPUT (minus at most one flat-rule unit). The single arithmetic coincidence (exactly 1 shielded output, exact inputs, no change: 1 phantom × FPO equals the flat rule's FPO) is unreachable in practice because core's trivial-commitment protection requires at least 2 shielded outputs (hathor-core: hathor/verification/transaction_verifier.py:1219-1227).

Scope notes (from adversarial verification):
- A **pure** unshield of a FEE token (shielded inputs → transparent outputs only) coincidentally agrees with core: there are no phantoms, the flat input rule only fires when `outputCount === 0`, and both sides count the same transparent outputs.
- A **partial** unshield that emits shielded FEE-token change reintroduces the bug (the change becomes a phantom).

## Source of truth

hathor-core replaces the transparent balance equation for shielded transactions with `verify_token_rules`, dispatched in hathor-core:hathor/verification/verification_service.py:339-343:

```python
if isinstance(tx, Transaction) and tx.is_shielded():
    shielded_fee = TransactionVerifier.calculate_shielded_fee(self._settings, tx)
    ...
    self.verifiers.tx.verify_token_rules(self._settings, _token_dict, shielded_fee=shielded_fee)
```

`verify_token_rules` enforces **strict equality** — overpayment is just as invalid as underpayment (hathor-core:hathor/verification/transaction_verifier.py:427-430):

```python
expected_fee = token_dict.calculate_fee(settings, shielded_fee=shielded_fee)
if expected_fee != token_dict.fees_from_fee_header:
    raise InputOutputMismatch(f"Fee amount is different than expected. ...")
```

The `token_dict` it operates on is transparent-only:
- Shielded inputs are skipped entirely (hathor-core:hathor/transaction/transaction.py:428-431: `if resolved.mode() != OutputMode.TRANSPARENT: continue`); `chargeable_inputs` is incremented only for transparent FEE inputs (transaction.py:446-447).
- `chargeable_outputs` is counted only over `self.outputs` (transaction.py:466-497); shielded outputs are header-resident and never appear there.

`calculate_fee` (hathor-core:hathor/transaction/token_info.py:83-91) is: `shielded_fee` + per token, `chargeable_outputs * FEE_PER_OUTPUT` if any chargeable outputs, else a flat `FEE_PER_OUTPUT` if there are chargeable inputs. Constants match the wallet's (`FEE_PER_OUTPUT = 1`; `FEE_PER_AMOUNT_SHIELDED_OUTPUT = 1`, `FEE_PER_FULL_SHIELDED_OUTPUT = 2`).

Note that `verify_shielded_fee` (hathor-core:hathor/verification/transaction_verifier.py:568-578) is only a `>=` floor on the shielded portion and does not relax the strict-equality token-rules check.

## Impact

Any user sending a FEE-version token into shielded outputs — a fully supported combination from the wallet API's point of view — gets a transaction that:

1. passes all client-side validation,
2. is signed,
3. has proof-of-work mined for it (wasted work),
4. and is then deterministically rejected by the fullnode with `InputOutputMismatch ('Fee amount is different than expected')`.

There is no client-side error; the failure surfaces only as a push-tx rejection after mining. The same applies to partial unshields of FEE tokens that produce shielded change. No funds are lost and there is no security impact, but an entire token class (TokenVersion.FEE) is unusable with shielded outputs. The gap is invisible to the current test suite because every token used in `__tests__/integration/shielded_outputs/` is a default DEPOSIT-version token.

## Recommendation

Compute the FEE-token portion of the FeeHeader from core's view of the transaction, in src/new/sendTransaction.ts:

1. Run `Fee.calculate` over outputs **with phantoms excluded** (the `phantomOutputs` set already exists for exactly this filtering — apply it before the fee calc instead of only at lines 428-433):
   ```ts
   const feeOutputs = partialOutputs.filter(out => !phantomOutputs.has(out));
   ```
2. Exclude shielded inputs from the chargeable-input counting (core skips non-TRANSPARENT inputs from `token_dict`). The send pipeline already knows which inputs are shielded; filter them out of the list passed to `Fee.calculate` (or tag them so `Fee.calculate` can skip them).
3. Keep the flat chargeable-inputs rule exactly as `token_info.calculate_fee` does (src/utils/fee.ts:85-87 already mirrors it — it just needs the corrected element lists) and keep the separate `shieldedFee` term (lines 354-364), which already matches core's `calculate_shielded_fee`.

Note the change output for the FEE token is transparent and *does* appear in core's `tx.outputs`, so it must remain in the fee calc — only phantoms and shielded inputs come out.

Also add a FEE-version token case to the shielded integration tests (send with ≥ 2 shielded outputs, partial unshield with shielded change, and pure unshield) to pin fee equality against the node.

## Verification notes

Confirmed independently by three reviewers on both sides of the boundary:

- **Wallet side:** traced the exact ordering in src/new/sendTransaction.ts — phantoms enter `txData.outputs` at 248-257, shielded inputs enter `txData.inputs` with token/value at 310-317, `Fee.calculate` runs at 342-346 with both still present, `shieldedFee` added at 354-364, `FeeHeader` built at 415-417, phantoms removed only at 431-433. src/utils/fee.ts:67-90 confirmed to have no phantom/shielded awareness. No FEE-version guard exists in any shielded path.
- **Core side (source of truth):** shielded dispatch at verification_service.py:339-343; strict equality at transaction_verifier.py:427-430 (overpayment rejected); shielded inputs excluded from `token_dict` at transaction.py:428-431; `chargeable_outputs` counted only over transparent `self.outputs` at transaction.py:466-497; fee formula at token_info.py:83-91; constants equal on both sides.
- **Worked example** recomputed by all reviewers: 2 FullShielded FEE-X outputs with exact inputs → wallet header 6 vs core expected 5 → rejected after sign+mine.
- **Edge cases checked:** the single-shielded-output coincidence is unreachable (core requires ≥ 2 shielded outputs, transaction_verifier.py:1219-1227); pure FEE-token unshield-to-transparent agrees on both sides (no phantoms, no shielded outputs), so the original "every shielded send/unshield" claim was narrowed to: every FEE-token send with shielded outputs, plus partial unshields with shielded change.
- **Test gap confirmed:** zero TokenVersion.FEE usage anywhere in `__tests__/integration/shielded_outputs/`.
- **Severity:** high — deterministic end-to-end breakage of a supported token class with wasted PoW and no client-side error; not critical since there is no fund loss or security impact, and DEPOSIT tokens are unaffected.
