# Shielded Outputs Integration Review — hathor-wallet-lib `feat/shielded-outputs-integration`

Static review of the wallet-lib confidential-transactions (shielded outputs) integration against the
source of truth: hathor-core `experimental/shielded-outputs-alpha-v4` (Python) and the ct-crypto Rust
library, plus the RFC (PR #104) and the official client integration guide
([reference/rfc-summary.md](reference/rfc-summary.md),
[reference/client-guide-checklist.md](reference/client-guide-checklist.md)).

**Final tally after de-duplication: 42 findings — 1 critical, 14 high, 13 medium, 11 low, 3 info.**
(56 confirmed findings were raised across the reviewer dimensions; 14 were merged into canonical
duplicates, with their unique evidence folded in.)

## Overall verdict

The integration is a substantial and largely well-engineered implementation of the happy path —
shielded send/receive/decode, header construction, unshield balancing, and DEPOSIT-token flows are
correct against core and are exercised by 23 integration suites — but it is **not releasable as-is**.
One finding is an outright cryptographic-privacy break (GAP1-01: plaintext shielded values feed the
public, invertible weight formula, leaking the exact total shielded amount of every transaction the
wallet builds), and a cluster of high-severity defects undermines the feature's core promise or the
wallet's basic integrity: schemas that reject consensus-valid node JSON (remote-triggerable sync
break, COMP-01), silent auto-unshielding of confidential funds in default sends and token-admin
flows (STATE-04), transparent change that re-publishes shielded custom-token balances (COMP-04),
blinding factors persisted unencrypted next to PIN-encrypted keys (SEC-01), voided-tx handling that
permanently destroys UTXO records (STATE-01), a non-convergent full-history reprocess on every
websocket event (STATE-02), and whole wallet classes (multisig, stream-sync, FEE-version tokens,
nano/template txs) that silently misbehave. The privacy-critical fixes (GAP1-01/02, STATE-04,
COMP-04, SEC-01) and the sync-integrity fixes (COMP-01, STATE-01, STATE-02) should be treated as
release blockers; most of the remainder are guard/validation/UX gaps that are individually small
but collectively define whether the feature fails loudly or silently.

## Answers to the five review questions

### 1. Feature completeness (vs hathor-core alpha-v4)

Core send/receive/sync for P2PKH fullnode wallets is complete, but significant core-supported
capability is unreachable or unhandled: minting/creating token supply directly into shielded
outputs has consumer-side plumbing but no producer (COMP-07); shielded change exists only for HTR,
so partial spends of shielded custom tokens always leak via transparent change (COMP-04); readonly/
xpub wallets have no view-key import path despite the scan/spend split being designed for it
(COMP-05); the wallet-service wallet has zero shielded support and core's events-API plumbing has
no wallet-lib consumer (COMP-06); both stream history-sync modes never cover shielded-spend
addresses, so restored wallets miss all shielded receives (COMP-02); multisig wallets silently get
single-sig shielded chains (COMP-03); and PartialTx/atomic-swap and transaction-template paths have
no shielded awareness (COMP-10). FEE-version tokens are effectively unusable with shielded outputs
(GAP2-06, GAP3-01).

### 2. Correctness (wire format, headers, crypto, core divergences)

The wire serialization, header layouts, and the main balance/excess computations match core, and
GAP3-04 records that token flows do correctly route through the unshield fallback with Mint/Melt
headers declared. The correctness failures are at the edges of the core contract: zod schemas
require `ephemeral_pubkey`/`decoded` keys core legitimately omits, making consensus-valid txs
unparseable on every sync path (COMP-01); the tx-API fallback rejects shielded-spending inputs and
drops `shielded_outputs` (WIRE-03); the FeeHeader for FEE-version tokens is computed over phantom
outputs and shielded inputs, diverging from core's transparent-only exact-fee equation (GAP2-06,
GAP3-01); the mint/melt auto-declaration delta includes shielded values core's check ignores
(GAP2-01); the surjection-proof domain diverges latently from node verification (CRY-01); and the
worst divergence is GAP1-01/GAP1-02 — wallet-lib feeds plaintext shielded values into the weight
formula while core uses transparent outputs only, leaking the committed amounts on-chain.

### 3. Corner cases

