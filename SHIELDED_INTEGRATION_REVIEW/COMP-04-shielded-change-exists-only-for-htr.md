# COMP-04: Shielded change exists only for HTR — partial spends of shielded custom-token UTXOs always emit transparent change, revealing the remaining balance (and the token for FullShielded holdings)

**Severity:** high - **Status:** confirmed by adversarial review

## Summary

The only mechanism that converts change into a shielded output is `convertHtrChangeIfRequested`, and it is hard-filtered to the native token (HTR) fee-change output. Change for any custom token is always built as a plain transparent output, with no conversion hook and no participation in `changeShieldedMode`. Because the default UTXO selector deliberately mixes shielded UTXOs into every send, a partial spend of a shielded custom-token UTXO silently publishes the residual amount on-chain as transparent change — and, for tokens held as FullShielded, also forces the token UID into the public `tokens[]` array, undoing the asset hiding the user paid 2 HTR per output for.

## Location

- src/new/sendTransaction.ts:1060-1112 — `convertHtrChangeIfRequested` (HTR-only shielded-change conversion)
- src/new/sendTransaction.ts:1076-1080 — hard filter `token === HTR_UID && isChange === true`
- src/new/sendTransaction.ts:1069 — no-op when the tx has no other shielded outputs
- src/new/sendTransaction.ts:401-407 — sole call site, applied only to the HTR fee leg (`partialHtrTxData`)
- src/new/sendTransaction.ts:1164-1178 — `_prepareSendTokensData` emits transparent change for any token
- src/new/sendTransaction.ts:330-335 — `prepareSendManyTokensData` loops `_prepareSendTokensData` per token; no shielded hook
- src/new/sendTransaction.ts:593-604, 613 — transparent custom-token change pulls the token UID into `tokens[]`
- src/utils/utxo.ts:102-113 — `bestUtxoSelection` mixes shielded UTXOs into any send by default
- src/types.ts:606-610 — existing-but-unused `shielded` filter in `IUtxoFilterOptions`
- src/new/types.ts:379-391 — `changeShieldedMode` documented as HTR fee-change only

## Details

### 1. The only shielded-change path is HTR-only

`convertHtrChangeIfRequested` is the single place in the library where a transparent change output can become a shielded output. It explicitly searches only for the HTR change output, and bails out entirely if the transaction carries no other shielded outputs:

```ts
// src/new/sendTransaction.ts:1067-1081
if (!mode) return { addedFee: 0n };
if (!wallet) return { addedFee: 0n };
if (shieldedOutputDefs.length === 0) return { addedFee: 0n };
...
const HTR_UID = NATIVE_TOKEN_UID;
const changeIdx = partialHtrTxData.outputs.findIndex(o => {
  const withToken = o as IDataOutputWithToken & { isChange?: boolean };
  return withToken.token === HTR_UID && withToken.isChange === true;
});
```

Its only call site (src/new/sendTransaction.ts:401-407) operates on `partialHtrTxData`, the HTR fee pass produced at :384-392 — custom-token change never flows through it. The option's own documentation confirms the scope:

```ts
// src/new/types.ts:379-384
 * @property changeShieldedMode If set, the HTR fee-change output (when
 *   one would otherwise be created as transparent) is rewritten as a
 *   shielded HTR output in the given mode. ...
```

An exhaustive search for `changeShieldedMode` and any other change-conversion helper across `src/` finds nothing else; the transaction-template interpreter has no shielded support either. There is no alternative mechanism.

### 2. Custom-token change is always transparent

`_prepareSendTokensData` (invoked per token by `prepareSendManyTokensData` at src/new/sendTransaction.ts:330-335) creates change as a plain transparent `IDataOutput`:

```ts
// src/new/sendTransaction.ts:1169-1178
const changeOutput: IDataOutput = {
  type: await getOutputTypeFromWallet(storage),
  token,
  value: newUtxos.amount - outputAmount,
  address: changeAddress,
  authorities: 0n,
  timelock: null,
  isChange: true,
};
newtxData.outputs.push(changeOutput);
```

