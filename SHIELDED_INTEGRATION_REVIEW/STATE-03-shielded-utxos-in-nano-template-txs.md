# STATE-03: Default UTXO selection mixes shielded UTXOs into nano-contract and template transactions, which never compute the excess blinding factor — node-rejected txs

**Severity:** high - **Status:** confirmed by adversarial review

## Summary

UTXO selection in the wallet defaults to returning shielded and transparent UTXOs together. Spending a shielded UTXO with only transparent outputs is legal on-chain only if the transaction carries an `UnshieldBalanceHeader` with the excess blinding factor, and the wallet computes that excess in exactly two places: `SendTransaction.prepareTxData` and `transactionUtils.prepareTransaction`. The nano-contract builder and the transaction-template interpreter bypass both — they select UTXOs without a shielded filter, build the transaction via `createTransactionFromData` (which only attaches the header if the excess is *already* set), and submit via `runFromMining()`, which skips preparation. The result is a deterministic post-PoW node rejection (`ShieldedBalanceMismatchError`) for any nano deposit or template transaction as soon as the selected UTXO set includes a shielded one — a routine state for a wallet that has received shielded funds or shielded change.

## Location

- src/types.ts:606-610 — `IUtxoFilterOptions.shielded` documented as `undefined (default) → all UTXOs (transparent + shielded)`
- src/storage/memory_store.ts:825-826 — shielded filter applied only when `options.shielded` is explicitly `true`/`false`
- src/utils/utxo.ts:99-113 — `bestUtxoSelection` (and `fastUtxoSelection` at :56-62) intentionally set no `shielded` filter, with a comment that omits the mandatory header
- src/utils/transaction.ts:961-970 — `_attachShieldedHeaders` attaches `UnshieldBalanceHeader` only when `txData.excessBlindingFactor` is pre-set
- src/utils/transaction.ts:1347-1421 — excess computation, only inside `prepareTransaction`
- src/new/sendTransaction.ts:542-578 — excess computation, only inside `SendTransaction.prepareTxData`
- src/nano_contracts/builder.ts:370-377, 760-762, 819, 868 — nano UTXO selection and direct `createTransactionFromData` calls
- src/nano_contracts/utils.ts:70-84 — `prepareNanoSendTransaction` signs and wraps a prebuilt tx; never prepares
- src/new/wallet.ts:1460-1481 — `getUtxosForAmount` → `getAvailableUtxos` → `storage.selectUtxos` with no `shielded` option
- src/template/transaction/interpreter.ts:250-253, 262 — template UTXO selection with no shielded filter

## Details

### 1. Selection returns shielded UTXOs by default

Shielded UTXOs are stored in the same UTXO map as transparent ones, with `shielded: true` and the on-chain absolute index (≥ the transparent outputs count; see src/utils/storage.ts:682-717). `IUtxoFilterOptions` makes mixing the default:

```ts
// src/types.ts:606-610
// Filter by shielded status:
// undefined (default) → all UTXOs (transparent + shielded)
// true → only shielded UTXOs
// false → only transparent UTXOs
shielded?: boolean;
```

`MemoryStore.selectUtxos` only filters when the flag is explicitly set (src/storage/memory_store.ts:825-826: `(options.shielded === true && !utxo.shielded) || (options.shielded === false && !!utxo.shielded)`), and neither the `Storage.selectUtxos` wrapper nor the selection algorithms add a default. `bestUtxoSelection` even documents the mixing as deliberate, with a justification that is only half-true:

```ts
// src/utils/utxo.ts:102-110
// Select any UTXO (transparent or shielded) up to the requested amount.
// hathor-core accepts shielded inputs in transparent-output-only txs
// (see `is_shielded()` gating in verification_service.py); ownership is
// enforced via the P2PKH signature on the spend-derived key for shielded
// outputs, and the fullnode skips the HTR surplus/deficit check for
// shielded txs (commit 75831f9a).
const options: IUtxoFilterOptions = {
  token,
  authorities: 0n,
  ...
```

hathor-core accepts such transactions only when they carry an `UnshieldBalanceHeader` (see Source of truth below). A grep over src/ finds zero occurrences of `shielded: false` — no caller ever opts out.

