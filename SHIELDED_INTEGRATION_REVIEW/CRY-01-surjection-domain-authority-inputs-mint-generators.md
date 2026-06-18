# CRY-01: Surjection-proof domain includes authority inputs and omits MintHeader generators, diverging from node verification

**Severity:** low - **Status:** confirmed by adversarial review

**Also reported as:** a second CRY-01 write-up (surjection domain authority/mint divergence) — duplicate deleted; identical evidence set.

## Summary

When the wallet builds surjection proofs for FullShielded outputs, it constructs the proof's input-generator domain from *every* input that carries a token — including token-authority inputs — and it never extends the domain with the asset tags of the transaction's own MintHeader entries. hathor-core builds the verification domain differently: it *skips* token-authority inputs and *appends* one asset-tag generator per MintHeader entry. A surjection proof is bound to the exact generator list (membership and order) it was created over, so any divergence makes the node reject the proof. Today no wallet flow can actually produce a diverging transaction (authority inputs are blocked and mint headers cannot coexist with shielded outputs on the reachable paths), so this is a latent divergence, not a current user-facing bug.

## Location

- src/new/sendTransaction.ts:452-468 — input-generator collection (no authority skip)
- src/new/sendTransaction.ts:517-523 — `createShieldedOutputs` call (no mint-entry generators passed)
- src/shielded/creation.ts:129-145 — `buildSurjectionDomain` consumes the list verbatim
- src/utils/transaction.ts:1070-1075 — MintHeader attached in `_attachShieldedHeaders`, *after* proofs were already created

## Details

In `prepareTxData` (src/new/sendTransaction.ts), the wallet walks all inputs and pushes one `InputGeneratorInfo` per input, gated only on the input having a token:

```ts
// src/new/sendTransaction.ts:459-468
// Build generator info for surjection proof domain
if (inp.token) {
  const genInfo: InputGeneratorInfo = { tokenUid: inp.token as string };
  // For FullShielded inputs, pass the asset blinding factor so the
  // surjection proof domain uses the blinded generator (asset_commitment)
  // matching what the fullnode verifies against.
  if (utxo?.shielded && utxo.assetBlindingFactor) {
    genInfo.assetBlindingFactor = Buffer.from(utxo.assetBlindingFactor, 'hex');
  }
  inputGenerators.push(genInfo);
}
```

There is no check for `inp.authorities !== 0n`: a token-authority input (which always has a token UID) would contribute a generator to the domain. `buildSurjectionDomain` then converts the list one-to-one, in order, with no filtering:

```ts
// src/shielded/creation.ts:138-144
const domain: ISurjectionDomainEntry[] = [];
for (const inputInfo of inputGenerators) {
  const inputTokenBuf = Buffer.from(
    inputInfo.tokenUid === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : inputInfo.tokenUid,
    'hex'
  );
  const inputTag = await cryptoProvider.deriveTag(inputTokenBuf);
  const abf = inputInfo.assetBlindingFactor ?? ZERO_TWEAK;
  const inputGen = await cryptoProvider.createAssetCommitment(inputTag, abf);
  domain.push({ generator: inputGen, tag: inputTag, blindingFactor: abf });
}
```

Separately, the domain never includes MintHeader entries. The MintHeader is built and attached inside `_attachShieldedHeaders` (src/utils/transaction.ts:1070-1075), which runs in `createTransactionFromData` — *after* `createShieldedOutputs` already produced the surjection proofs at src/new/sendTransaction.ts:517. Structurally, the proofs can never have seen mint-entry generators.

## Source of truth

hathor-core builds the verifier's domain with two rules the wallet does not mirror:

1. **Authority inputs are excluded** — hathor-core:hathor/verification/transaction_verifier.py:868-869:

   ```python
   if spent_output.is_token_authority():
       continue
   ```

2. **MintHeader entries are appended** — hathor-core:hathor/verification/transaction_verifier.py:892-897:

   ```python
   # Extend the surjection-proof domain with one generator per MintHeader
   # entry so a FullShieldedOutput can claim a freshly-minted asset.
   if tx.has_mint_header():
       for entry in tx.get_mint_header().entries:
           token_uid = tx.get_token_uid(entry.token_index)
           domain_generators.append(self._get_or_derive_asset_tag(token_uid, asset_tag_cache))
   ```

The proof itself is sensitive to the exact domain: hathor-ct-crypto verifies over the precise generator list (hathor-core:hathor-ct-crypto/src/surjection.rs:40-51), and secp256k1-zkp surjection verification fails on any length or order mismatch between prover and verifier domains.

