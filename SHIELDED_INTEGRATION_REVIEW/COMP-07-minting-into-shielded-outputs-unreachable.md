# COMP-07: Minting token supply directly into shielded outputs (incl. shielded TCT) is unreachable — core supports it, wallet-lib has no producer

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

hathor-core fully supports creating or minting token supply directly into shielded outputs: a Token Creation Transaction (TCT) may carry a `ShieldedOutputsHeader` and must then declare its initial supply via a `MintHeader` entry with `token_index=1`. Wallet-lib even ships the consumer-side plumbing for this (the TCT branch of `_attachShieldedHeaders` and the create-token `MintHeader` sentinel logic), but no code path ever populates `txData.shieldedOutputs` for a create-token or mint transaction. The only reachable construction is a *shielded-funded* (HTR inputs are shielded) TCT/mint that produces transparent token outputs; a shielded address passed as the mint/recipient address is silently resolved to its spend-derived transparent P2PKH. Minting privately therefore requires two transactions, doubling fees and leaking the minted amount and its initial owner on-chain.

## Location

- src/utils/tokens.ts — `prepareCreateTokenData` / `prepareMintTxData`: build only transparent outputs; `grep -i shielded` over the file returns zero hits (no shielded option, no `shieldedOutputs` assignment).
- src/new/types.ts:411-427 (`CreateTokenOptions`) and src/new/types.ts:157-169 (`MintTokensOptions`): no shielded field of any kind.
- src/new/wallet.ts:2243-2316 (`prepareCreateNewToken`): forwards only transparent options to `tokenUtils.prepareCreateTokenData`.
- src/new/wallet.ts:2325-2332 (`createNewTokenSendTransaction`): token flows enter `SendTransaction` via the `{ wallet, transaction }` constructor, bypassing `prepareTxData` — the only producer of `shieldedOutputs`.
- src/new/sendTransaction.ts:495-524 and 615: the sole assignment of `txData.shieldedOutputs` in the codebase, and it never builds `CREATE_TOKEN_TX_VERSION` transactions.
- src/utils/transaction.ts:879-884 and 993-1078: dead-for-token-flows consumer plumbing (TCT `_attachShieldedHeaders` branch; `NEW_TOKEN_KEY` sentinel `MintHeader` logic).
- __tests__/integration/shielded_outputs/token_creation.test.ts:7-15: pins the transparent-downgrade behavior as intended.

## Details

### Consumer plumbing exists…

`_attachShieldedHeaders` explicitly handles the TCT case (src/utils/transaction.ts:879-884):

```ts
      // Attach shielded-related headers identically to the regular tx
      // branch below so a TCT funded by shielded HTR carries the
      // UnshieldBalanceHeader + MintHeader the fullnode requires
      // (alpha-v3 lifted the TCT-can't-be-shielded restriction).
      this._attachShieldedHeaders(ctTx, txData);
```

And the `MintHeader`/`MeltHeader` derivation inside `_attachShieldedHeaders` (src/utils/transaction.ts:993-1078) contains a `NEW_TOKEN_KEY = '__create_token__'` sentinel specifically for the create-token case, including a loop that would count shielded outputs of the new token toward the mint delta:

```ts
      const isShieldedTx =
        (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) ||
        !!txData.excessBlindingFactor;
      ...
      const NEW_TOKEN_KEY = '__create_token__';
      const isCreateToken = txData.version === CREATE_TOKEN_TX_VERSION;
      const tokensArray: string[] = isCreateToken ? [NEW_TOKEN_KEY] : txData.tokens ?? [];
      ...
      for (const so of txData.shieldedOutputs ?? []) {
        if (so.value <= 0n) continue;
        bumpDelta(so.token, so.value);
      }
```

### …but has no producer

The only place in the entire source tree that assigns `txData.shieldedOutputs` for an outgoing transaction is `SendTransaction.prepareTxData` (src/new/sendTransaction.ts:495-524 builds the array via `createShieldedOutputs`; line 615 attaches it):

```ts
      ...(shieldedOutputs.length > 0 ? { shieldedOutputs } : {}),
```

Token flows never reach this code. `prepareCreateNewToken` (src/new/wallet.ts:2243) calls `tokenUtils.prepareCreateTokenData` — which has zero shielded references — and then `transactionUtils.prepareTransaction`; `createNewTokenSendTransaction` (src/new/wallet.ts:2325-2332) wraps the already-built transaction in `new SendTransaction({ wallet: this, transaction })`, so `prepareTxData` is bypassed. The same holds for the mint flow (`prepareMintTokensData` → `prepareMintTxData`) and for the template interpreter and wallet-service wallet (no shielded references in src/template/ or src/wallet/wallet.ts).

Consequently the `for (const so of txData.shieldedOutputs ?? [])` loop in the sentinel logic and `bumpDelta(so.token, ...)` (src/utils/transaction.ts:1036-1039) can never execute with `token === NEW_TOKEN_KEY` for a shielded TCT output: the path was scaffolded but never wired.

### What IS reachable: shielded-funded token txs and silent downgrade

The supported construction is the inverse direction only — a TCT/mint *funded by* shielded HTR inputs. `prepareTransaction` detects shielded inputs with no shielded outputs and attaches an `UnshieldBalanceHeader` (src/utils/transaction.ts:1338-1424; the comment at 1338-1341 explicitly names `createNewToken`/`prepareCreateNewToken` as the targeted path).

If a user passes a *shielded address* as the mint/recipient/change address, it is not rejected and not honored as shielded — it is resolved to the corresponding spend-derived transparent P2PKH. The integration suite pins this as intended (\_\_tests\_\_/integration/shielded_outputs/token_creation.test.ts:7-15):