Several corner cases fail silently rather than loudly: timelocked shielded receives are stored
unlocked, over-reporting balance and producing node-rejected spends plus a griefing vector
(COMP-08); values outside `[1, 2^40)` are never pre-validated — and a window just above 2^40
silently produces node-accepted variable-size proofs that break the constant-proof-size privacy
invariant (COMP-09); voided/reorged spenders permanently destroy UTXO records (STATE-01); shielded
UTXOs flow into nano-contract/template txs that never compute the excess blinding factor
(STATE-03); decryption is silently skipped without a constructor-cached PIN (STATE-08);
`prepareTransaction`'s fallback silently skips degraded shielded inputs (GAP3-03); full-unshield
excess includes authority-output masks on one of two paths (EDGE-04); shielding an entire balance
to a single recipient is impossible with no graceful path (EDGE-05); melt-from-shielded can build
unrelayable `UnusedTokensError` txs (GAP2-05); and cross-type address validation accepts
mismatched length/version-byte combinations (WIRE-04).

### 4. Test coverage

The 23 shielded integration suites cover the primary flows well, but the highest-risk seams are
untested: the shielded zod schemas have zero tests and are never exercised against canonical core
JSON shapes — exactly where COMP-01 lives (TEST-01); stream-sync shielded derivation is completely
untested behind a swallow-all catch (TEST-05); multisig shielded derivation has zero coverage
(TEST-08); MintHeader/MeltHeader + ShieldedOutputsHeader coexistence is never exercised and several
test names overstate their bodies (TEST-06); the mixed-ownership unblinding boundary — the exact
privacy invariant — is untested (TEST-07); double-spend rejection and real on-chain voiding are
only simulated (TEST-03); no test approaches the 2^40 value ceiling (TEST-02); and one assertion is
vacuous (TEST-04). FEE-version tokens have no shielded coverage at all (GAP2-06/GAP3-01).

### 5. Security & privacy

No finding allows fund theft or key compromise, but the privacy posture — the feature's entire
point — has serious holes. Release blockers: GAP1-01/GAP1-02 (exact shielded totals recoverable
from on-chain weight), STATE-04 (silent auto-unshield of confidential funds in default sends and
token-admin ops), COMP-04 (transparent change re-publishes shielded custom-token holdings), and
SEC-01 (blinding factors + recovered amounts persisted unencrypted — transferable cryptographic
proof of all confidential amounts to any store reader, with a PIN-less export API on top).
Availability: COMP-01 is a cheap, remote-triggerable persistent sync break. Hardening: unbounded
proof sizes on the JSON path before native crypto calls (SEC-02), deterministic change position and
first-cycle address linkability (SEC-03), and the COMP-09 proof-size side channel. The rejected
SEC-04 candidate confirmed the unshield-scalar mechanics but its claimed extra linkage was refuted
— inputs already name their outpoints on-chain.

## Findings table

