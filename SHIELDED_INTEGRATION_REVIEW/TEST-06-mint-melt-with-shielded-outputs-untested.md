# TEST-06: MintHeader/MeltHeader coexisting with ShieldedOutputsHeader is never exercised; 'mint/melt to shielded' test names overstate what the bodies test

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

hathor-core explicitly supports transactions that carry a MintHeader (or MeltHeader) *together with* a ShieldedOutputsHeader — e.g. minting fresh supply directly into a fully-shielded output — and the wallet-lib auto-declare logic in `_attachShieldedHeaders` is written to produce exactly that combination. Yet no test in the entire suite (unit or integration) ever builds or asserts a transaction with both headers. Worse, three integration tests whose names claim to cover "mint/melt to a shielded address" (S.1, K.4, K.5) actually produce transactions that take a different path entirely: S.1 sends *already-minted* supply (no MintHeader), and K.4/K.5 rely on the shielded-address → transparent spend-P2PKH auto-conversion, producing fully transparent txs with no shielded headers at all. A regression in the Mint/Melt+ShieldedOutputs path would be caught by nothing.

## Location

- `__tests__/integration/shielded_outputs/mint_melt_shielded.test.ts:99-133` — S.1 "mint more tokens to FS output" (body is a plain send, not a mint)
- `__tests__/integration/shielded_outputs/token_creation.test.ts:120-139` — K.4 "Mint more tokens to a shielded address" (transparent tx, only balance asserted)
- `__tests__/integration/shielded_outputs/token_creation.test.ts:411-433` — K.5 "Melt tokens with a shielded change address" (same)
- `src/utils/transaction.ts:993-1076` — auto-declare mint/melt logic in `_attachShieldedHeaders` whose shielded-outputs branch is never exercised end-to-end
- `src/utils/address.ts:144-148` — shielded-address → spend-P2PKH auto-conversion that K.4/K.5 silently route through

## Details

### Header combinations actually covered by the integration suite

Auditing every transaction built in `__tests__/integration/shielded_outputs/`:

| Combination | Covered by |
|---|---|
| Fee + ShieldedOutputs | most suites (core, multi-token, etc.) |
| Fee + Unshield | U.* suite, I.10 |
| Unshield + Mint | S.0 (create-token tx), S.4 (`mintTokens` with shielded HTR funding) |
| Unshield + Melt | S.2, S.3 (melting shielded-held token UTXOs) |
| **Mint + ShieldedOutputs** | **nothing** |
| **Melt + ShieldedOutputs** | **nothing** |

An exhaustive grep confirms `MintHeader`/`MeltHeader` appear in tests only in `__tests__/integration/shielded_outputs/mint_melt_shielded.test.ts` (comments and Unshield-combo cases) and in the standalone header serialization unit tests (`__tests__/headers/mint_header.test.ts`, `melt_header.test.ts`, `parser.test.ts`, `unshield_balance.test.ts`). No built transaction anywhere combines a Mint/Melt header with a ShieldedOutputsHeader.

### The wallet code that would emit the combination is live but unreached

`_attachShieldedHeaders` in `src/utils/transaction.ts` treats a tx as "shielded" if it has shielded outputs **or** an excess blinding factor, then auto-declares Mint/Melt headers from the per-token transparent+shielded delta:

```ts
// src/utils/transaction.ts:993-996
const isShieldedTx =
  (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) ||
  !!txData.excessBlindingFactor;
if (isShieldedTx && !tx.headers.some(h => h instanceof MintHeader || h instanceof MeltHeader)) {
```

and at `src/utils/transaction.ts:1056-1062` / `1070-1075` pushes a `MintHeader` when a mint authority is present and the token delta is positive (symmetric for melt). The `shieldedOutputs.length > 0` arm of `isShieldedTx` means this code is *designed* to emit `MintHeader + ShieldedOutputsHeader` — but every test that reaches the mint/melt branch does so via the `excessBlindingFactor` (Unshield) arm. The shielded-outputs arm of the conjunction is dead in the test suite. Note also that the delta computation explicitly counts shielded outputs (`src/utils/transaction.ts:1035-1038`), logic that only matters in the untested combination.

