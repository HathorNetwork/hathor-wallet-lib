#!/usr/bin/env bash
#
# SEPARATED-model migration, layer 2/6 (5c receive pipeline). 5c was reset
# onto the new 5b foundation and its receive pipeline rebuilt for the
# arithmetic model (its old sparse-append commit a756049e is replaced).
# See SHIELDED_SEPARATED_MODEL_SPEC.md (v2).
#
# This layer:
# - processing.ts: decode owned shielded outputs and write the decoded fields
#   (value/token/decoded.address/blindingFactor/assetBlindingFactor) IN PLACE
#   onto tx.shielded_outputs[s] (s = absoluteIndex - tx.outputs.length); keep
#   the value<=0n skip so undecoded slots stay "not owned". No append to
#   outputs[], no onChainIndex stamp.
# - utils/storage.ts: a shared creditOutput(output, onChainIndex) helper with
#   the FULL per-output body (balance, addressMeta/tokenMeta, lock, authority,
#   txTokens/txAddresses, per-chain max-index advance incl. shieldedMaxIndexUsed,
#   saveUtxo gated on spent_by===null with shielded:true/blindingFactor,
#   saveLockedUtxo, spent->utxoSelectAsInput(false)). processNewTx/
#   processSingleTx run it over the transparent loop (i) AND a new owned-shielded
#   loop over shielded_outputs[] (value!==undefined, T+s). processMetadataChanged
#   gains the parallel shielded loop (preserve shielded UTXOs on confirmation).
#   Decryption idempotence keys off shielded_outputs.some(value!==undefined).
#   loadAddresses derives the shielded+spend pair per index (per-chain gap).
#   processUtxoUnlock resolves via resolveSpentOutput (shielded UTXOs at T+s).
# - storage.ts/types.ts: pinCode plumbing for scan-key derivation.
#
# Validated on 5c: tsc clean, lint 0 errors, full unit suite 81/1074
# (+22 new: shielded credit + numTransactions/maxIndex advance,
# processMetadataChanged preservation, FullShielded token cross-check reject).
#
# Branch: shielded/pr-5c-receive-pipeline (force-push: history rewritten onto new 5b)
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-5c-receive-pipeline
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

git add -- src/shielded/processing.ts src/shielded/index.ts src/utils/storage.ts \
  src/storage/storage.ts src/types.ts \
  __tests__/shielded/processing.test.ts __tests__/utils/storage.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/shielded/processing\.ts|src/shielded/index\.ts|src/utils/storage\.ts|src/storage/storage\.ts|src/types\.ts|__tests__/shielded/processing\.test\.ts|__tests__/utils/storage\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "feat(shielded): receive pipeline — separated-output model

Rebuild the shielded receive pipeline on the separated/arithmetic model
(layer 2/6). 5c was reset onto the new 5b foundation; its old sparse-append
commit is replaced.

- processing.ts: decode wallet-owned shielded outputs and write the decoded
  fields (value/token/decoded.address/blindingFactor/assetBlindingFactor) in
  place onto tx.shielded_outputs[s], s = absoluteIndex - tx.outputs.length.
  FullShielded recovers the token UID and cross-checks it against the on-chain
  asset commitment (mismatch rejected). Undecoded/non-owned slots keep value
  undefined. No append into tx.outputs[], no onChainIndex.
- utils/storage.ts: a shared creditOutput(output, onChainIndex) helper carries
  the full per-output body (balance, address/token meta, lock, authority,
  txTokens/txAddresses, per-chain max-index incl. shieldedMaxIndexUsed,
  saveUtxo gated on spent_by===null, saveLockedUtxo, spent cleanup).
  processNewTx/processSingleTx run it over the transparent outputs and a new
  owned-shielded loop over shielded_outputs[] (value!==undefined, index T+s).
  processMetadataChanged gains the parallel shielded loop so confirmed shielded
  UTXOs keep shielded:true/blindingFactor across metadata events. Decryption
  idempotence keys off shielded_outputs.some(value!==undefined). loadAddresses
  derives the shielded + spend-P2PKH pair per index (per-chain gap limit).
  processUtxoUnlock resolves shielded UTXOs (index T+s) via resolveSpentOutput.
- storage.ts/types.ts: thread the optional pinCode scan-key derivation needs.

tsc clean, lint clean, full unit suite (81 suites / 1074 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