### 3. Transparent change of a FullShielded token publishes the token UID

The privacy guard adds every token referenced by a transparent output to `tokensWithVisibleOutput`, which gates the public `tokens[]` array:

```ts
// src/new/sendTransaction.ts:593-599
const tokensWithVisibleOutput = new Set<string>();
for (const out of outputs) {
  const tokenUid = (out as { token?: string }).token;
  if (!tokenUid || tokenUid === HTR_UID) continue;
  if ((out.authorities ?? 0n) !== 0n) continue;
  tokensWithVisibleOutput.add(tokenUid);
}
```

The guard's own comment (src/new/sendTransaction.ts:580-592) acknowledges that listing a token publicly in `tokens[]` "would defeat that privacy guarantee" and that the set must be computed after "change outputs added by prepareSendManyTokensData" precisely because transparent change pulls an otherwise-FullShielded token in. So a FullShielded-only holding, partially spent, has its token UID forced into the clear by the library's own change output.

### 4. The leak is the default outcome, not an informed choice

`bestUtxoSelection` — the default selection algorithm (src/new/sendTransaction.ts:1132) — deliberately mixes shielded UTXOs into any send and never sets the `shielded` filter that already exists in `IUtxoFilterOptions` (src/types.ts:606-610, honored by `memory_store.ts`):

```ts
// src/utils/utxo.ts:102-113
// Select any UTXO (transparent or shielded) up to the requested amount.
// hathor-core accepts shielded inputs in transparent-output-only txs ...
const options: IUtxoFilterOptions = {
  token,
  authorities: 0n,
  only_available_utxos: true,
  order_by_value: 'desc',
};
```

Shielded custom-token UTXOs are stored with their recovered token UID (src/shielded/processing.ts), so the selector will spend them in any ordinary send of that token, and the residual lands in a transparent change output. The integration test `__tests__/integration/shielded_outputs/multi_token_shielded.test.ts:226-247` confirms the design gap: to keep custom-token change shielded, the caller must hand-build the shielded self-change output and make the outputs sum exactly to the input (200n + 800n = 1000n) so the library never creates change at all.

## Source of truth

- hathor-core fully supports shielded outputs for custom tokens — both AmountShielded (token in `token_data`) and FullShielded (token recovered from the rewound message): hathor-core:hathor/transaction/shielded_tx_output.py:76-99. A shielded custom-token change output is therefore perfectly constructible.
- Nothing in hathor-core verification constrains change visibility: hathor-core:hathor/verification/transaction_verifier.py validates the balance equations and the three transaction-layer invariants, and explicitly accepts mixed shielded-input/transparent-output transactions (the transparent surplus/deficit check is skipped for shielded txs). Change construction is a pure wallet-side concept the node never sees.
- The client integration guide places everything beyond the three transaction-layer invariants on the client: SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md:125 ("Full nodes must enforce the three transaction-layer invariants — not automatic from crypto verification") and the §8/§9 warnings. Privacy hygiene of outputs — including change — is wallet-lib's responsibility; core will neither prevent nor mitigate this leak.

## Impact

A user holds 1000 units of a custom token as a FullShielded output (paid 2 HTR for asset + amount hiding). They send 200 units to someone using the normal `sendManyOutputsTransaction` flow, without hand-picking inputs:

1. `bestUtxoSelection` picks the shielded 1000-unit UTXO (default behavior, no opt-out exercised).
2. `_prepareSendTokensData` emits a transparent change output of 800 units to the user's own address.
3. The privacy guard adds the token UID to the public `tokens[]` array because a transparent output now references it.

