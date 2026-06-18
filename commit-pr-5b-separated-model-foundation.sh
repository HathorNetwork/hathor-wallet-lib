#!/usr/bin/env bash
#
# SEPARATED-model migration, layer 1/6 (5b foundation). Replaces the
# sparse-append shielded-output model (decoded entries appended into
# tx.outputs[] with onChainIndex, resolved by an O(n) scan) with the
# arithmetic model that mirrors hathor-core: tx.outputs[] transparent-only,
# tx.shielded_outputs[] the full ordered list with decoded fields in place,
# on-chain index of shielded_outputs[s] = outputs.length + s.
# See SHIELDED_SEPARATED_MODEL_SPEC.md (v2).
#
# This layer (foundation):
# - types: IHistoryShieldedOutput gains optional owned-marker fields
#   (value/token/blindingFactor/assetBlindingFactor); decoded/spent_by kept.
#   Remove IShieldedOutputEntry; IHistoryOutput = ITransparentOutput.
# - resolveSpentOutput(parentTx, idx): arithmetic discriminated-union resolver
#   replacing findSpentOutput's scan. kind:'shielded' for EVERY slot in
#   [T,T+S) (non-owned = value undefined, still a valid resolve); undefined
#   only out of range. No onChainIndex, no commitment-match.
# - Keep the WIRE discriminator (renamed isInlineShieldedWireEntry): the
#   fullnode/WS can still inline shielded in outputs[]; normalize case-a,
#   convertFullNodeTxToHistoryTx and the WS proxy depend on it.
# - getTxBalance: add a shielded CREDIT loop over shielded_outputs[]
#   (gate on top-level value!==undefined), and REWIRE (not remove) the input
#   debit fallback through resolveSpentOutput (fixes the +8.5M under-debit).
# - getSignatureForTx / convertTransactionToHistoryTx / canUseUtxo /
#   utxoSelectAsInput: route through resolveSpentOutput, preserving the
#   stored-UTXO fallback and address-keyed ownership (not resolver kind).
# - convertFullNodeTxToHistoryTx + walletServiceStorageProxy: thread
#   shielded_outputs (base64->hex); were dropping it.
# - API-fetch bounds guard widened to include the shielded count.
# - Tests: rebuild fixtures onto shielded_outputs[] in place; add resolver
#   boundary tests (incl. a non-owned middle slot) and getTxBalance shielded
#   credit / deleted-UTXO debit tests.
#
# Validated on 5b: tsc clean, lint 0 errors, full unit suite 80/1052.
# No on-disk migration (confirmed: no persistent-store prerelease data).
#
# Branch: shielded/pr-5b-shielded-tx-utils
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-5b-shielded-tx-utils
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

git add -- src/types.ts src/shielded/types.ts src/utils/transaction.ts \
  src/storage/storage.ts src/wallet/walletServiceStorageProxy.ts \
  __tests__/utils/transaction_shielded.test.ts \
  __tests__/wallet/walletServiceStorageProxy.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/types\.ts|src/shielded/types\.ts|src/utils/transaction\.ts|src/storage/storage\.ts|src/wallet/walletServiceStorageProxy\.ts|__tests__/utils/transaction_shielded\.test\.ts|__tests__/wallet/walletServiceStorageProxy\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "refactor(shielded): separated-output model — foundation (resolveSpentOutput)

Migrate shielded outputs from the sparse-append model to the arithmetic
model that mirrors hathor-core (resolve_spent_output): tx.outputs[] is
transparent-only, tx.shielded_outputs[] is the full ordered list with decoded
data written in place for owned entries, and the on-chain index of
shielded_outputs[s] is outputs.length + s.

Foundation layer (types + shared resolver + balance + wire parse):
- IHistoryShieldedOutput gains optional owned-marker fields (value, token,
  blindingFactor, assetBlindingFactor); decoded/spent_by unchanged. Remove
  IShieldedOutputEntry; IHistoryOutput = ITransparentOutput.
- resolveSpentOutput replaces findSpentOutput: pure arithmetic discriminated
  union, kind 'shielded' for every slot in [T, T+S) regardless of decode
  state, undefined only out of range. No onChainIndex, no scan.
- Keep the wire-form discriminator (renamed isInlineShieldedWireEntry) for the
  inline-shielded delivery shape (normalize, convertFullNodeTx, WS proxy).
- getTxBalance: add a shielded credit loop (gate on top-level value!==undefined)
  and rewire the input-debit fallback through the resolver (fixes under-debit).
- Route getSignatureForTx / convertTransactionToHistoryTx / canUseUtxo /
  utxoSelectAsInput through the resolver, preserving the stored-UTXO fallback
  and address-keyed ownership; widen the API-fetch bounds guard for shielded.
- convertFullNodeTxToHistoryTx and walletServiceStorageProxy now thread
  shielded_outputs (base64->hex) instead of dropping it.

tsc clean, lint clean, full unit suite (80 suites / 1052 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
