# GAP2-01: Mint/Melt auto-declaration delta includes shielded values while core's undeclared-mint/melt check is transparent-only — authority input riding with a shielding move builds an unfixable, node-rejected tx instead of being refused

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

The auto-declaration heuristic in `_attachShieldedHeaders` decides whether to emit a `MintHeader`/`MeltHeader` from a per-token delta computed over BOTH the transparent and shielded sides of the transaction. hathor-core's `verify_no_undeclared_mint_melt`, however, triggers on the TRANSPARENT-ONLY `token_dict` surplus/deficit — shielded inputs and outputs contribute nothing to it. The two disagree exactly when an authority input rides along with a supply-preserving shielding move (e.g. transparent 100 X in → fully-shielded 100 X out, plus a melt-authority input of X): the wallet declares nothing, the node demands a `MeltHeader`, and — because any declared amount ≥ 1 breaks the Pedersen balance equation — no consensus-valid construction of that input set exists. The wallet should refuse such input sets before signing/PoW; instead it ships a doomed transaction.

## Location

- `src/utils/transaction.ts:1011-1076` — the delta computation and header-emission logic inside `_attachShieldedHeaders` (heuristic block starts at `src/utils/transaction.ts:996`)
- `src/utils/transaction.ts:1021-1028` — in-code rationale that reasons only about the balance equation, not core's presence check
- `src/utils/transaction.ts:1327` (`prepareTransaction`) — public low-level entry point reaching the heuristic (calls at `src/utils/transaction.ts:883` and `:888`)
- `src/new/sendTransaction.ts:1287-1295` — the only guard against authority inputs, gating just the high-level send flow

## Details

When a transaction has shielded outputs or an excess blinding factor and no explicit Mint/Melt header, `_attachShieldedHeaders` runs a heuristic to auto-declare mint/melt. The per-token delta sums outputs (positive) and inputs (negative) across **both** sides:

```ts
// src/utils/transaction.ts:1029-1047
for (const out of txData.outputs) {
  if (out.value <= 0n) continue;
  if ((out.authorities ?? 0n) !== 0n) continue;
  const token = 'token' in out ? out.token : implicitTokenKey;
  bumpDelta(token, out.value);
}
for (const so of txData.shieldedOutputs ?? []) {        // <-- shielded outputs counted
  if (so.value <= 0n) continue;
  bumpDelta(so.token, so.value);
}
for (const inp of txData.inputs) {
  const auth = inp.authorities ?? 0n;
  if (auth !== 0n) {
    if ((auth & TOKEN_MINT_MASK) !== 0n) mintAuthorityTokens.add(inp.token);
    if ((auth & TOKEN_MELT_MASK) !== 0n) meltAuthorityTokens.add(inp.token);
    continue;
  }
  if (inp.value > 0n) bumpDelta(inp.token, -inp.value); // <-- shielded inputs counted too
}
```

Headers are then emitted **only** when this all-sides delta is nonzero and the matching authority is spent (`src/utils/transaction.ts:1058-1068`): `delta > 0n && canMint` → MintHeader entry, `delta < 0n && canMelt` → MeltHeader entry, otherwise nothing.

This amount is the correct one for core's **balance equation** (`verify_shielded_balance` folds the declared amount into the commitment sums, so it must be the all-sides net — the in-code comment at `src/utils/transaction.ts:1021-1028` explains exactly this). But core runs a second, independent check the heuristic never mirrors: `verify_no_undeclared_mint_melt`, which looks at the **transparent-only** token accounting. The divergent case:

- Inputs: transparent 100 X (non-authority) + one melt-authority UTXO of X (e.g. consolidating/destroying an authority in the same tx)
- Outputs: one FullShielded output of 100 X

Wallet heuristic: delta = +100 (shielded out) − 100 (transparent in) = 0 → declares nothing. Core: transparent `token_dict[X].amount = -100` (shielded output never enters `token_dict`), `can_melt = true`, `has_been_melted()` → demands a MeltHeader entry for X → `ShieldedMintMeltForbiddenError`. The symmetric unshield direction (mint authority riding, shielded in → transparent out) fails the same way against the mint branch.

