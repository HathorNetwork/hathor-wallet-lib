# STATE-04: Plain transparent sends silently auto-unshield: shielded UTXOs are spent without user opt-in, permanently revealing previously-confidential amounts (and token-administration flows)

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** GAP3-02 (token-administration flows silently force-deshield confidential funds with no opt-out; the shielded UTXO filter is dead code and wallet.ts never plumbs utxoSelection) — merged here; same root cause (default mixed UTXO selection + silent full-unshield + no public opt-out), wider entry-point scope.

## Summary

The default UTXO selection used by every ordinary send (`sendTransaction`, `sendManyOutputs`) deliberately mixes shielded and transparent UTXOs into one pool, and when a shielded UTXO ranks first by value it gets picked for a plain transparent payment. `SendTransaction` then quietly builds a full-unshield transaction (excess blinding factor + `UnshieldBalanceHeader`) with no opt-in flag, no warning event, and no way to say "transparent funds only" through any public option. The transaction is consensus-valid, but it irreversibly publishes amounts the user deliberately shielded: in the common single-shielded-input case the transparent outputs plus fee publicly equal the hidden input value, and the revealed excess scalar effectively IS that input's value blinding factor. This defeats the core guarantee of the shielded feature under default usage and contradicts the project's own explicit-options-over-inference convention for send/build APIs.

## Location

- `src/utils/utxo.ts:102-113` — `bestUtxoSelection` builds `IUtxoFilterOptions` without the `shielded` field (deliberate, per comment); `src/utils/utxo.ts:56-62` — `fastUtxoSelection` likewise
- `src/new/sendTransaction.ts:1132` — `_prepareSendTokensData` defaults to `bestUtxoSelection`
- `src/new/sendTransaction.ts:471-484` — selected shielded UTXOs flow into `blindedInputsArr`
- `src/new/sendTransaction.ts:526-578, 616` — silent full-unshield branch computes and attaches the excess blinding factor
- `src/utils/transaction.ts:961-969` — `UnshieldBalanceHeader` attached to the tx
- `src/types.ts:606-610` — the `shielded?: boolean` filter exists but is never used by any send path
- `src/new/types.ts:367-371, 386-392` — no opt-in/opt-out option on `SendTransactionFullnodeOptions` / `SendManyOutputsOptions`
- `src/new/sendTransaction.ts:161-179` — `SendTransaction` constructor exposes no selection or unshield option

## Details

**1. Default selection mixes the pools, by design.** `bestUtxoSelection` — the default selector at `src/new/sendTransaction.ts:1132` — omits the `shielded` filter and documents the choice purely in terms of consensus validity, not privacy:

```ts
// src/utils/utxo.ts:102-113
// Select any UTXO (transparent or shielded) up to the requested amount.
// hathor-core accepts shielded inputs in transparent-output-only txs
// (see `is_shielded()` gating in verification_service.py); ownership is
// enforced via the P2PKH signature on the spend-derived key for shielded
// outputs, and the fullnode skips the HTR surplus/deficit check for
// shielded txs (commit 75831f9a).
const options: IUtxoFilterOptions = {
  token,
  authorities: 0n,
  only_available_utxos: true,
  order_by_value: 'desc',
};
```

`fastUtxoSelection` (`src/utils/utxo.ts:56-62`) does the same. Because shielded UTXOs are saved into the same spendable set with decoded values and `shielded: true` (`src/utils/storage.ts:700-716`), and selection orders by value descending, a shielded UTXO is picked whenever it is among the largest — the typical case right after a user shields a meaningful balance.

**2. The opt-out filter exists but nothing uses it.** `IUtxoFilterOptions.shielded` is defined (`src/types.ts:606-610`: `false → only transparent UTXOs`) and enforced by the store (`src/storage/memory_store.ts:825-826`), but a repo-wide search finds zero send-path callers passing `shielded: false`. The options `SendTransaction` builds for `prepareSendTokensData` are only `{ token, chooseInputs, changeAddress }` (`src/new/sendTransaction.ts:375-382`).

**3. The full-unshield is then built silently.** When the mixed selection yields shielded inputs but the user's outputs are all transparent, this branch fires with no flag and no notification:

```ts
// src/new/sendTransaction.ts:543 (excerpt)
let excessBlindingFactor: Buffer | undefined;
if (shieldedOutputs.length === 0 && blindedInputsArr.length > 0) {
  ...
  const excess = await cryptoProvider.computeBalancingBlindingFactor(
    0n, ZERO_TWEAK,
    [...blindedInputsArr, ...transparentInputEntries],
    transparentOutputEntries
  );
  excessBlindingFactor = excess;
}
```

The excess is shipped in `fullTxData` (`src/new/sendTransaction.ts:616`) and `prepareTransaction` attaches the `UnshieldBalanceHeader` (`src/utils/transaction.ts:961-969`). The only events `SendTransaction` emits are generic lifecycle ones (`mine-tx-started`, `send-tx-start`, `send-tx-success`, `send-error`; `src/new/sendTransaction.ts:776-862`) — nothing signals that an unshield occurred.

**4. No public API can prevent or detect it.** `SendTransactionFullnodeOptions` is `{ changeAddress, token, pinCode }` (`src/new/types.ts:367-371`); `SendManyOutputsOptions` is `{ inputs, changeAddress, startMiningTx, pinCode, changeShieldedMode }` (`src/new/types.ts:386-392`) — `changeShieldedMode` controls change shape, not input selection. The `SendTransaction` constructor accepts no selector or unshield flag (`src/new/sendTransaction.ts:161-179`), and `IUtxoSelectionOptions.utxoSelectionMethod` (`src/types.ts:619-624`) is not reachable from the wallet facade's send methods (`src/new/wallet.ts:1940-1947`). Grep for `allowUnshield`/`spendShielded`/`transparentOnly`/`onlyTransparent` finds nothing. The only workaround is manually supplying explicit `inputs`, which is not a default-safe API.

## Source of truth

hathor-core permits these transactions but explicitly documents the information revealed, making privacy hygiene the wallet's responsibility:

- hathor-core:hathor/transaction/headers/unshield_balance_header.py:34-47 — a full-unshield tx must reveal `excess = sum(r_in) − sum(r_out)`; "with exactly one shielded input the scalar is effectively r_in of that input, but the transparent outputs of a full unshield already expose the spent amount". Note: the docstring's framing presupposes a *deliberate* unshield — it is precisely the wallet auto-building one without consent that turns this from "nothing additionally leaked" into a real leak.
- hathor-core:hathor/verification/transaction_verifier.py:931-950 — the full-unshield balance equation `sum(C_in) == sum(C_out) + excess*G + fee*H_HTR`: with one shielded input, the previously-hidden amount is publicly derivable from the transparent outputs plus fee.
- Core verification never *requires* mixing shielded inputs into transparent sends; it merely accepts it. The decision of when to unshield is entirely client-side, which is exactly what this finding is about (rule inventory §10, "Unshield privacy leak").

## Impact

A user shields 1,000 HTR to keep the amount confidential. Later they make an unrelated, ordinary transparent payment of 50 HTR via `wallet.sendTransaction(addr, 50n)`. Because the 1,000-HTR shielded UTXO is the largest, `bestUtxoSelection` picks it. The wallet silently builds a full-unshield tx: the on-chain transparent outputs (50 to the recipient + 950 change) plus fee now publicly sum to the formerly hidden value, and the published excess scalar is effectively the input's value blinding factor. The confidentiality the user explicitly paid shielded-output fees to obtain is destroyed, permanently and on-chain, by a routine action that gave no indication anything privacy-relevant happened. Every wallet built on this library (desktop, mobile, headless) inherits the behavior with no flag to disable it. No funds are at risk and the tx is consensus-valid — but the feature's sole security property (amount confidentiality) is defeated under default usage.

## Recommendation

Make spending shielded UTXOs in non-shielded sends opt-in, consistent with the project's explicit-options-over-inference convention:

1. Default the send-path selection to transparent only: in `bestUtxoSelection` / `fastUtxoSelection` (or in the options `_prepareSendTokensData` builds), pass `shielded: false` unless the caller opted in.
2. Expose an explicit option — e.g. `allowUnshield?: boolean` (default `false`) — on `SendTransaction`'s constructor, `SendTransactionFullnodeOptions`, and `SendManyOutputsOptions`, threaded through to the selection filter. Sketch:

