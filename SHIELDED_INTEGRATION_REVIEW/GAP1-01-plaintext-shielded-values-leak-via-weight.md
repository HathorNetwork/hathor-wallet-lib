# GAP1-01: Plaintext shielded output values enter tx weight, leaking exact total shielded amount on-chain

**Severity:** critical - **Status:** confirmed by adversarial review

## Summary

`Transaction.getOutputsSum()` adds the plaintext value of every shielded output into the sum that `calculateWeight()` uses as the `amount` term of the minimum-weight formula. The resulting weight is serialized on-chain as an 8-byte float, and because the formula, the tx size, and the network constants are all public, any observer can invert the formula and recover the exact total shielded value of every transaction wallet-lib builds. hathor-core computes minimum weight from transparent outputs only, so this divergence is both a confidentiality break and unnecessary for node acceptance. This defeats the core promise of confidential transactions at per-tx-total granularity.

## Location

- `src/models/transaction.ts:378-381` — `getOutputsSum()` folds plaintext shielded values into the output sum
- `src/models/transaction.ts:329-361` — `calculateWeight()` consumes that sum as the `amount` term
- `src/models/transaction.ts:259-260` — weight serialized as 8-byte float in the public graph struct
- `src/models/transaction.ts:494-501` — `prepareToSend()` bakes the leaked weight into every outgoing tx
- `src/models/shielded_output.ts:54-55` — model documents `value` as "used for weight calculation"
- `src/utils/transaction.ts:938-951` — `_attachShieldedHeaders` populates `tx.shieldedOutputs` with real plaintext values (`so.value`) on every send
- Send paths reaching `prepareToSend` → `calculateWeight`: `src/utils/transaction.ts:1428`, `src/new/sendTransaction.ts:681,738`, `src/wallet/wallet.ts:2031,2347,2551,2712,2793,3242`, `src/wallet/partialTxProposal.ts:422`

## Details

On the `feat/shielded-outputs-integration` branch, `getOutputsSum()` was changed (new in `git diff master...HEAD`) to include shielded values:

```ts
// src/models/transaction.ts:370-383
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

The only `src/` consumer of `getOutputsSum()` is `calculateWeight()`:

```ts
// src/models/transaction.ts:341-357 (abridged)
let sumOutputs = Number(this.getOutputsSum());
sumOutputs = Math.max(1, sumOutputs);
const amount = sumOutputs / 10 ** DECIMAL_PLACES;
const kTerm = constants.txMinWeightK === 0 ? 4 : 4 / (1 + constants.txMinWeightK / amount);
let weight = constants.txWeightCoefficient * Math.log2(txSize) + kTerm + 4;
weight = Math.max(weight, constants.txMinWeight);
```

`prepareToSend()` (transaction.ts:499-501) assigns this to `this.weight`, and `serializeGraphFields` publishes it at full float64 precision on the wire:

```ts
// src/models/transaction.ts:260
array.push(floatToBytes(this.weight, 8));
```

The plaintext values are real on every send: `_attachShieldedHeaders` constructs the `ShieldedOutput` models with `so.value` (src/utils/transaction.ts:945) and sets `tx.shieldedOutputs` (src/utils/transaction.ts:950-951) before `prepareToSend` runs. `src/models/shielded_output.ts:54-55` even documents the field as "The plaintext value, used for weight calculation. Not serialized on-chain." — the value is not serialized directly, but it leaks through the weight.

Why the leak is fully recoverable by an observer:

1. The tx struct (hence `txSize`) is public on the wire.
2. The constants (`txMinWeight = 14`, `txWeightCoefficient = 1.6`, `txMinWeightK = 100`, `src/constants.ts:229-233`) are public network settings; the node even publishes `min_tx_weight_k` via its version resource.
3. The `kTerm = 4 / (1 + k/amount)` is strictly monotonic in `amount`, so `weight` uniquely determines `amount`; the observer computes `kTerm = weight - coeff*log2(size) - 4`, solves for `amount`, and subtracts the visible transparent output sum to get the exact total shielded value. Float64 precision allows sub-cent recovery for realistic totals (exact up to roughly 2e7 HTR; precision degrades only as the kTerm saturates near 4 for very large totals).
4. The `Math.max(weight, txMinWeight)` clamp never masks the kTerm: a minimal 2-output amount-shielded tx carries two ~3.3 KB range-proof-bearing outputs (~6.9 KB total), so `1.6 * log2(6900) ≈ 20.4 > 14` — the clamp is never active for shielded txs.

## Source of truth

hathor-core computes minimum tx weight from **transparent outputs only**:

- hathor-core:hathor/daa.py:203 — `amount = max(1, tx.sum_outputs) / (10 ** self._settings.DECIMAL_PLACES)` inside `minimum_tx_weight`.
- hathor-core:hathor/transaction/base_transaction.py:366-368 — `sum_outputs` is `sum(output.value for output in self.outputs if not output.is_token_authority())`; shielded outputs live in the separate `self.shielded_outputs` property and never enter `sum_outputs`. (Same on the hathorlib side: hathorlib/daa.py and hathorlib/base_transaction.py.)
- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:80-100 — the wire format serializes only `mode | commitment | range_proof | script | [asset_commitment | surjection_proof]`; the value is hidden in both shielded modes and is recoverable only via range-proof rewind. The whole point of the feature is that values are not derivable from public data.
- Constants match on both sides: hathor-core:hathorlib/hathorlib/conf/settings.py:88-94 (`MIN_TX_WEIGHT = 14`, `MIN_TX_WEIGHT_COEFFICIENT = 1.6`, `MIN_TX_WEIGHT_K = 100`) vs `src/constants.ts:229-233`.
- Node acceptance bound: hathor-core:hathor/verification/transaction_verifier.py:111-121 — `verify_weight` accepts weight in `[min - WEIGHT_TOL, min + MAX_TX_WEIGHT_DIFF]` (MAX_TX_WEIGHT_DIFF = 4.0, and the upper bound only activates when `min > MAX_TX_WEIGHT_DIFF_ACTIVATION = 32`). Since the wallet's extra kTerm contribution is strictly less than 4, the inflated weight always passes — which is why this bug is completely silent.
- Neither the RFC summary nor the client integration guide contains any instruction to include shielded values in weight; core neither requires nor sanctions it.

## Impact

Every shielded transaction built by wallet-lib (mobile wallet, desktop wallet, headless — all clients of this library) permanently publishes its weight on-chain. Any passive observer — no special access, just reading the public DAG — can invert the monotonic weight formula using the public tx size and network constants, subtract the visible transparent output sum, and recover the **exact total shielded amount** of the transaction, typically to the cent. This defeats amount confidentiality, the central promise of the confidential-transactions feature, at tx-total granularity (individual output split remains hidden, but the total is what most users care about hiding). The leak is retroactive and irreversible: once a tx is mined, its weight is permanent, so every shielded tx sent before a fix is forever de-anonymized in amount. The bug is silent because the node happily accepts the over-weighted tx (overshoot < MAX_TX_WEIGHT_DIFF), and no test would catch it — there are zero `weight` assertions across the 23 suites in `__tests__/integration/shielded_outputs/`, and unit weight tests only cover transparent txs (`__tests__/models/transaction.test.ts:118,377`). One partial mitigation exists today: shielded test networks set `MIN_TX_WEIGHT_K: 0`, and the wallet's k=0 branch (transaction.ts:350-352) makes the kTerm constant — but that only holds if the network version data is loaded; the hardcoded fallback is k=100, and mainnet inherits the default k=100, so production is fully exposed.

## Recommendation

Mirror hathor-core exactly: exclude shielded output values from the weight `amount` term. Concretely, drop the shielded loop from `getOutputsSum()`:

```ts
getOutputsSum(): OutputValueType {
  let sumOutputs = 0n;
  for (const output of this.outputs) {
    if (output.isAuthority()) {
      continue;
    }
    sumOutputs += output.value;
  }
  return sumOutputs;
}
```

The existing `Math.max(1, sumOutputs)` floor in `calculateWeight()` already handles the no-transparent-outputs case (e.g. fully-shielded txs), matching core's `max(1, tx.sum_outputs)`. This fix cannot break node acceptance: the wallet's current weight only ever *overshoots* the node's transparent-only minimum (by the kTerm delta < 4), so computing the same minimum the node computes is by construction valid. If the plaintext `value` field on `ShieldedOutput` then has no remaining serialization-adjacent purpose, update its doc comment (it is still used for balance bookkeeping at `src/utils/transaction.ts:1036-1037`) so nobody reintroduces it into weight.

Add a regression test asserting that two shielded txs with identical structure (same sizes, same transparent outputs) but different hidden amounts produce **identical** weight.

## Verification notes

Three independent skeptic passes confirmed the finding:

1. **Leak path verified end-to-end**: the shielded loop in `getOutputsSum()` (transaction.ts:378-381) is new on the branch (`git diff master...HEAD`); its sole src consumer is `calculateWeight()`; `prepareToSend()` bakes the result into `this.weight`; weight is serialized publicly as a float64 (transaction.ts:260). Real plaintext values flow in on every send via `_attachShieldedHeaders` (utils/transaction.ts:945,950-951) before `prepareToSend` (sendTransaction.ts:681,738).
2. **Core contradiction verified**: `minimum_tx_weight` uses `tx.sum_outputs` (daa.py:203), which sums only `self.outputs` (base_transaction.py:366-368); shielded outputs are a separate property and no shielded-aware weight logic exists anywhere in core or in the RFC/client-guide reference docs. The shielded wire format carries no plaintext value, so the value is genuinely hidden in both modes — confirming the weight is the only leak channel.
3. **Invertibility and silence verified**: constants identical on both sides (14/1.6/100); the min-weight clamp is inactive for KB-scale range-proof txs (1.6·log2(6900) ≈ 20.4 > 14); the node accepts the inflated weight because the overshoot is < MAX_TX_WEIGHT_DIFF = 4 (transaction_verifier.py:111-121); the formula is monotonic in amount with full double precision, making recovery exact-to-the-cent for realistic totals. Caveats examined and rejected as mitigations: kTerm saturation only blurs extremely large totals, and the k=0 escape hatch applies only to test networks with loaded version data — the hardcoded fallback and mainnet defaults use k=100.

Severity **critical** stands: silent, permanent, exact on-chain disclosure of each shielded tx's total amount, defeating the feature's core confidentiality promise; the fix is trivial and provably node-compatible.