**No valid construction exists for this input/output set.** A zero-amount entry is forbidden at the wire level (amount must be ≥ 1, enforced at both construction and deserialization). And any amount ≥ 1 is folded by `_fold_mint_melt_entry` onto the transparent output side of the balance equation as a public `amount·H_X` term — but the shielded output's commitment already carries the full `100·H_X` there, and blinding factors only span the `G` component, so no blinding can cancel the extra `H_X` term. Declaring breaks `verify_shielded_balance`; not declaring breaks `verify_no_undeclared_mint_melt`. The only correct behavior is to refuse the input set before signing/PoW. The wallet has no such guard: the sole authority-input block is `checkUnspentInput` in the high-level send flow (`src/new/sendTransaction.ts:1287-1295`, "XXX: We are NOT enabling authority outputs for now"), which does not gate the public low-level `prepareTransaction` path.

## Source of truth

- hathor-core:hathor/verification/verification_service.py:339-344 — `verify_no_undeclared_mint_melt(tx, _token_dict)` runs for **every** shielded tx, before `verify_shielded_balance`.
- hathor-core:hathor/verification/transaction_verifier.py:599-611 — raises `ShieldedMintMeltForbiddenError` when `token_info.can_melt and token_info.has_been_melted() and token_uid not in melt_token_uids` (and the mint mirror at 602-606). `has_been_melted()` is simply transparent amount < 0 (hathor-core:hathor/transaction/token_info.py:39-44).
- hathor-core:hathor/transaction/transaction.py:419-431 — `token_dict` is transparent-only on the input side: shielded inputs are explicitly skipped ("Shielded inputs are skipped for token accounting"); authority inputs only set `can_mint`/`can_melt` (440-442).
- hathor-core:hathor/transaction/transaction.py:466-494 — output side iterates only `self.outputs`; shielded outputs are header-borne and never enter `token_dict` (the seeding comment at 470-476 states "shielded inputs contribute nothing to token_dict").
- hathor-core:hathor/verification/transaction_verifier.py:1083-1085 — `_fold_mint_melt_entry` appends `(entry.amount, token_uid)` to the transparent output side (melt) / input side (mint) of `verify_balance` (1048-1058), so any declared amount perturbs the commitment equation the shielded output already balances.
- hathor-core:hathorlib/hathorlib/headers/mint_melt_header.py:57 and 112-115 — entry amount must be in `[1, 2**64)`; a zero-amount "presence-only" entry is impossible.

## Impact

A caller of the public low-level API `transactionUtils.prepareTransaction` (the path used by hathor-wallet-headless custom-tx endpoints and other custom-`txData` consumers — exactly the audience the auto-declaration heuristic was added for) who includes an authority input of token X in a transaction whose net X movement between transparent and shielded sides is zero (or opposite in sign to the transparent-only delta) gets:

1. A fully signed, proof-of-work-mined transaction (wasted signing + PoW),
2. that the node deterministically rejects with an opaque `ShieldedMintMeltForbiddenError`,
3. with no way to fix it by adjusting headers — the input set itself is consensus-invalid for the intended supply-preserving move.

No funds are lost (rejected txs consume no UTXOs) and there is no privacy or consensus risk. None of the wallet's own high-level flows can produce the combination: the send flow rejects authority inputs outright, and the mint/melt flows always produce nonzero, correctly-signed all-sides deltas that the heuristic serves correctly. This is why the severity is medium rather than high: the failure mode is wasted work plus a confusing rejection in a niche low-level construction, but it is a real correctness gap in a public API whose stated purpose is mixed authority+shielded transactions.

## Recommendation