| ID | Severity | Title | File |
|----|----------|-------|------|
| [GAP1-01](GAP1-01-plaintext-shielded-values-leak-via-weight.md) | critical | Plaintext shielded output values enter tx weight, leaking exact total shielded amount on-chain | GAP1-01-plaintext-shielded-values-leak-via-weight.md |
| [COMP-01](COMP-01-required-ephemeral-pubkey-decoded-breaks-sync.md) | high | Wallet schemas require ephemeral_pubkey/decoded keys that hathor-core legitimately omits — consensus-valid shielded txs become unparseable and break sync (merged: WIRE-01, WIRE-02) | COMP-01-required-ephemeral-pubkey-decoded-breaks-sync.md |
| [COMP-02](COMP-02-stream-sync-misses-shielded-spend-addresses.md) | high | Stream-based history sync never covers shielded-spend addresses — restored wallets miss all shielded receives (merged: STATE-07) | COMP-02-stream-sync-misses-shielded-spend-addresses.md |
| [COMP-03](COMP-03-multisig-derives-single-sig-shielded-addresses.md) | high | Multisig wallets derive and expose single-sig shielded addresses — the shielded receive chain silently bypasses the P2SH multisig policy (merged: EDGE-03; prev. TODO_FIX_37) | COMP-03-multisig-derives-single-sig-shielded-addresses.md |
| [COMP-04](COMP-04-shielded-change-exists-only-for-htr.md) | high | Shielded change exists only for HTR — partial spends of shielded custom-token UTXOs always emit transparent change, revealing the remaining balance | COMP-04-shielded-change-exists-only-for-htr.md |
| [COMP-08](COMP-08-timelocked-shielded-receives-never-locked.md) | high | Timelocked shielded receives are treated as never locked — wallet offers them for spending and builds txs the node rejects (merged: EDGE-01, STATE-06) | COMP-08-timelocked-shielded-receives-never-locked.md |
| [GAP1-02](GAP1-02-create-token-tx-inherits-weight-leak.md) | high | CreateTokenTransaction inherits the same shielded-value weight leak | GAP1-02-create-token-tx-inherits-weight-leak.md |
| [GAP2-06](GAP2-06-fee-version-feeheader-phantom-outputs-mismatch.md) | high | FeeHeader for FEE-version tokens computed over phantom shielded outputs/inputs — every shielded send of a FEE-version token is built then rejected | GAP2-06-fee-version-feeheader-phantom-outputs-mismatch.md |
| [GAP3-01](GAP3-01-fee-token-admin-shielded-utxo-rejection.md) | high | FEE-version token mint/melt/create contaminated by shielded UTXOs builds txs hathor-core deterministically rejects (merged: GAP2-02) | GAP3-01-fee-token-admin-shielded-utxo-rejection.md |
| [SEC-01](SEC-01-blinding-factors-persisted-unencrypted.md) | high | Shielded value blinding factors and recovered plaintext amounts persisted unencrypted, unlike all other wallet key material (merged: STATE-05, CRY-02; prev. TODO_FIX_38) | SEC-01-blinding-factors-persisted-unencrypted.md |
| [STATE-01](STATE-01-voided-txs-destroy-utxo-records.md) | high | Voided/reorged spending txs permanently destroy the wallet's UTXO records | STATE-01-voided-txs-destroy-utxo-records.md |
| [STATE-02](STATE-02-onnewtx-safety-net-nonconvergent-full-reprocess.md) | high | onNewTx 'safety net' triggers a full processHistory on every websocket event for undecodable foreign shielded outputs — non-convergent O(N) reprocess per tx | STATE-02-onnewtx-safety-net-nonconvergent-full-reprocess.md |
| [STATE-03](STATE-03-shielded-utxos-in-nano-template-txs.md) | high | Default UTXO selection mixes shielded UTXOs into nano-contract and template transactions, which never compute the excess blinding factor — node-rejected txs | STATE-03-shielded-utxos-in-nano-template-txs.md |
| [STATE-04](STATE-04-silent-auto-unshield-on-transparent-sends.md) | high | Plain transparent sends (and token-administration flows) silently auto-unshield: shielded UTXOs spent without opt-in, permanently revealing confidential amounts (merged: GAP3-02) | STATE-04-silent-auto-unshield-on-transparent-sends.md |
| [TEST-01](TEST-01-shielded-schemas-untested-core-json-shapes.md) | high | Shielded zod schemas have zero tests and are never exercised against canonical hathor-core JSON shapes | TEST-01-shielded-schemas-untested-core-json-shapes.md |
| [COMP-05](COMP-05-readonly-wallets-no-shielded-view-key.md) | medium | Readonly/xpub wallets have zero shielded capability and no scan-key (view-key) import path — balances silently incomplete (prev. TODO_FIX_39) | COMP-05-readonly-wallets-no-shielded-view-key.md |
| [COMP-06](COMP-06-wallet-service-no-shielded-support.md) | medium | Wallet-service wallet has no shielded support and the new core events-API plumbing is not consumed anywhere in wallet-lib | COMP-06-wallet-service-no-shielded-support.md |
| [COMP-07](COMP-07-minting-into-shielded-outputs-unreachable.md) | medium | Minting token supply directly into shielded outputs (incl. shielded TCT) is unreachable — core supports it, wallet-lib has no producer | COMP-07-minting-into-shielded-outputs-unreachable.md |
| [COMP-09](COMP-09-missing-shielded-value-range-prevalidation.md) | medium | No pre-validation that shielded values are in [1, 2^40) — out-of-range amounts fail deep in native crypto or silently break the constant-proof-size invariant (merged: WIRE-05, CRY-03, EDGE-02) | COMP-09-missing-shielded-value-range-prevalidation.md |
| [GAP2-01](GAP2-01-mint-melt-delta-includes-shielded-values.md) | medium | Mint/Melt auto-declaration delta includes shielded values while core's undeclared-mint/melt check is transparent-only — unfixable node-rejected tx instead of a refusal | GAP2-01-mint-melt-delta-includes-shielded-values.md |
| [GAP3-03](GAP3-03-prepare-transaction-silently-skips-shielded-inputs.md) | medium | prepareTransaction's unshield fallback silently skips shielded inputs with missing UTXO/blindingFactor, producing node-rejected txs where SendTransaction throws (merged: GAP2-04) | GAP3-03-prepare-transaction-silently-skips-shielded-inputs.md |
| [STATE-08](STATE-08-shielded-decryption-skipped-without-cached-pincode.md) | medium | Shielded decryption silently skipped when the wallet instance has no cached pinCode — start({pinCode}) does not enable it, no warning surfaced | STATE-08-shielded-decryption-skipped-without-cached-pincode.md |
| [TEST-03](TEST-03-v4-double-spend-rejection-never-exercised.md) | medium | V.4 does not test what it claims: double-spend rejection of a shielded UTXO never exercised; on-chain voiding only simulated via hand-fed onNewTx flags | TEST-03-v4-double-spend-rejection-never-exercised.md |
| [TEST-05](TEST-05-stream-sync-shielded-derivation-untested.md) | medium | Stream-sync shielded address derivation completely untested — and its swallow-all catch makes regressions silent | TEST-05-stream-sync-shielded-derivation-untested.md |
| [TEST-06](TEST-06-mint-melt-with-shielded-outputs-untested.md) | medium | MintHeader/MeltHeader coexisting with ShieldedOutputsHeader never exercised; 'mint/melt to shielded' test names overstate their bodies | TEST-06-mint-melt-with-shielded-outputs-untested.md |
| [TEST-07](TEST-07-mixed-ownership-unblinding-scope-untested.md) | medium | Unblinding-payload scope for mixed-ownership txs untested — the exact privacy boundary case | TEST-07-mixed-ownership-unblinding-scope-untested.md |
| [TEST-08](TEST-08-multisig-shielded-derivation-untested.md) | medium | Multisig wallets get single-sig shielded key chains derived with zero test coverage; wallet-service shielded handling has a 1-line test delta | TEST-08-multisig-shielded-derivation-untested.md |
| [WIRE-03](WIRE-03-tx-api-fallback-drops-shielded-outputs.md) | medium | Combined output-index space not honored on the tx-API fallback path; convertFullNodeTxToHistoryTx drops shielded_outputs | WIRE-03-tx-api-fallback-drops-shielded-outputs.md |
| [COMP-10](COMP-10-partialtx-template-paths-no-shielded-awareness.md) | low | PartialTx (atomic swap) and transaction-template paths have no shielded awareness (prev. TODO_FIX_40) | COMP-10-partialtx-template-paths-no-shielded-awareness.md |
| [CRY-01](CRY-01-surjection-domain-authority-inputs-mint-generators.md) | low | Surjection-proof domain includes authority inputs and omits MintHeader generators, diverging from node verification (latent) | CRY-01-surjection-domain-authority-inputs-mint-generators.md |
| [EDGE-04](EDGE-04-full-unshield-excess-includes-authority-outputs.md) | low | Full-unshield excess computation in SendTransaction includes authority outputs' mask value, diverging from the prepareTransaction path (latent) | EDGE-04-full-unshield-excess-includes-authority-outputs.md |
| [EDGE-05](EDGE-05-shield-entire-balance-single-recipient-impossible.md) | low | Shielding an entire balance to a single recipient is impossible — ≥2-output rule plus the 1-min range proof leave no decoy option | EDGE-05-shield-entire-balance-single-recipient-impossible.md |
| [GAP2-03](GAP2-03-tokens-filter-excludes-authority-outputs.md) | low | tokens[] privacy filter excludes authority outputs — authority-only + FullShielded token would serialize with token_data 0x80 (latent) | GAP2-03-tokens-filter-excludes-authority-outputs.md |
| [GAP2-05](GAP2-05-melt-from-shielded-unused-tokens-unrelayable.md) | low | Melt-from-shielded with createAnotherMelt=false and no token change is unrelayable (UnusedTokensError); wallet has no guard | GAP2-05-melt-from-shielded-unused-tokens-unrelayable.md |
| [SEC-02](SEC-02-unbounded-proof-sizes-json-receive-path.md) | low | No upper bound on range_proof / surjection_proof / script sizes on the JSON receive path before native crypto calls | SEC-02-unbounded-proof-sizes-json-receive-path.md |
| [SEC-03](SEC-03-shielded-change-position-and-address-linkability.md) | low | Shielded HTR change routed to the non-rotating current shielded address and always the last (balancing) output | SEC-03-shielded-change-position-and-address-linkability.md |
| [TEST-02](TEST-02-no-test-40-bit-value-ceiling.md) | low | No test covers the 40-bit value ceiling for shielded amounts; largest amount exercised is ~2^26 | TEST-02-no-test-40-bit-value-ceiling.md |
| [TEST-04](TEST-04-a6-full-before-bare-vacuous-assertion.md) | low | A.6 (full-before-bare ws ordering) asserts nothing: `expect(typeof balAfter).toBe('object')` is vacuously true | TEST-04-a6-full-before-bare-vacuous-assertion.md |
| [WIRE-04](WIRE-04-address-validation-length-version-byte-mismatch.md) | low | Address validation does not bind payload length to version byte — cross-type addresses validate as the wrong kind | WIRE-04-address-validation-length-version-byte-mismatch.md |
| [WIRE-06](WIRE-06-mode-inferred-from-asset-commitment-presence.md) | info | normalizeShieldedOutputs infers mode from asset_commitment presence, ignoring the node's canonical mode discriminator | WIRE-06-mode-inferred-from-asset-commitment-presence.md |
| [WIRE-07](WIRE-07-shielded-address-format-wallet-lib-only.md) | info | Shielded address wire format is a wallet-lib-only convention diverging from the RFC sketch — must be standardized before cross-client release | WIRE-07-shielded-address-format-wallet-lib-only.md |
| [GAP3-04](GAP3-04-token-flows-route-through-unshield-fallback.md) | info | Premise corrections: token flows DO route through the unshield fallback; Mint/Melt headers ARE declared; DEPOSIT-version shielded token ops are integration-tested | GAP3-04-token-flows-route-through-unshield-fallback.md |

