# PR 5 split — three stacked PRs (paste-ready)

The original storage-layer PR (~2,700 lines) is split into three reviewable
PRs, each landing one coherent layer. All three are rebased onto the current
master (which already contains PR #1087 / pr-4).

```
master ─ 5a ◀ 5b ◀ 5c ─ 6 ─ 7 ─ 8
```

| PR     | Branch                             | Base branch (set on GitHub)        | GitHub action            | Size       |
|--------|------------------------------------|------------------------------------|--------------------------|------------|
| **5a** | `shielded/pr-5-storage-layer`      | `master`                           | **retitle PR #1088**     | 549+/67−   |
| **5b** | `shielded/pr-5b-shielded-tx-utils` | `shielded/pr-5-storage-layer`      | **open new PR**          | 1011+/60−  |
| **5c** | `shielded/pr-5c-receive-pipeline`  | `shielded/pr-5b-shielded-tx-utils` | **open new PR**          | 1279+/92−  |

**Do on GitHub:** retitle #1088 (5a) and set its base to `master`; open the two
new PRs with the base branches above so each diff shows only its own layer.

*Stack validated end-to-end on the pr-8 tip: tsc clean, lint 0 errors,
81 unit suites / 1071 tests pass.*

---

## 5a — data model + storage layer

**Title:** `feat(shielded): data model + storage layer for shielded addresses`
**Base:** `master`  ·  **Branch:** `shielded/pr-5-storage-layer`  ·  reuses **#1088**

### Summary
First of three PRs split from the original storage-layer PR for reviewability.
This layer answers **"where shielded data lives"** — types, stores, indexes,
key access. Purely additive: nothing consumes these capabilities yet (5b/5c
do), so existing wallets behave exactly as before.

### Acceptance criteria
- [ ] Shielded key material is reachable through storage: `getScanXPrivKey(pin)` / `getSpendXPrivKey(pin)` decrypt with the PIN; `getScanXPubKey()` / `getSpendXPubKey()` return the public chains; `shieldedCryptoProvider` has a field + setter.
- [ ] `MemoryStore.saveAddress` routes by `addressType`: `shielded` addresses index into the new `shieldedAddressIndexes` map; `shielded-spend` records are stored but not indexed (matched later by base58).
- [ ] Address-chain methods (`getAddressAtIndex`, `getCurrentAddress`, index getters/setters) accept `IAddressChainOptions` — `{ legacy: false }` selects the shielded chain; omitting it preserves legacy behavior.
- [ ] `IWalletData` tracks the shielded chain's loaded / used / current indices independently of the legacy chain.
- [ ] `IUtxo` can carry `shielded` / `blindingFactor` / `assetBlindingFactor`; `IUtxoFilterOptions.shielded` filters them.
- [ ] No behavior change for existing wallets — every new field and method param is optional.

### Files (8)
`src/types.ts` (additive only), `src/storage/storage.ts`, `src/storage/memory_store.ts`, `src/utils/address.ts`, `src/wallet/wallet.ts` + `__tests__/storage/memory_store.test.ts`, `__tests__/storage/storage.test.ts`, `__tests__/utils/address.test.ts`.

> The breaking history-shape changes (output union, input optionality) are
> deliberately **not** here — they land with their consumers in 5b.

### Reviewer checklist
1. A `shielded` record advances only the shielded cursor; `shielded-spend` is stored un-indexed; legacy paths untouched when no chain option is passed.
2. `getScanXPrivKey` / `getSpendXPrivKey` decrypt with the PIN and throw cleanly when the wallet has no shielded keys.
3. The per-chain `IWalletData` indices are independent (no shared counter).

---

## 5b — shielded-aware transaction utils + history data model

**Title:** `feat(shielded): shielded-aware transaction utils + history data model`
**Base:** `shielded/pr-5-storage-layer`  ·  **Branch:** `shielded/pr-5b-shielded-tx-utils`  ·  **new PR**

### Summary
Second of three. Makes the transaction/history data shape shielded-aware and
updates every consumer in the same diff, so the breaking change and its blast
radius are reviewed together. Still no decryption — transparent-only flows are
unchanged.

### Acceptance criteria
- [ ] `IHistoryOutput` becomes a discriminated union `ITransparentOutput | IShieldedOutputEntry` (on `type === 'shielded'`); `IHistoryInput`'s transparent fields become optional (a shielded input hides value/token in commitments).
- [ ] `normalizeShieldedOutputs(tx)` lifts wire shielded entries out of `outputs[]` into `shielded_outputs[]` (base64 → hex), is idempotent, and is applied by `Storage.addTx`.
- [ ] `findSpentOutput(parentTx, index)` resolves an output by its on-chain absolute index (`onChainIndex` for decoded shielded entries), not array position; `utxoSelectAsInput` uses it.
- [ ] Per-tx balance debits shielded inputs and credits decoded shielded outputs.
- [ ] `prepareTransaction` attaches `ShieldedOutputsHeader` / `UnshieldBalanceHeader` from `IDataTx.shieldedOutputs` / `excessBlindingFactor` (consumed by the send pipeline in PR 6).
- [ ] Inputs spending shielded outputs are signed with the spend key.
- [ ] Existing transparent-only flows behave identically; `utils/storage.ts` gets only a type-level guard (shielded inputs cannot occur until 5c).

### Files (8)
`src/types.ts`, `src/utils/transaction.ts`, `src/models/transaction.ts`, `src/storage/storage.ts`, `src/utils/storage.ts` (guard only), `src/wallet/walletServiceStorageProxy.ts`, new `__tests__/utils/transaction_shielded.test.ts`, `__tests__/wallet/walletServiceStorageProxy.test.ts`.

### Reviewer checklist
1. Sparse decode in `findSpentOutput`: a decoded entry with `onChainIndex: 2` at array position 1 — index 2 resolves to it, index 1 resolves to `undefined` (the undecodable output), never the wrong entry.
2. `normalizeShieldedOutputs` handles both wire shapes (nested in `outputs[]` vs separate array) and is idempotent.
3. The `utils/storage.ts` guard is type-only — no behavior change for transparent inputs.

---

## 5c — receive pipeline (detect, decrypt, store)

**Title:** `feat(shielded): receive pipeline — detect, decrypt and store shielded outputs`
**Base:** `shielded/pr-5b-shielded-tx-utils`  ·  **Branch:** `shielded/pr-5c-receive-pipeline`  ·  **new PR**

### Summary
Third of three. The pipeline that turns on-chain shielded outputs into
spendable wallet state. About 40% of the diff is its own tests.

### Acceptance criteria
- [ ] `processShieldedOutputs(storage, tx, provider, pinCode)`: for each shielded output whose script address belongs to the wallet, derives the per-index scan key and rewinds — AmountShielded resolves the token from `token_data`; FullShielded recovers the token UID from the proof message and **cross-checks it against the on-chain asset commitment** (mismatch → rejected).
- [ ] Decoded entries are appended to `tx.outputs[]` with their `onChainIndex`, so transparent-output processing handles them uniformly.
- [ ] `processHistory` / `processSingleTx` invoke the pipeline when a crypto provider is set; decrypted outputs become `IUtxo`s carrying their blinding factors; token/address metadata updates accordingly.
- [ ] `loadAddresses` derives the shielded + spend-P2PKH pair per index; gap-limit tracking is per-chain.
- [ ] Without a crypto provider or PIN, transparent processing is unaffected (shielded outputs are simply left undecoded).
- [ ] `Storage.processHistory(pinCode?)` / `processNewTx(tx, pinCode?)` accept the optional PIN scan-key derivation needs.

### Files (7)
new `src/shielded/processing.ts` + `src/shielded/index.ts` export, `src/utils/storage.ts` (pipeline integration), `src/storage/storage.ts` + `src/types.ts` (`pinCode?` plumbing), `__tests__/shielded/processing.test.ts`, `__tests__/utils/storage.test.ts`.

### Reviewer checklist
1. FullShielded token cross-check: a forged token UID in the proof message is rejected (test covers it).
2. Blinding factors land on the stored UTXO (`blindingFactor` / `assetBlindingFactor`) — needed to spend later. *(Known follow-up, out of scope: they're stored in plaintext — TODO_FIX_38.)*
3. Per-chain gap limit: the shielded chain advances only on shielded / spend-address hits; legacy is unaffected.

---

*Note: the shielded-address-in-transparent-output guard and its test live in
PR 6 (the send pipeline), not here — 5a/5b/5c add no send-side behavior.*