## Impact

If a FullShielded-output transaction could be built that (a) spends a transparent token-authority UTXO, or (b) carries a MintHeader, the wallet's proof would be over a domain the node cannot reproduce, and the node would reject the transaction with `InvalidSurjectionProofError` — after the wallet already spent PoW on it.

However, both trigger scenarios are currently unreachable through the wallet:

- `sendTransaction.ts:517` is the only caller of `createShieldedOutputs`; token mint/melt flows (src/utils/tokens.ts) and transaction templates have no shielded-output support.
- Authority inputs are categorically blocked on this path: user-supplied inputs go through `checkUnspentInput`, which rejects authority outputs (src/new/sendTransaction.ts:1287-1295, "XXX: We are NOT enabling authority outputs for now"), and automatic UTXO selection filters with `authorities: 0n` (src/utils/utxo.ts:58, :110).
- A MintHeader on a regular shielded tx requires a mint-authority input (src/utils/transaction.ts:1040-1044 populates `mintAuthorityTokens` only from `inp.authorities`), which cannot be present per the above. The createToken branch (unconditional mint declaration) only coexists with the full-unshield path (shielded inputs, zero shielded outputs — gated at src/new/sendTransaction.ts:543), where no surjection proof exists to mismatch.

For the reachable case (no authority inputs, no mint), the wallet's domain matches the node's: input ordering (`allInputs = [...partialInputs, ...partialHtrTxData.inputs]`, src/new/sendTransaction.ts:440) matches final tx input order, and per-input generators agree (blinded asset commitment for FullShielded inputs vs hathor-core:hathor/verification/transaction_verifier.py:879-880; derived tag for transparent/AmountShielded inputs vs :871 and :890). So this is a hardening/future-proofing issue: the moment authority inputs or mint+shielded coexistence is enabled (and `_attachShieldedHeaders`'s mint-detection machinery shows the codebase anticipates exactly that), this divergence becomes a hard transaction-rejection bug.

## Recommendation

Mirror the node's domain construction exactly:

1. In the input loop at src/new/sendTransaction.ts:459, skip authority inputs when pushing generators:

   ```ts
   if (inp.token && (inp.authorities ?? 0n) === 0n) {
     ...
     inputGenerators.push(genInfo);
   }
   ```

2. Determine the transaction's prospective MintHeader entries *before* calling `createShieldedOutputs` (or pass the mint-entry token UIDs into it), and have `buildSurjectionDomain` append their derived asset tags after the input generators — same order the verifier uses: inputs in tx order, then mint entries in header order. This likely requires lifting the mint-entry computation out of `_attachShieldedHeaders` (src/utils/transaction.ts) so both the proof builder and the header attacher share one source of truth.

3. Add an integration test covering a FullShielded send that includes an authority input and a mint, once those flows are enabled; until then, a unit test asserting domain parity with a fixture mirroring `transaction_verifier.py`'s rules would pin the behavior.

## Verification notes

The skeptic panel confirmed the code-level divergence on all four claims:

1. Wallet domain construction pushes one generator per `inp.token` with no authority skip (src/new/sendTransaction.ts:459-467), consumed verbatim and in order by `buildSurjectionDomain` (src/shielded/creation.ts:129-145).
2. Node verifier excludes authority inputs (hathor-core:hathor/verification/transaction_verifier.py:868-869) and appends MintHeader tags (:892-897) — exactly as claimed.
3. MintHeader is attached after proof creation (src/utils/transaction.ts:1070-1075 via `_attachShieldedHeaders`, vs proof creation at src/new/sendTransaction.ts:517), so proofs structurally cannot include mint generators.
4. Proof sensitivity to domain length/order confirmed in hathor-core:hathor-ct-crypto/src/surjection.rs:40-51 (secp256k1-zkp semantics).

Severity was reduced from medium to low because the panel demonstrated both failure scenarios are unreachable via the wallet's current public flows: authority inputs are rejected by `checkUnspentInput` (src/new/sendTransaction.ts:1287-1295) and filtered by UTXO selection (src/utils/utxo.ts:58, :110); mint headers on the shielded-output path require an authority input that cannot exist; and the createToken/full-unshield branch carries no surjection proofs. The reachable path's domain provably matches the node's. The finding stands as accurate future-proofing against a guaranteed rejection bug once authority/mint support lands on the shielded path.
