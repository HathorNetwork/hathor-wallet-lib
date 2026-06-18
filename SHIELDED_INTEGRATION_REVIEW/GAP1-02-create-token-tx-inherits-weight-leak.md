# GAP1-02: CreateTokenTransaction inherits the same shielded-value weight leak
**Severity:** high - **Status:** confirmed by adversarial review

## Summary

`CreateTokenTransaction` extends `Transaction` and does not override `getOutputsSum`, `calculateWeight`, or `prepareToSend`, so a shielded token-creation transaction (TCT) computes its published weight from the plaintext sum of its shielded output values — the same leak documented in GAP1-01. Because the weight formula is invertible given public quantities (tx size, network constants, transparent output sum), anyone observing the on-chain weight of a shielded TCT can recover its total shielded value. The integration explicitly enabled shielded TCTs (alpha-v3/v4 lifted the restriction, with supply declared via the public MintHeader), so this privacy break applies to a transaction type the branch deliberately supports.

## Location

- src/models/create_token_transaction.ts:39 — `class CreateTokenTransaction extends Transaction`; no weight-related override anywhere in the class
- src/models/transaction.ts:378-381 — inherited `getOutputsSum()` adds plaintext shielded values
- src/models/transaction.ts:341 — inherited `calculateWeight()` consumes that sum
- src/models/transaction.ts:499-501 — inherited `prepareToSend()` publishes the weight
- src/utils/transaction.ts:867-884, 904, 951-952 — shielded headers explicitly attached to the `CreateTokenTransaction` path
- src/utils/transaction.ts:996-1072 — MintHeader auto-built for the createToken branch (`isCreateToken`, token_index=1 sentinel)
- src/models/shielded_output.ts:54 — `value` documented as "used for weight calculation. Not serialized on-chain"

## Details

### 1. The inherited leak

The base `Transaction.getOutputsSum()` deliberately folds the plaintext values of shielded outputs into the sum used for weight (src/models/transaction.ts:370-383):

```ts
getOutputsSum(): OutputValueType {
  let sumOutputs = 0n;
  for (const output of this.outputs) {
    if (output.isAuthority()) {
      continue;
    }
    sumOutputs += output.value;
  }
  // Shielded outputs also contribute to the weight calculation
  for (const shieldedOut of this.shieldedOutputs) {
    sumOutputs += shieldedOut.value;
  }
  return sumOutputs;
}
```

`calculateWeight()` then feeds it through the standard formula (src/models/transaction.ts:341-354):

```ts
let sumOutputs = Number(this.getOutputsSum());
sumOutputs = Math.max(1, sumOutputs);
const amount = sumOutputs / 10 ** DECIMAL_PLACES;
const kTerm = constants.txMinWeightK === 0 ? 4 : 4 / (1 + constants.txMinWeightK / amount);
let weight = constants.txWeightCoefficient * Math.log2(txSize) + kTerm + 4;
```

and `prepareToSend()` (src/models/transaction.ts:499-501) stamps that weight onto the tx that gets mined and broadcast. Given the public `weight`, `txSize`, and network constants, the `4 / (1 + k/amount)` term is invertible for `amount`; subtracting the public transparent output sum yields the total shielded value. The `value` field on the wallet's `ShieldedOutput` model exists *only* for this computation — src/models/shielded_output.ts:54 documents it as "The plaintext value, used for weight calculation. Not serialized on-chain" — so the published weight is the sole on-chain artifact derived from the plaintext shielded sum.

### 2. CreateTokenTransaction inherits it wholesale

`CreateTokenTransaction` (src/models/create_token_transaction.ts:39) overrides only serialization/parsing concerns: `constructor`, `serializeFundsFields`, `serializeTokenInfo`, `getTokenInfoFromBytes`, `getFundsFieldsFromBytes`, `createFromBytes`, `validateNft`, `createEmpty`. There is no `getOutputsSum`, `calculateWeight`, or `prepareToSend` override, and a repo-wide grep shows no other weight computation. A TCT carrying shielded outputs therefore inherits the leak verbatim.

### 3. The shielded TCT path is explicitly enabled, not hypothetical

The builder wires shielded data onto the TCT exactly as for a regular tx (src/utils/transaction.ts:879-884):

```ts
// Attach shielded-related headers identically to the regular tx
// branch below so a TCT funded by shielded HTR carries the
// UnshieldBalanceHeader + MintHeader the fullnode requires
// (alpha-v3 lifted the TCT-can't-be-shielded restriction).
this._attachShieldedHeaders(ctTx, txData);
```

`_attachShieldedHeaders` is typed `(tx: Transaction | CreateTokenTransaction, txData: IDataTx)` (src/utils/transaction.ts:904) and sets `tx.shieldedOutputs = shieldedModels` plus the `ShieldedOutputsHeader` (src/utils/transaction.ts:951-952) — populating exactly the array `getOutputsSum()` iterates. The MintHeader auto-attach has a dedicated createToken branch (src/utils/transaction.ts:1002, `isCreateToken = txData.version === CREATE_TOKEN_TX_VERSION`) that counts shielded outputs into the declared supply (the `for (const so of txData.shieldedOutputs ?? [])` loop) and declares mint unconditionally for the new token (token_index=1).

## Source of truth

hathor-core computes minimum weight from **transparent outputs only**:

- hathor-core:hathor/transaction/base_transaction.py:366-368 — `sum_outputs` iterates only `self.outputs` (core shielded outputs carry commitments, not values; they cannot contribute even in principle).
- hathor-core:hathor/daa.py:203 — `minimum_tx_weight` uses `tx.sum_outputs`; there is no shielded-aware override anywhere in core.
- hathor-core:hathor/verification/transaction_verifier.py:111-121 — `verify_weight` accepts any weight in `[min_tx_weight - WEIGHT_TOL, min_tx_weight + MAX_TX_WEIGHT_DIFF]`, so the wallet's inflated weight is *accepted* on-chain (the leak survives consensus rather than being rejected).

Core explicitly allows shielded TCTs and reconciles supply through the **public MintHeader**, never through weight:

- hathor-core:hathor/verification/token_creation_transaction_verifier.py:30-75 — for a shielded TCT, `token_info.amount` is unreliable; the verifier instead requires exactly one MintHeader entry with `token_index=1` and a positive amount, and the Pedersen balance equation reconciles declared supply against the shielded outputs.

So including shielded values in weight is both unnecessary for acceptance and a pure privacy regression versus the reference implementation.

## Impact

A user creates a custom token with its initial supply in shielded outputs (the alpha-v4 shielded TCT flow: ShieldedOutputsHeader + MintHeader). The wallet publishes a weight inflated by the plaintext shielded sum. Any observer of the public chain — block explorer, peer, analytics service — can invert the weight formula (weight, txSize, transparent sum, and the constants `txWeightCoefficient`/`txMinWeightK` are all public), recovering the total shielded value of the TCT. For a token whose entire raison d'être is a confidential supply distribution, this defeats the confidentiality at creation time. Note the MintHeader already publicly declares the new token's *minted* supply, but the weight additionally leaks the shielded total across *all* tokens in the tx — including any shielded HTR change — so the leak is not subsumed by the header.

Attenuating factors confirmed by the panel: resolution degrades for very large amounts (the `kTerm` saturates toward 4) and disappears entirely when the weight clamps to `txMinWeight`; and no current *high-level* wallet flow emits a shielded TCT (`prepareCreateTokenData` in src/utils/tokens.ts has no shielded code, and `createNewToken` in src/new/wallet.ts resolves shielded addresses to transparent P2PKH — see __tests__/integration/shielded_outputs/token_creation.test.ts:10-12). The leak is reachable today by any consumer hand-building `IDataTx` with `version=CREATE_TOKEN_TX_VERSION` plus `shieldedOutputs` through the public `createTransactionFromData` + `prepareToSend` path — a supported, deliberately wired path that the next wallet feature increment will sit on.

## Recommendation

This finding is derivative of GAP1-01: fix the base class once and the TCT is covered by inheritance.

1. Make `Transaction.getOutputsSum()` transparent-only (delete the shielded loop at src/models/transaction.ts:378-381), matching `hathor-core:hathor/transaction/base_transaction.py:366-368`. `CreateTokenTransaction` inherits the corrected behavior automatically — do **not** add a TCT-specific override.
2. Remove the now-unused plaintext-for-weight rationale on `ShieldedOutput.value` (src/models/shielded_output.ts:54) or re-document its remaining purpose, so the field is not reintroduced into weight later.
3. Add a shielded-TCT regression test to lock the inheritance in, e.g.: build two `CreateTokenTransaction`s identical except for the shielded output values (same serialized size), assert `calculateWeight()` returns the same value for both, and assert it equals the weight of an equivalent TCT with empty `shieldedOutputs`. This is the one deliverable independent of GAP1-01.

## Verification notes

Three independent skeptic passes confirmed the finding; all cited facts were re-derived from the worktrees:

- **Inheritance verified exhaustively**: src/models/create_token_transaction.ts defines only `constructor` / `serializeFundsFields` / `serializeTokenInfo` / `getTokenInfoFromBytes` / `getFundsFieldsFromBytes` / `createFromBytes` / `validateNft` / `createEmpty`; repo-wide grep found no other `calculateWeight`/`getOutputsSum`/`prepareToSend` definition, so the base-class leak (src/models/transaction.ts:378-381, :341, :499-501) applies unmodified.
- **Path is wired, not speculative**: src/utils/transaction.ts:883 calls `_attachShieldedHeaders(ctTx, txData)` on the TCT branch; :904 types the helper for both classes; :951-952 populate `tx.shieldedOutputs`; :996-1072 build the MintHeader with the `isCreateToken` branch. Core accepts the result (token_creation_transaction_verifier.py:30-75) and `verify_weight` tolerates the inflated weight (transaction_verifier.py:111-121), so the leaked weight lands on-chain.
- **Core comparison**: confirmed core sums transparent outputs only (base_transaction.py:366-368; daa.py:203); the wallet's behavior is a divergence from the source of truth, not a port of it.
- **Severity debate**: two reviewers rated high (same privacy break as GAP1-01 on a deliberately enabled tx type); one argued medium because no current high-level wallet flow emits a shielded TCT — the leak is reachable only via the public `createTransactionFromData` low-level path — and because the base-class fix in GAP1-01 covers it automatically. The high rating is retained since the path is part of the library's supported public API and the privacy failure mode is identical to GAP1-01; the attenuation is recorded above.
- **Caveats acknowledged**: amount recovery loses precision when `kTerm` saturates (very large sums) and is masked when weight clamps to `txMinWeight`; on the shielded testnet's low constants the amount is recoverable in practice.