```
 * Group K — Token creation/mint/melt with shielded addresses.
 *
 * Token transactions themselves are transparent (the token UTXOs are P2PKH),
 * but the wallet must accept a shielded address wherever an output address
 * is expected — mint address, mint/melt authority, change address. The lib
 * resolves the shielded recipient to the corresponding spend-derived P2PKH
 * so the output script is a valid P2PKH, ...
```

## Source of truth

hathor-core explicitly supports minting directly into shielded outputs:

- hathor-core:hathor/verification/token_creation_transaction_verifier.py:30-72 — `verify_minted_tokens` has a dedicated shielded-TCT branch: when `tx.is_shielded()`, the TCT must carry a `MintHeader` with exactly one entry for the new token (`token_index=1`, positive amount); the supply is hidden in shielded outputs and reconciled via the balance equation. This is a fully specified, supported construction (RFC 0000-shielded-outputs-mint-melt §4.4).
- hathor-core:hathor/verification/transaction_verifier.py:892-897 — `MintHeader` entries extend the surjection-proof domain "so a FullShieldedOutput can claim a freshly-minted asset", i.e. regular mint transactions can also direct new supply straight into FullShielded outputs.
- hathor-core:hathor/verification/vertex_verifier.py:247-260 — `TOKEN_CREATION_TRANSACTION` allows all four shielded headers (`ShieldedOutputsHeader`, `UnshieldBalanceHeader`, `MintHeader`, `MeltHeader`) when shielded transactions are active.

## Impact

- **Feature gap vs. core:** any user wanting privately-held new supply (token creator, or holder of a mint authority) cannot do it in one transaction through wallet-lib, even though the network accepts it. The workaround is mint-transparent-then-shield: two transactions, double the shielded-output fees, and the minted amount plus its initial owner's transparent address are leaked on-chain — exactly the data the feature exists to hide.
- **Silent privacy downgrade:** a caller who passes a shielded address as the mint/recipient address plausibly believes the minted tokens will be shielded. Instead the wallet quietly produces a transparent P2PKH output to the spend-derived address. No error, no warning; the user discovers the downgrade only by inspecting the resulting transaction.
- **Dead code risk:** the unproducible TCT branches in `_attachShieldedHeaders` (src/utils/transaction.ts:879-884, 1036-1039) are untestable end-to-end today and may silently rot until someone wires a producer.

Severity is medium rather than high because the downgrade behavior is deliberate and documented in the integration suite, no funds are at risk, and the shielded-funded direction works; but the gap is real, user-visible, and privacy-relevant.

## Recommendation

Add an explicit opt-in (per the project convention of named options over inference — do not infer from the address type):

1. Extend `CreateTokenOptions` / `MintTokensOptions` (src/new/types.ts) with e.g. `shieldedMintOutputs?: Array<{ address: string; value: OutputValueType }>` (or a `shieldedMode` flag plus addresses).
2. In `prepareCreateTokenData` / `prepareMintTxData` (src/utils/tokens.ts), when the option is set: skip the transparent minted output, account for the per-shielded-output fee, and carry the shielded output definitions on txData.
3. Route those definitions through `createShieldedOutputs` (the builder already used at src/new/sendTransaction.ts:517) so `txData.shieldedOutputs` is populated — at which point the existing `_attachShieldedHeaders` TCT branch and `NEW_TOKEN_KEY` sentinel (src/utils/transaction.ts:879-884, 993-1078) emit the required `ShieldedOutputsHeader` + `MintHeader(token_index=1)` with no further changes. Enforce the existing >= 2 shielded outputs rule and `MAX_SHIELDED_OUTPUTS` cap, mirroring sendTransaction.ts:505-515.
4. Until implemented, document prominently (JSDoc on `prepareCreateNewToken` / `mintTokens` and the shielded integration docs) that shielded addresses in token flows produce transparent spend-derived P2PKH outputs — or consider warning/rejecting when a shielded address is passed as the mint recipient, so the downgrade is at least not silent.

## Verification notes

The skeptic panel confirmed the finding on three axes:

1. **Core support is real:** token_creation_transaction_verifier.py:30-72 (shielded TCT requires `MintHeader` entry `token_index=1`), transaction_verifier.py:892-897 (mint entries extend the surjection domain), vertex_verifier.py:247-260 (TCT permits all four shielded headers).
2. **No producer exists in wallet-lib:** `grep -i shielded src/utils/tokens.ts` returns zero hits; `CreateTokenOptions`/`MintTokensOptions` expose no shielded field; the only assignment of outgoing `txData.shieldedOutputs` is src/new/sendTransaction.ts:615 (built at 495-524), and `SendTransaction` never builds `CREATE_TOKEN_TX_VERSION` — token flows enter via `new SendTransaction({ wallet, transaction })` (src/new/wallet.ts:2331-2332), bypassing `prepareTxData`. No shielded references in src/template/ or src/wallet/wallet.ts either.
3. **The downgrade is pinned as intended:** __tests__/integration/shielded_outputs/token_creation.test.ts:7-15 documents shielded recipients resolving to spend-derived P2PKH; test K.1 asserts the minted tokens land transparently. The only reachable shielded interaction with token flows is the shielded-FUNDED path (UnshieldBalanceHeader detection in `prepareTransaction`, src/utils/transaction.ts:1338-1424, whose comment explicitly names `createNewToken`).

Corroborating detail: the sentinel logic's `bumpDelta(so.token, ...)` over `txData.shieldedOutputs` (src/utils/transaction.ts:1036-1039) can never receive a create-token shielded output today, confirming the TCT-shielded path was scaffolded but never wired to a producer.