### Duplicates merged

14 confirmed write-ups were folded into the canonical files above (unique evidence preserved in
"Evidence folded from ..." sections): WIRE-01 & WIRE-02 → COMP-01; STATE-07 → COMP-02; EDGE-03 →
COMP-03; EDGE-01 & STATE-06 → COMP-08 (severity raised to high per the EDGE-01 panel); WIRE-05
(two write-ups), CRY-03 & EDGE-02 → COMP-09; STATE-05 & CRY-02 → SEC-01; GAP2-02 → GAP3-01;
GAP2-04 → GAP3-03; GAP3-02 → STATE-04. Ten same-ID duplicate write-ups (second drafts of WIRE-04/
06/07, CRY-01, TEST-01/03/07/08, SEC-02/03) were likewise folded and deleted.

## Rejected candidates

- **SEC-04 — "Full-unshield with a single shielded input publishes that input's blinding factor,
  linking the prior private receive to the public spend":** refuted by the source of truth — the
  code facts checked out (the excess scalar is computed and published as claimed), but the claimed
  privacy impact does not hold: Hathor inputs explicitly reference their outpoints on-chain, so
  *which* shielded commitment is being spent is already public, and core's own docstring shows the
  transparent outputs of a deliberate full unshield already expose the amount; the scalar adds no
  new linkage. The legitimate residual concern (the unshield being *automatic and unconsented*) is
  covered by STATE-04.
