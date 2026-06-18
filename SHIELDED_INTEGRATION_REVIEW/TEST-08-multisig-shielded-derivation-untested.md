# TEST-08: Multisig (P2SH) wallets get single-sig shielded key chains derived with zero test coverage; wallet-service wallet shielded handling has only a 1-line test delta

**Severity:** medium - **Status:** confirmed by adversarial review

**Also reported as:** a second TEST-08 write-up (multisig shielded keys untested + ws-proxy gap) — merged here. Root-cause bug tracked as COMP-03 (previously TODO_FIX_37).

## Summary

`generateAccessDataFromXpriv` and `generateAccessDataFromSeed` derive and store shielded scan/spend key chains for every wallet started from a root key, with no `walletType` gate. A multisig (P2SH) wallet therefore silently exposes shielded addresses whose on-chain spend script is a **single-sig P2PKH** on the local cosigner's spend chain — downgrading the wallet's m-of-n custody to 1-of-1 for anything received shielded. Whether this is intended, blocked, or surfaced is pinned by **no test anywhere** in the suite. Separately, the wallet-service storage proxy gained a new shielded-output passthrough branch whose only test delta is a single mock line that forces the branch to never execute.

## Location

- `src/utils/wallet.ts:627-637` — shielded chains derived for any depth-0 xpriv, no walletType check (`generateAccessDataFromXpriv`)
- `src/utils/wallet.ts:710-715` — same unconditional derivation in `generateAccessDataFromSeed`
- `src/utils/storage.ts:117-132` — `loadAddresses` derives/saves shielded + spend addresses on both the p2pkh and p2sh branches
- `src/utils/address.ts:178-186` — `deriveShieldedAddressFromStorage` checks only key existence, never walletType
- `src/new/wallet.ts:837-850` — `getAddressAtIndex({ legacy: false })` derives shielded addresses with no multisig check
- `src/new/sendTransaction.ts:1114-1123` — `getOutputTypeFromWallet` maps `MULTISIG` → `'p2sh'` and proceeds; no shielded-send gate
- `src/wallet/walletServiceStorageProxy.ts:192-201` — new `isShieldedOutputEntry` passthrough
- `__tests__/wallet/walletServiceStorageProxy.test.ts:20` — the sole test delta: `isShieldedOutputEntry: jest.fn().mockReturnValue(false)`

## Details

### 1. Shielded key derivation is not gated by wallet type

`generateAccessDataFromXpriv` is carefully type-gated everywhere *except* the new shielded block. The legacy account-path derivation branches on `WalletType.MULTISIG` (`src/utils/wallet.ts:582-588`), derived-xpriv multisig starts are explicitly rejected (`590-592`), and multisig metadata is handled separately (`598-608`). The shielded block ignores all of that:

```ts
// src/utils/wallet.ts:624-637
// Derive shielded scan and spend keys if root key is available.
if (argXpriv.depth === 0) {
  const scanAcctXpriv = argXpriv.deriveNonCompliantChild(SHIELDED_SCAN_ACCT_PATH);
  const scanXpriv = scanAcctXpriv.deriveNonCompliantChild(0);
  accessData.scanXpubkey = scanXpriv.xpubkey;
  accessData.scanMainKey = encryptData(scanXpriv.xprivkey, pin);

  const spendAcctXpriv = argXpriv.deriveNonCompliantChild(SHIELDED_SPEND_ACCT_PATH);
  const spendXpriv2 = spendAcctXpriv.deriveNonCompliantChild(0);
  accessData.spendXpubkey = spendXpriv2.xpubkey;
  accessData.spendMainKey = encryptData(spendXpriv2.xprivkey, pin);
}
```

`generateAccessDataFromSeed` does the same unconditionally (`src/utils/wallet.ts:710-715`, returned at `726-729`), so seed-started multisig wallets also get shielded chains.

### 2. Nothing downstream gates it either

Once the scan/spend xpubs exist in access data, every consumer activates:

- `loadAddresses` (`src/utils/storage.ts:117-132`) calls `deriveShieldedAddressFromStorage(i, storage)` on every index **after** the `p2pkh`/`p2sh` branch — i.e., on the multisig path too — and saves both the user-facing shielded address and its spend-derived P2PKH, subscribing the latter for tx notifications.
- `deriveShieldedAddressFromStorage` (`src/utils/address.ts:182-186`) returns `null` only when scan/spend xpubs are missing; it never consults `getWalletType()`.
- `getAddressAtIndex(index, { legacy: false })` (`src/new/wallet.ts:837-850`) hands out shielded addresses to any wallet with the keys. The only `MULTISIG` check in the vicinity (`src/new/wallet.ts:878-882`, `getAddressPathForIndex`) is legacy path-string formatting.
- The shielded send path has no gate: the only multisig reference in `src/new/sendTransaction.ts` is `getOutputTypeFromWallet` (`1114-1123`), which maps `WalletType.MULTISIG` → `'p2sh'` and continues.

The shielded address format is inherently single-sig: the on-chain script is a P2PKH over the spend pubkey (`src/utils/address.ts:200-208` — "spend_pubkey → HASH160 → P2PKH"). A multisig wallet's shielded receipts are therefore spendable by whichever single cosigner holds this seed — no m-of-n quorum.

### 3. Zero test coverage pins the multisig contract

- `grep -rin multisig __tests__/integration/shielded_outputs __tests__/shielded` → no matches (exit 1).
- `grep -rin 'multisig.*shield|shield.*multisig'` across all of `__tests__/` and `src/` → no matches.
- The existing multisig tests in `__tests__/utils/wallet.test.ts` (~lines 413-480) predate shielded support and never assert presence or absence of `scanXpubkey`/`spendXpubkey` in access data.
- No test exercises: a multisig wallet calling `getAddressAtIndex({ legacy: false })`, a multisig wallet attempting a shielded send, or a multisig wallet receiving on its derived shielded address.
- The only adjacent coverage is read-only single-sig: `__tests__/integration/shielded_outputs/core.test.ts:1363` ("should gracefully handle shielded outputs on read-only (xpub-only) wallet"). Multisig is the remaining wallet type with none.

### 4. Wallet-service proxy: new branch mocked to never fire

`src/wallet/walletServiceStorageProxy.ts:192-201` adds a behavior change — shielded output entries now pass through `convertTransaction` untransformed:

```ts
outputs: tx.outputs.map(output => {
  if (transactionUtils.isShieldedOutputEntry(output)) return output;
  return {
    ...output,
    decoded: { ...output.decoded, type: output.decoded.type ?? undefined },
  };
}) as IHistoryTx['outputs'],
```

The entire test delta for this file is +1 line (`git diff master...HEAD --stat` confirms `1 insertion(+)`), and that line is `__tests__/wallet/walletServiceStorageProxy.test.ts:20`:

```ts
jest.mock('../../src/utils/transaction', () => ({
  getSignatureForTx: jest.fn(),
  isShieldedOutputEntry: jest.fn().mockReturnValue(false),
}));
```

`isShieldedOutputEntry` is mocked to always return `false`, so the new passthrough branch (line 193) has **literally zero unit-test execution**. No test covers `HathorWalletServiceWallet` receiving a tx containing shielded outputs end-to-end either — and the known local WS-daemon crash on shielded events makes this the path most likely to break unnoticed.

## Source of truth

hathor-core does not gate this either way. Shielded outputs carry an arbitrary script bounded only by size — the canonical constants and (de)serialization, including `MAX_SHIELDED_OUTPUT_SCRIPT_SIZE`, are re-exported from hathorlib at hathor-core:hathor/transaction/shielded_tx_output.py:27-43 — and the scan+spend shielded address format is inherently single-sig P2PKH over the spend pubkey. Nothing in core or ct-crypto defines a multisig shielded scheme. The multisig custody contract is therefore purely a wallet-lib product decision, and it is currently unpinned by any test — which is exactly the gap.

## Impact