Result: the chain publicly shows the user's address holding 800 units of the named token — both the residual amount of the spent shielded holding and the token identity are disclosed, silently, by default. (Strictly, the leak is the residual of the *selected inputs*, not necessarily the wallet's whole balance — but with best-UTXO selection, which picks the smallest UTXO larger than the amount, the change frequently approximates the bulk of a holding.) Unlike HTR, there is not even an opt-in to avoid it: `changeShieldedMode` does nothing for custom tokens. The only workaround is manual input selection plus an explicit shielded self-output sized so no library change is created — exactly what the integration test does.

No funds or keys are at risk and consensus is unaffected, but the feature's core guarantee — confidentiality of shielded holdings — is silently broken for custom tokens in the default flow. That is a high-severity privacy defect for a confidential-transactions feature.

## Recommendation

1. **Primary fix:** extend `changeShieldedMode` (or add a per-token option, per the project preference for explicit options over inference) so custom-token change is converted to a shielded output to a fresh own shielded address, mirroring `convertHtrChangeIfRequested`:
   - In (or after) `_prepareSendTokensData`/`prepareSendManyTokensData`, when the mode is set and a change output was created for token T, remove the transparent change, append an `ISendShieldedOutput` for T (`shieldedMode` from the option, `scanPubkey` from the wallet's current shielded address), and add the per-output fee (`FEE_PER_FULL_SHIELDED_OUTPUT` / `FEE_PER_AMOUNT_SHIELDED_OUTPUT`) to `totalFee` — fee is always paid in HTR, so it folds into the existing HTR fee leg.
   - Preserve the existing safety rails from the HTR helper: keep the `>= 2 shielded outputs` invariant (conversion is fine here since it adds to `shieldedOutputDefs` before the count is checked), and keep transparent change when conversion would zero/negate the value relative to the added fee.
2. **Until then, mitigate the default:** make the default selector prefer transparent UTXOs for transparent sends — e.g. run `selectUtxos` first with `shielded: false` (the filter already exists at src/types.ts:606-610) and only fall back to shielded UTXOs when transparent funds are insufficient — so shielded holdings are not broken open by ordinary sends.
3. **Document the leak** in `changeShieldedMode`'s docs and the shielded integration guide: partial spends of shielded custom-token UTXOs currently produce transparent change and expose the token UID for FullShielded holdings.

## Verification notes

Three independent adversarial reviewers confirmed every load-bearing claim:

- `convertHtrChangeIfRequested` is the sole shielded-change mechanism, hard-filtered to `token === HTR_UID && isChange === true` (src/new/sendTransaction.ts:1076-1080), no-ops without other shielded outputs (:1069), and is called only on the HTR fee leg (:401-407). Exhaustive grep for `changeShieldedMode` and conversion helpers found no custom-token path; src/new/types.ts:379-384 documents the option as HTR-fee-change-only.
- Custom-token change is always a transparent `IDataOutput` (src/new/sendTransaction.ts:1169-1178) with no hook in `prepareSendManyTokensData`; the template interpreter has no shielded support either.
- The `tokens[]` privacy guard (:593-599) provably adds any token with a transparent output; its own comments (:580-592) acknowledge transparent change pulls a FullShielded token in.
- `bestUtxoSelection` mixes shielded UTXOs by default (src/utils/utxo.ts:102-113) and never uses the existing `shielded` filter, making the leak the silent default; the integration test (multi_token_shielded.test.ts:226-247) shows callers must hand-craft exact-sum shielded self-change to avoid it.
- Source-of-truth check: hathor-core supports shielded custom-token outputs (shielded_tx_output.py:76-99) and its verification imposes no change-visibility rule, so the fix is feasible and entirely wallet-side.
- Two minor wording corrections were applied: the leak reveals the residual of the selected inputs (not necessarily the full wallet balance), and the client-guide citation is the invariants warning at checklist line 125 rather than a literal "privacy hygiene is client-side" quote. Neither changes the verdict. Severity high stands: default-on privacy leak that undoes the paid-for confidentiality; not critical because no funds/keys/consensus are at risk.