### Three test names claim coverage they do not provide

1. **S.1 "mint more tokens to FS output"** (`mint_melt_shielded.test.ts:99-133`): the body creates a token via `createTokenHelper` (a separate, earlier tx), then sends the *already-minted* supply with `wallet.sendManyOutputsTransaction([...FULLY_SHIELDED...])` at lines 113-126. There is no `mintTokens` call and no MintHeader in the asserted tx — it is an ordinary Fee+ShieldedOutputs send, a shape covered many times elsewhere. The doc comment at lines 94-98 ("newly minted tokens land in a shielded output") does not match the body.

2. **K.4 "Mint more tokens to a shielded address"** (`token_creation.test.ts:120-139`): calls `wallet.mintTokens(tokenResp.hash, 25n, { address: shieldedRecipient })`. `mintTokens` has no shielded-output option (zero shielded references in `src/utils/tokens.ts`), so the shielded destination address falls through `createOutputScriptFromAddress` and is auto-converted to a transparent P2PKH script on the spend key:

   ```ts
   // src/utils/address.ts:144-148
   if (addressType === 'shielded') {
     // For shielded addresses, derive P2PKH script from spend_pubkey
     const spendAddress = addressObj.getSpendAddress();
     const p2pkh = new P2PKH(spendAddress);
     return p2pkh.createScript();
   }
   ```

   The resulting mint tx is fully transparent — no ShieldedOutputsHeader, and no MintHeader either (transparent mints don't need one). The test asserts only `bal[0].balance.unlocked).toBe(125n)` (line 138); it never inspects headers or output scripts, so it would pass identically whether the output were shielded, transparent, or any other balance-preserving shape.

3. **K.5 "Melt tokens with a shielded change address for the returned HTR"** (`token_creation.test.ts:411-433`): same pattern — `meltTokens(..., { changeAddress: shieldedChange })` auto-converts; only the HTR balance (`toBe(100n)`, line 432) is asserted.

The auto-conversion behavior itself *is* pinned, but only for the plain-send path: `__tests__/integration/shielded_outputs/core.test.ts:479` ("should send transparent output to a shielded address (auto-converts to spend P2PKH)"). Nothing pins it for the mint/melt flows, and nothing documents that K.4/K.5 are exercising the conversion rather than shielded headers.

## Source of truth

hathor-core treats Mint/Melt + ShieldedOutputs as a first-class, supported combination:

- **hathor-core:hathor/verification/transaction_verifier.py:672-691** — `verify_mint_melt_requires_shielded` (Rule M1): a MintHeader/MeltHeader is valid if the tx carries *either* a ShieldedOutputsHeader *or* an UnshieldBalanceHeader. The ShieldedOutputsHeader arm exists precisely for the mixed case.
- **hathor-core:hathor/verification/transaction_verifier.py:892-897** — the surjection-proof domain is extended "with one generator per MintHeader entry so a FullShieldedOutput can claim a freshly-minted asset". This code path is *only* meaningful when FS outputs coexist with a MintHeader — the exact combination wallet-lib never builds or tests.
- **hathor-core:hathor/verification/transaction_verifier.py:992-1019** — Rule M4 folds Mint/Melt header entries into the augmented balance equation (mint amounts on the input side, melt on the output side, plus deposit/fee adjustments), which must close against shielded commitments when shielded outputs are present.

So the consensus layer has dedicated, non-trivial verification logic (surjection-domain extension, M4 folding against Pedersen commitments) for the very shape that has zero client-side coverage.

## Impact

This is a test gap, not a live bug — but in consensus-critical header construction. Concretely:

- If `_attachShieldedHeaders` regressed in the shielded-outputs arm — e.g. miscomputing the per-token delta when shielded outputs contribute (`src/utils/transaction.ts:1035-1038`), or a future refactor narrowing `isShieldedTx` to the excess-blinding case only — no test would fail. The breakage would surface as node-side rejections (`ForbiddenMint`/`ForbiddenMelt`, surjection-proof failure) for the first user who mints directly into a shielded output.
- Symmetrically, a core-side regression in the surjection-domain extension or M4 folding for the mixed case would not be caught by wallet-lib integration tests either, since they never submit such a tx to the node.
- The misleading names actively harm review: anyone auditing coverage of the shielded mint/melt matrix would read S.1/K.4/K.5 and conclude the combination is tested. The adversarial review panel itself initially had to disprove that impression by reading the test bodies.

## Recommendation

Pick one of two directions and make the suite honest either way:

1. **Preferred — add a real combo test.** Add an integration test that produces a tx carrying both a MeltHeader (or MintHeader) and a ShieldedOutputsHeader, and assert the shape, not just balances. The melt direction is reachable today with existing APIs: melt shielded-held tokens while *also* emitting a shielded change/output in the same tx, driving the `shieldedOutputs.length > 0` arm of `isShieldedTx`. Assert on the returned `Transaction`:

   ```ts
   expect(tx.headers.some(h => h instanceof ShieldedOutputsHeader)).toBe(true);
   expect(tx.headers.some(h => h instanceof MeltHeader)).toBe(true); // or MintHeader
   await waitForTxReceived(wallet, tx.hash!); // node accepted both headers together
   ```

   For the mint direction (FS output of freshly minted tokens — the case exercising the core surjection-domain extension at transaction_verifier.py:892-897), if `mintTokens` cannot express it, build the tx via the lower-level send/template path.

2. **If Mint/Melt+ShieldedOutputs is intentionally unsupported by the high-level APIs**, pin that decision: in K.4/K.5, assert the minted/withdraw output script is a transparent P2PKH on the spend key and that `tx.headers` contains **no** shielded header — mirroring the existing auto-conversion pin at `core.test.ts:479`.

In both cases, rename the misleading tests to match what they verify:

- S.1 → "send already-minted supply to FS outputs" (or convert it into a genuine mint-to-FS test under option 1);
- K.4 → "mintTokens to a shielded address auto-converts to spend-P2PKH (transparent)";
- K.5 → "meltTokens withdraw to a shielded change address auto-converts to spend-P2PKH (transparent)".

## Verification notes

The skeptic panel confirmed every claim independently:

1. Read S.1's body (`mint_melt_shielded.test.ts:113-126`): it is `sendManyOutputsTransaction` of pre-minted supply; no `mintTokens` call, hence no MintHeader, despite the name and doc comment.
2. Confirmed `mintTokens`/`meltTokens` have no shielded-output pathway (zero shielded references in `src/utils/tokens.ts`) and that K.4/K.5's shielded addresses route through the auto-conversion at `src/utils/address.ts:144-148`, yielding fully transparent txs; both tests assert balances only (`token_creation.test.ts:137-138`, `430-432`).
3. Exhaustive grep over `__tests__/` showed `MintHeader`/`MeltHeader` appear only in standalone header unit tests (`__tests__/headers/`) and in `mint_melt_shielded.test.ts`'s Unshield-combo cases; the combinations exercised end-to-end are exactly Fee+ShieldedOutputs, Fee+Unshield, Unshield+Mint (S.0, S.4), Unshield+Melt (S.2, S.3) — never Mint/Melt+ShieldedOutputs.
4. Verified hathor-core supports and specifically verifies the combination: Rule M1 satisfied by `has_shielded_outputs()` (transaction_verifier.py:672-691), MintHeader entries extending the surjection-proof domain (892-897), and M4 folding with shielded commitments present (992-1019).
5. Confirmed the wallet's auto-declare logic (`src/utils/transaction.ts:993-1076`) would emit the combination if reached (the originally cited range 985-1071 was off by a few lines; substance identical). Severity medium upheld: no live bug, but a coverage hole in consensus-critical header construction compounded by three misleading test names.