```ts
// IUtxoSelectionOptions
allowUnshield?: boolean; // default false

// bestUtxoSelection options
const options: IUtxoFilterOptions = {
  token,
  authorities: 0n,
  only_available_utxos: true,
  order_by_value: 'desc',
  ...(allowUnshield ? {} : { shielded: false }),
};
```

3. When the caller opts in and the full-unshield branch fires, surface it: emit an event (e.g. `unshield-detected`) and/or include metadata in the prepared-tx result so UIs can warn the user before signing. If explicit user-provided `inputs` include shielded UTXOs, treat that as implicit consent but still surface the metadata.
4. Adjust "insufficient funds" errors to distinguish "insufficient transparent funds (shielded funds available — pass allowUnshield)" so the new default is debuggable.

## Verification notes

Three independent reviewers confirmed every load-bearing claim against the worktrees:

- Default mixing verified at `src/utils/utxo.ts:102-113` (and `fastUtxoSelection` at 56-62), with `bestUtxoSelection` confirmed as the default at `src/new/sendTransaction.ts:1132` and the options built at 375-382 passing no filter or selector.
- The `shielded` filter confirmed to exist (`src/types.ts:606-610`) and be enforced (`src/storage/memory_store.ts:825-826`), with exhaustive grep confirming zero send-path usage of `shielded: false` and zero hits for `allowUnshield`/`spendShielded`/`transparentOnly`.
- The silent full-unshield branch re-read end-to-end: shielded UTXOs enter `blindedInputsArr` (`sendTransaction.ts:471-484`), excess computed at 543-578 and shipped at 616, header attached at `src/utils/transaction.ts:961-969`, with only generic lifecycle events emitted (776-862).
- All public option surfaces checked (`SendTransactionFullnodeOptions`, `SendManyOutputsOptions`, `SendTransaction` constructor, `IUtxoSelectionOptions`, `UtxoOptions`) — no opt-in/opt-out knob exists; `changeShieldedMode` only controls change shape.
- Core semantics confirmed at hathor-core:hathor/transaction/headers/unshield_balance_header.py:42-47 and transaction_verifier.py:931-950. One nit corrected during review: the originally quoted core docstring text ("the leak is acceptable... leaving multi-input aggregation/hygiene to wallets") was a paraphrase, not literal; the literal docstring frames the single-input reveal as adding nothing beyond what a deliberate unshield's transparent outputs already expose — which reinforces, rather than refutes, the finding that auto-building an unshield without consent is the leak.
- Severity high agreed: silent, irreversible on-chain deanonymization of deliberately shielded holdings under default usage; not critical because no funds are at risk, the tx is consensus-valid, and only the wallet's own outputs are exposed.

## Evidence folded from GAP3-02 (merged duplicate — token-administration scope)

- The same silent force-deshield fires from every token-administration flow: `createNewToken`, `mintTokens`, `meltTokens` build their option bags without forwarding any selection override (`src/new/wallet.ts:2299-2308`, `:2495-2503`, `:2609-2615`), even though `tokens.ts` already accepts a `utxoSelection` parameter (`src/utils/tokens.ts:381,578`, used at `:480,:629,:691`) — so there is no public-API escape hatch for token ops either. `MintTokensOptions` / `MeltTokensOptions` / `CreateTokenOptions` (`src/new/types.ts:157-168,183-194,411-426`) expose no related knob.
- Concrete token-admin scenario: a user holding a single 1000 HTR FullShielded UTXO calls `wallet.createNewToken('MyToken', 'MTK', 100n)` needing a 1 HTR deposit; `bestUtxoSelection` (`order_by_value: 'desc'`) picks the shielded UTXO, `prepareTransaction` silently attaches the `UnshieldBalanceHeader` (`src/utils/transaction.ts:1338-1421`, `:955-969`), and a 999 HTR transparent change output publishes the confidential value and links it to a wallet address — permanently, for an operation that gave no signal confidential funds would be touched.
- The fix must therefore cover the token-admin option bags as well as the send paths (default `shielded: false` in selection + an explicit opt-in flag threaded through both).