In `_attachShieldedHeaders` (`src/utils/transaction.ts`), compute a **second**, transparent-only per-token delta mirroring core's `token_dict` (transparent non-authority outputs minus transparent non-authority inputs; skip shielded inputs/outputs). Then, per token with a spent authority:

- If the transparent-only delta indicates mint/melt (surplus with mint authority, deficit with melt authority) but the all-sides delta is zero or of the opposite sign, **throw a descriptive error** telling the caller to remove the authority input from the shielding tx — no consensus-valid construction exists for that input set.
- Emit a header entry only when both deltas agree in direction, keeping the **all-sides** amount (which is what `verify_shielded_balance` needs).

Sketch:

```ts
// alongside tokenDelta, track transparent-only:
const transparentDelta = new Map<string, bigint>();
// outputs loop: also bumpTransparent(token, out.value)
// inputs loop (non-authority): bumpTransparent only when the input is NOT a decoded shielded UTXO
// shieldedOutputs loop: do NOT touch transparentDelta

for (const token of tokensArray) {
  const all = tokenDelta.get(token) ?? 0n;
  const transparent = transparentDelta.get(token) ?? 0n;
  const meltDemanded = transparent < 0n && meltAuthorityTokens.has(token);
  const mintDemanded = transparent > 0n && (isCreateToken || mintAuthorityTokens.has(token));
  if ((meltDemanded && all >= 0n) || (mintDemanded && all <= 0n)) {
    throw new SendTxError(
      `Token ${token}: an authority input rides along with a supply-preserving shielded move; ` +
      `the node requires a Mint/Melt declaration the balance equation cannot satisfy. ` +
      `Remove the authority input from this transaction.`
    );
  }
  // ...existing emission on the all-sides delta...
}
```

This requires distinguishing decoded shielded inputs from transparent ones in `txData.inputs`; the data needed (the input's shielded provenance) is already available where shielded inputs are decoded into `txData`.

## Verification notes

The skeptic panel confirmed every load-bearing claim and adjusted severity from high to medium:

1. **Wallet computes all-sides delta, no transparent cross-check anywhere.** Verified at `src/utils/transaction.ts:1029-1047` (shielded outputs added at 1035-1038; decoded shielded inputs subtracted via 1046) with emission gated only on the all-sides delta sign at 1058-1068. Grep across `src/utils/transaction.ts`, `src/shielded/*.ts`, `src/headers/`, `src/schemas.ts` found no compensating guard; the design comment at 1021-1028 argues only about the balance equation.
2. **Core check is transparent-only and unconditional for shielded txs.** hathor-core:hathor/verification/verification_service.py:339-341 runs it for every `is_shielded()` tx; hathor-core:hathor/transaction/transaction.py:429-431 skips shielded inputs in `token_dict`; shielded outputs never appear in `self.outputs`.
3. **Divergence scenario reproduced on paper.** Transparent 100 X in → FullShielded 100 X out + melt-authority X input: wallet delta 0 → no header; core transparent amount −100, `can_melt=true` → `ShieldedMintMeltForbiddenError`.
4. **"Unfixable" claim survived the panel's main refutation attempt** (a zero-amount presence-only entry): amount ≥ 1 is enforced at construction and deserialization (hathor-core:hathorlib/hathorlib/headers/mint_melt_header.py:57, 112-115), and `_fold_mint_melt_entry` (transaction_verifier.py:1083-1085) adds the declared amount as a public `H_X` term that blinding (G-only) cannot cancel against the shielded commitment already balancing the equation. The only construction passing both checks actually melts supply, violating the user's intent.
5. **Reachability as stated.** High-level send blocks authority inputs (`src/new/sendTransaction.ts:1287-1295`); `prepareTransaction` (`src/utils/transaction.ts:1327`) is public and is the documented path for headless/custom-txData consumers. The wallet's own mint/melt flows feed authority inputs through the heuristic but always with nonzero same-direction deltas, so they are unaffected — which is the basis for the medium (not high) severity: node-rejected tx, wasted PoW, no fund loss, recoverable by removing the authority input.