### 2. The header is only attached when the excess is pre-computed

```ts
// src/utils/transaction.ts:961-970 (_attachShieldedHeaders)
if (txData.excessBlindingFactor) {
  if (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) {
    throw new Error(...);
  }
  tx.headers.push(new UnshieldBalanceHeader(txData.excessBlindingFactor));
}
```

The excess blinding factor (`sum(r_in) - sum(r_out)`) is computed in exactly two places — verified exhaustively by grepping for `excessBlindingFactor`:

- `transactionUtils.prepareTransaction` (src/utils/transaction.ts:1347-1421), which iterates the inputs, looks up stored blinding entries, and sums the scalars before calling `createTransactionFromData`;
- `SendTransaction.prepareTxData` (src/new/sendTransaction.ts:542-578), the regular send path.

`createTransactionFromData` itself (synchronous) cannot compute it. The string `shielded` does not appear anywhere in src/nano_contracts/ or src/template/.

### 3. Nano-contract path bypasses both computation sites

- Deposit action selection: `NanoContractTransactionBuilder` calls `this.wallet.getUtxosForAmount(amount, utxoOptions)` where `utxoOptions` is only `{ token, filter_address? }` (src/nano_contracts/builder.ts:370-377; fee path at :760-762). `getUtxosForAmount` (src/new/wallet.ts:1460-1481) forwards to `getAvailableUtxos` → `storage.selectUtxos` with `order_by_value: 'desc'` and no `shielded` option, so shielded UTXOs are candidates, largest first.
- Construction: `buildTransaction` calls `transactionUtils.createTransactionFromData(...)` directly (builder.ts:819 and :868) — not `prepareTransaction` — so `txData.excessBlindingFactor` is never set and `_attachShieldedHeaders` attaches nothing.
- Submission: `prepareNanoSendTransaction` (src/nano_contracts/utils.ts:70-84) signs the prebuilt tx and wraps it in `new SendTransaction({ storage, transaction: tx, pin })`; the wallet then calls `sendTransaction.runFromMining()` (src/new/wallet.ts:3498-3508), which skips `prepareTx`/`prepareTxData` entirely. Signing succeeds (shielded-spend P2PKH inputs sign through the same path the working full-unshield flow uses, src/utils/transaction.ts:413-414), so nothing fails until the node validates the tx after PoW.

### 4. Template path bypasses them the same way

The template interpreter selects via `this.wallet.getUtxosForAmount(amount, options)` (src/template/transaction/interpreter.ts:250-253) and `this.wallet.storage.selectUtxos(newOptions)` (interpreter.ts:262) with no shielded filter, builds the `Transaction` itself (interpreter.ts:169-224, including direct `signTransaction`), and `runTxTemplate` submits through `handleSendPreparedTransaction` → `SendTransaction({transaction}).runFromMining()` (src/new/wallet.ts:3842-3879). No excess, no header.

## Source of truth

hathor-core treats any input whose index points past the parent's transparent outputs as a shielded input — purely structural, exactly what the wallet produces when spending a stored shielded UTXO:

```python
# hathor-core:hathor/transaction/transaction.py:182-189
def has_shielded_inputs(self) -> bool:
    for tx_input in self.inputs:
        spent_tx = self.storage.get_transaction(tx_input.tx_id)
        if tx_input.index >= len(spent_tx.outputs):
            return True
    return False
```

And the verifier enforces the mutual-exclusion invariants on the excess blinding factor:

```python
# hathor-core:hathor/verification/transaction_verifier.py:1038-1042
if has_shielded_inputs_ and not has_shielded_outputs_ and not has_excess:
    raise ShieldedBalanceMismatchError(
        'a full-unshield tx (shielded inputs, no shielded outputs) must carry an '
        'unshield balance header'
    )
```

(Invariants listed at transaction_verifier.py:1021-1030.) So a transaction with shielded inputs and only transparent outputs is valid *only* with the `UnshieldBalanceHeader` — the wallet comment in src/utils/utxo.ts:102-107 is true only under that condition.