Concrete scenario: a 2-of-3 multisig treasury wallet is started from one cosigner's seed via `generateAccessDataFromSeed(..., { multisig })`. Shielded scan/spend chains are derived from that single seed. The UI (or any caller) invokes `getAddressAtIndex(0, { legacy: false })` and receives a valid shielded address, which gets shared with a payer. Funds received there are spendable by **that one cosigner alone** — the 2-of-3 policy never applies, and the other cosigners (holding different seeds) cannot see or co-sign these funds at all. None of this is blocked, warned about, or even exercised by a test, so a future refactor could change the behavior in either direction without any signal.

On the wallet-service side, the untested passthrough means a regression in `convertTransaction` for shielded entries (e.g., a schema change reshaping the entry, or the discriminator check drifting) would ship silently; the first symptom would be corrupted history entries in wallet-service wallets in production.

## Recommendation

Decide the multisig contract and pin it with tests — one of:

(a) **Block it** (recommended given the custody downgrade): skip shielded chain derivation when `walletType === WalletType.MULTISIG` in both `generateAccessDataFromXpriv` and `generateAccessDataFromSeed`, e.g.

```ts
if (argXpriv.depth === 0 && walletType !== WalletType.MULTISIG) { ... }
```

then add tests asserting: access data for a multisig wallet has no `scanXpubkey`/`spendXpubkey`; `getAddressAtIndex(i, { legacy: false })` on a multisig wallet throws the existing `'Shielded keys not available'` error (`src/new/wallet.ts:845`); and a shielded send from a multisig wallet fails with a clear error.

(b) **Support it explicitly**: keep the derivation but add a test that documents the single-sig custody semantics (a multisig wallet's shielded receipts are spendable by this cosigner alone), so the behavior is a recorded decision rather than an accident.

For the wallet-service proxy, add a unit test that feeds `convertTransaction` a wallet-service tx whose `outputs` mix a `type: 'shielded'` entry with transparent ones, using the **real** `isShieldedOutputEntry` (or a mock returning `true` for that entry), and asserts the shielded entry survives byte-identical while the transparent siblings still get the `decoded.type ?? undefined` normalization. Ideally also an end-to-end test of `HathorWalletServiceWallet` ingesting a shielded-output tx event.

## Verification notes

The skeptic panel confirmed every point and found the evidence stronger than originally claimed:

1. Re-read `src/utils/wallet.ts:627-637` and confirmed the absence of a walletType gate, in deliberate contrast to the gated branches at 582-592 and 598-608. Additionally found `generateAccessDataFromSeed` derives shielded chains unconditionally (`710-715`), extending the finding to seed-started multisig wallets.
2. Traced every downstream consumer (`src/utils/storage.ts:117-132`, `src/utils/address.ts:178-186`, `src/new/wallet.ts:837-850`, `src/new/sendTransaction.ts:1114-1123`) and confirmed none gates on multisig — the custody downgrade is live behavior, not hypothetical.
3. Ran the greps: `grep -rin multisig __tests__/integration/shielded_outputs __tests__/shielded` exits 1 (no matches); no multisig×shielded match anywhere in `__tests__/` or `src/`. Confirmed the read-only single-sig test exists at `core.test.ts:1363`.
4. Confirmed the wallet-service test delta is exactly +1 line and that the line mocks `isShieldedOutputEntry` to `false`, meaning the new passthrough branch at `walletServiceStorageProxy.ts:193` is never executed by any unit test.
5. Checked hathor-core (`hathor/transaction/shielded_tx_output.py:27-43`) and confirmed core imposes no multisig semantics on shielded outputs — the contract is wallet-lib's to define, which is the finding's core point.

Severity medium is appropriate for the test-gap framing; if the team decides multisig shielded exposure should be blocked, the code change itself would merit a separate, higher-severity behavioral finding.

## Evidence folded from the duplicate write-up

- `migrateShieldedAccessData` (`src/utils/wallet.ts:758-813`, caller `src/new/wallet.ts:2121`) is also ungated by wallet type, so pre-existing multisig wallets are retrofitted on upgrade — equally uncovered by tests.
- `__tests__/integration/shielded_outputs/` and `__tests__/shielded/` contain zero multisig coverage (grep confirmed).
