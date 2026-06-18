# PR 4 (#1087) — Address derivation, network version byte, key chains

Pre-review notes. Branch: `shielded/pr-4-address-derivation` (1 commit + the F1 fix), rebased onto master after PR 3 (#1086) merged. Diff: 10 files, ~555 insertions.

## What this PR is

The **identity layer** for shielded outputs. PR 1–3 delivered the crypto primitives and wire format; PR 4 answers: *what is a shielded address, how is it derived from the seed, and how does the rest of the wallet treat it.* It is deliberately inert — nothing calls the new derivation yet (PR 5's storage layer does); the only behavioral change to existing flows is a fail-loud guard in `sendTransaction`.

## Changes by concern

### 1. `models/network.ts` — shielded version byte
- `shielded: 0x3c` (mainnet) / `0x5d` (testnet + privatenet), added to `versionBytesType` and `isVersionByteValid()`.
- **Verified against hathor-core: the node has NO shielded version byte anywhere.** The 71-byte address is a wallet-ecosystem construct the node never parses — on-chain there is only the spend-derived P2PKH script; the scan pubkey is consumed sender-side for ECDH. So these constants need no core parity, but they ARE frozen ecosystem constants (desktop/mobile/headless must agree) and they avoid collision with existing bytes (mainnet `0x28`/`0x64`, testnet `0x49`/`0x87`).

### 2. `models/address.ts` — dual-format Address
- `validateAddress()` accepts 25-byte (legacy) or 71-byte (shielded); checksum logic unchanged (length-generic: checksum over all-but-last-4).
- `getType()` returns `'shielded'` for the shielded byte; `isShielded()` is the non-throwing wrapper.
- Extractors: `getScanPubkey()` = bytes [1, 34), `getSpendPubkey()` = [34, 67) — format `version(1) ‖ scan(33) ‖ spend(33) ‖ checksum(4)`. This is **RFC Option B** (full keys, Silent-Payments style): the sender can do ECDH with zero lookups.
- `getSpendAddress()` builds the on-chain P2PKH from `HASH160(spend_pubkey)` via bitcore — the core trick: on-chain, a shielded output's script is an ordinary P2PKH, indistinguishable from a transparent output.
- `getScript()` for shielded delegates to that spend-P2PKH script.

### 3. `utils/shieldedAddress.ts` (new)
- `encodeShieldedAddress(scan, spend, network)` — validates both keys are 33 bytes with `02`/`03` prefix (shape only, not on-curve — see F2), concat + checksum + Base58.
- `deriveShieldedAddress(scanXpub, spendXpub, index, networkName)` — derives both child pubkeys at the same index, returns `{base58, index, scanPubkey, spendPubkey, spendAddress}` — everything PR 5 needs to index by.

### 4. `utils/wallet.ts` — the key chains (heart of the PR)
Two new **hardened accounts** under the BIP44 root:

| chain | path | authority |
|---|---|---|
| scan | `m/44'/280'/1'/0` | view-only: detect + decrypt incoming shielded outputs |
| spend | `m/44'/280'/2'/0` | signing |

Stored in access data as plaintext xpubs (`scanXpubkey`/`spendXpubkey`) + PIN-encrypted xprivs (`scanMainKey`/`spendMainKey`). Separate from legacy account `0'` so a scan key handed to a watch service grants no spending power over shielded *or* legacy funds.

- **`migrateShieldedAccessData()`** — upgrades pre-shielded wallets: idempotent (no-op when all 4 fields exist), fail-safe (no partial writes; decrypt failure throws before any mutation), disambiguates the password-vs-PIN confusion in its error with the original attached as `cause`. Doc comment pins the contract: migration must yield byte-identical keys to fresh creation. Well done.
- **`changePin()`** re-encrypts both new keys (easy to forget; covered).
- `generateAccessData` (xpriv path) derives shielded keys only `if (argXpriv.depth === 0)` — correct: hardened accounts `1'`/`2'` cannot be derived from an account-level key. Account-xpriv wallets silently get no shielded support (known read-only-wallet limitation, TODO_FIX_39).

### 5. Types + the one behavioral change
- `IWalletAccessData` + 4 optional key fields; `IAddressInfo.addressType` gains `'shielded' | 'shielded-spend'` (forward declaration consumed by PR 5).
- `utils/address.ts getAddressType()` now **throws for shielded addresses**, and `sendTransaction.ts` uses it: pasting a shielded address into a transparent send fails loudly ("use the spend-derived P2PKH address instead"). Not a regression — pre-PR4 these addresses failed the 25-byte check anyway.

### 6. Crypto subtlety: compliant vs non-compliant derivation
Pub-side uses bitcore's compliant `deriveChild`; priv-side (PR 5 processing) uses `deriveNonCompliantChild`. Provably safe here: the compliant/non-compliant difference only manifests in **hardened** derivation (private-key serialization padding), and the hardened steps (`1'`, `2'`) exist only on the private side — xpubs cannot do hardened derivation at all. Every step that exists on both sides (`/0`, `/index`) is non-hardened, where the two methods are byte-identical. The code comment says "intentional, do not align" — it should also say *why* it is safe (suggested in review).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | should-fix | `validateAddress` checked length ∈ {25,71} and version byte independently — a crafted 25-byte address with the shielded byte (valid checksum) validated, typed `'shielded'`, and the extractors silently **clamped** `subarray` reads (20-byte "scan pubkey"). Mirror: 71-byte with legacy byte typed `'p2pkh'`. | **FIXED** — byte family dictates required length; crafted-address tests both directions. |
| F2 | suggested | No on-curve validation of embedded pubkeys. **Severity revised DOWN from the earlier stack review**: an off-curve scan key throws in the crypto provider at output-creation time; an off-curve spend key throws inside bitcore `PublicKey()` in `getSpendAddress()` — both before any tx exists. No fund-loss path; just a late/cryptic error. | **FIXED** — `assertValidCompressedPubkey` in `encodeShieldedAddress` + inline curve check in `getScanPubkey`/`getSpendPubkey` (inline to avoid a module cycle). Existing tests had to switch from `Buffer.alloc` fakes to genuine curve points — proof the check has teeth. |
| F3 | suggested | Test gaps: `deriveShieldedAddress` untested, no encode negatives, no cross-network rejection, no dedicated `shieldedAddress.ts` test file (codecov/patch risk per PR 3 precedent). | **FIXED** — new `__tests__/utils/shieldedAddress.test.ts` + address.test additions (incl. CodeRabbit's `getSpendAddress`/`getScript` ask). |
| F4 | nit | `deriveShieldedAddress` takes `networkName: string`; sibling utils take `Network`. | **Deferred to PR 5** — its one call site lives there; changing the signature on PR 4 would deliberately break the stack at rebase time for a cosmetic win. |
| F5 | nit | `getScanPubkey()`/`getSpendPubkey()` base58-decode the address twice (validate + extract). | **Skipped** — micro-perf, irrelevant at current scale. |

### CodeRabbit round 1 — verdicts

| # | Comment | Verdict |
|---|---|---|
| CR1 | Test `getSpendAddress()` + `getScript()` shielded branch | Valid (overlaps F3) — **addressed**. |
| CR2 | `spendXpriv2` inconsistent name | Valid copy-paste artifact — **renamed**. |
| CR3 | Document shielded fields also absent on xpub-only wallets | Valid — **doc updated** (hardened accounts need the root key; account-xpriv wallets included too). |
| CR4 | Clarify `'shielded'` vs `'shielded-spend'` semantics in `IAddressInfo` | Valid — **doc updated** (full 71-byte string vs spend-derived P2PKH; which one `getAddressType` accepts). |
| CR5 | Error message should name how to get the spend address | Valid quick win — **message now points to `Address.getSpendAddress()`**. |
| CR6 | Early pre-scan validation for shielded addresses in `prepareTxData` | **Not taken** — the throw already happens in the first pass over outputs before any side effects; a dedicated pre-scan is a redundant second iteration. CR5's message provides the actionable guidance. |

### CodeRabbit round 2 — verdicts

| # | Comment | Verdict |
|---|---|---|
| CR7 | Direct tests for `getAddressType` shielded throw + `createOutputScriptFromAddress` shielded branch | Valid — my F3 tests covered the *model* (`getScript`) but not these *utils*-level send-routing branches. **Added** in `__tests__/utils/address.test.ts`. |
| CR8 | `isShielded()` catches all exceptions → narrow to `AddressError` | Valid — **this was item #21 in my own original stack review**; CodeRabbit independently agrees. **Fixed**: only `AddressError` maps to `false`; anything else propagates. |
| CR9 | Validate `index` bounds in `deriveShieldedAddress` | Valid minor — negative/non-integer/hardened-range (≥2³¹) indexes died deep in bitcore with low-level errors. **Fixed**: upfront guard with deterministic message + boundary test (`0x7fffffff` accepted). |

## Verdict

Architecture is right and matches the RFC's intent: clean view/spend separation, frozen wallet-side version bytes, on-chain indistinguishability via spend-P2PKH, careful migration, derivation asymmetry handled correctly (if under-explained). F1 was the one ask-before-merge item and is fixed on the branch; F2/F3 are worth requesting; F4/F5 optional.

**Stack note:** pr-5..8 chain on pr-4 and do not carry the F1 commit; it propagates at the next stack rebase (after PR 4 merges), same as the PR 3 review commits did.

## Validation record (post-F1)

- `npm run lint` — clean
- `npm run build` — clean (138 files)
- `npm test` — **78 suites / 1006 tests pass**