## Impact

Any wallet that holds shielded UTXOs (received shielded funds, or shielded change from a prior shielded send) and then:

- makes a nano-contract deposit (or pays a nano fee), or
- executes a transaction template that selects UTXOs,

will, whenever the descending-ordered selection picks a shielded UTXO — guaranteed once the wallet's largest UTXO for the requested token is shielded — produce a transaction with shielded inputs, transparent-only outputs, and no `UnshieldBalanceHeader`. The node deterministically rejects it with `ShieldedBalanceMismatchError` *after* the client has spent PoW/mining effort, and the selected UTXOs remain temporarily locked via `markUtxoSelected` TTL. There is no parameter on the nano builder or template API to opt out of shielded selection, so the user cannot work around it without manually crafting inputs. No funds are lost and there is no consensus or privacy impact, hence high rather than critical — but it is a deterministic availability/correctness break of the nano-contracts and templates features for any shielded-funds wallet.

## Recommendation

Two viable fixes (the first is the smaller, safer change):

1. Default to transparent-only selection for every path that does not run the unshield machinery. E.g. in `NanoContractTransactionBuilder` and the template interpreter (and any other `getUtxosForAmount` consumer that builds without `prepareTransaction`), pass `shielded: false`:

   ```ts
   // src/nano_contracts/builder.ts (deposit + fee selection)
   const utxoOptions: IUtxoFilterOptions = { token: action.token, shielded: false };
   ```

   Optionally flip the global default in `IUtxoFilterOptions`/`MemoryStore.selectUtxos` to `shielded: false` and require explicit opt-in (`shielded: true` or a mixed mode) from the send path — consistent with the project's explicit-options-over-inference convention.

2. Alternatively, move the excess-blinding-factor computation of src/utils/transaction.ts:1347-1421 into the common construction path (`createTransactionFromData`/`_attachShieldedHeaders`, made async, or a shared async helper called by the nano builder and template interpreter before signing), so every construction path that can receive shielded inputs attaches the `UnshieldBalanceHeader` automatically.

In both cases, also fix the misleading comment at src/utils/utxo.ts:102-107 to state that core accepts shielded inputs in transparent-output-only txs only when the `UnshieldBalanceHeader` is present. Add integration tests under __tests__/integration/shielded_outputs/: a nano-contract deposit and a template-built send executed while the wallet's largest UTXO for the token is shielded (currently no nano or template coverage exists in that suite).

## Verification notes

The skeptic panel confirmed the finding end-to-end with no countervailing evidence:

- Every cited line was re-read in both worktrees: default-mixing selection (src/types.ts:606-610, src/storage/memory_store.ts:825-826, src/utils/utxo.ts:99-113, src/new/wallet.ts:1460-1481), header gating (src/utils/transaction.ts:961-970), the two-and-only-two excess computation sites (exhaustive grep for `excessBlindingFactor`), and the bypassing nano/template paths (builder.ts:370-377/760/819/868, nano_contracts/utils.ts:70-84, interpreter.ts:250-262, wallet.ts:3498-3508/3842-3879).
- Exhaustive search found no mitigation: zero `shielded: false` occurrences in src/, zero `shielded` mentions in src/nano_contracts/ or src/template/, and `runFromMining()` never invokes preparation (sendTransaction.ts:932-953 only prepares from the `run()` entry when idle).
- Source of truth confirmed against hathor-core: structural shielded-input detection (transaction.py:182-189) and the mandatory-header invariant (transaction_verifier.py:1038-1042).
- Signing was verified to succeed for shielded-spend inputs (same path as the working full-unshield flow), confirming the failure manifests as post-PoW node rejection rather than an earlier client-side error.
- Minor corrections applied during verification, not changing the verdict: `bestUtxoSelection` prefers the *smallest* single UTXO ≥ amount (utxo.ts:126-153), not the largest, and the nano/template paths actually select through `getUtxosForAmount` → `transactionUtils.selectUtxos` (descending order) rather than `bestUtxoSelection` — that path is equally unfiltered, so the trigger condition (largest token UTXO shielded ⇒ guaranteed selection) stands.
