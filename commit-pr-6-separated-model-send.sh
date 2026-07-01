#!/usr/bin/env bash
#
# SEPARATED-model migration, layer 3/6 (6 send + sign + wallet lifecycle).
# 6 was reset onto the new 5c and its send/lifecycle layer rebuilt for the
# arithmetic model (its old 6-commit sparse-append range is replaced).
# See SHIELDED_SEPARATED_MODEL_SPEC.md (v2).
#
# This layer:
# - All send/sign/wallet findSpentOutput call sites -> resolveSpentOutput:
#   sendTransaction input build + checkUnspentInput, wallet P2SH signing +
#   getWalletInputInfo. Shielded spends read decoded data off the resolved
#   slot or the stored UTXO; stored-UTXO fallback preserved.
# - getShieldedUnblindingForTx: iterate shielded_outputs[], on-chain index
#   = outputs.length + s (no onChainIndex field).
# - onNewTx PER-SLOT merge of shielded_outputs[]: a bare WS re-delivery (array
#   present, value-less) no longer clobbers in-place decoded data — copy
#   value/token/decoded/blindingFactor/assetBlindingFactor (+spent_by) per slot.
# - needsRetry / shieldedNewlyAvailable: gate on the decoded marker
#   (value!==undefined) AND wallet ownership (isAddressMine), so a tx the wallet
#   owns no shielded output of never triggers a processHistory loop.
# - sendTransaction: preserve the loud shielded-address-in-transparent-output
#   rejection (getAddressType throws); shielded send crypto stays UTXO-keyed.
# - Template (addBalanceFromUtxo, executor) and partial_tx.validate: reject a
#   shielded slot index (>= outputs.length) with a clear "not supported" error.
# - Schema: keep transparent-only IHistoryOutput + a typed shielded_outputs
#   schema; the api/sync/lib/utxo/bigint additions applied verbatim.
#
# Validated on 6: tsc clean, lint 0 errors, full unit suite 81/1092 (+18;
# incl. onNewTx per-slot merge, needsRetry ownership gate, unblinding T+s,
# template/partial shielded rejection). stream.test.ts flake confirmed (passes
# isolated).
#
# Branch: shielded/pr-6-wallet-lifecycle (force-push: history rewritten onto new 5c)
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-6-wallet-lifecycle
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

FILES=(
  src/api/schemas/txApi.ts src/lib.ts src/models/partial_tx.ts
  src/new/sendTransaction.ts src/new/types.ts src/new/wallet.ts
  src/schemas.ts src/sync/stream.ts src/template/transaction/context.ts
  src/template/transaction/executor.ts src/utils/bigint.ts src/utils/utxo.ts
  src/wallet/types.ts
  __tests__/models/partial_tx.test.ts __tests__/models/transaction.test.ts
  __tests__/new/hathorwallet.test.ts __tests__/new/sendTransaction.test.ts
  __tests__/template/transaction/executor.test.ts __tests__/utils/transaction.test.ts
)
git add -- "${FILES[@]}"

# guard: staged set must equal exactly FILES
STAGED=$(git diff --cached --name-only | sort)
EXPECTED=$(printf '%s\n' "${FILES[@]}" | sort)
if [[ "$STAGED" != "$EXPECTED" ]]; then
  echo "ERROR: staged set != expected. Staged:" >&2; echo "$STAGED" >&2; exit 1
fi

git status --short

git commit -S -m "feat(shielded): send pipeline + wallet lifecycle — separated-output model

Rebuild the send/sign/wallet-lifecycle layer on the separated/arithmetic model
(layer 3/6). 6 was reset onto the new 5c; its old sparse-append commit range
is replaced.

- Route all send/sign/wallet spent-output lookups through resolveSpentOutput
  (sendTransaction input build + checkUnspentInput; wallet P2SH signing +
  getWalletInputInfo), reading shielded decoded data off the resolved slot or
  the stored UTXO with the stored-UTXO fallback preserved.
- getShieldedUnblindingForTx iterates shielded_outputs[], on-chain index =
  outputs.length + s.
- onNewTx does a per-slot merge of shielded_outputs[] so a bare websocket
  re-delivery (array present but value-less) no longer clobbers the in-place
  decoded fields.
- needsRetry / shieldedNewlyAvailable gate on the decoded marker
  (value!==undefined) AND wallet ownership, so a tx the wallet owns no shielded
  output of does not trigger a repeated processHistory.
- sendTransaction keeps the loud rejection of a shielded address in a
  transparent output; the shielded send crypto round-trip stays UTXO-keyed.
- Transaction templates and partial transactions reject a shielded slot index
  with a clear unsupported error.

tsc clean, lint clean, full unit suite (81 suites / 1092 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