- Several preliminary claims were corrected (not severity-rejected) during adversarial review and
  are recorded inside the surviving findings, most notably GAP3-04 (token flows do route through
  the unshield fallback; Mint/Melt headers are declared; DEPOSIT-version ops are tested), the
  PartialTx fails-closed corrections in COMP-10, and the change-address-rotation correction in
  SEC-03.

## How this review was produced

Multi-agent review pipeline: ground truth was established from the hathor-core
`experimental/shielded-outputs-alpha-v4` worktree (Python verifiers, headers, shielded crypto) and
the ct-crypto Rust sources, with the RFC summary and client integration guide as reference docs.
Seven reviewer dimensions (feature completeness, wire/correctness, cryptography, state/sync
integrity, edge cases, test coverage, security) examined the wallet-lib worktree independently,
followed by a gap round (three additional passes targeting weight/fees, token flows, and
mint/melt interactions). Every candidate finding was then adversarially verified by 1-3
independent skeptic agents that re-read all cited lines in both worktrees before a finding was
confirmed; one candidate (SEC-04) was refuted and several others were narrowed or corrected. This
synthesis pass de-duplicated the confirmed set (56 write-ups → 42 canonical findings), folded
unique evidence into the canonical files, and cross-referenced earlier PR-stack TODO_FIX trackers.
