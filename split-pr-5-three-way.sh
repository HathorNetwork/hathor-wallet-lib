#!/usr/bin/env bash
#
# Split shielded/pr-5-storage-layer into three stacked PRs, built from the
# pre-validated layer branches (validate/pr-5a, validate/pr-5b,
# validate/pr-5c). Each layer was gated standalone:
#
#   5a  data model + storage layer        tsc/lint clean, 79 suites/1031 tests
#   5b  shielded-aware transaction utils  tsc/lint clean, 80 suites/1037 tests
#   5c  receive pipeline                  tsc/lint clean, 81 suites/1052 tests
#
# Tree-equality guarantee: 5c's final tree is byte-identical to the validated
# pr-5 rebase (6a8159ec+deshadow) plus ONE new file,
# __tests__/utils/transaction_shielded.test.ts (direct coverage for 5b's
# helpers, added for codecov/patch).
#
# Branch/PR mapping:
#   shielded/pr-5-storage-layer      -> becomes 5a (REUSES PR #1088; retitle)
#   shielded/pr-5b-shielded-tx-utils -> NEW PR, base = pr-5-storage-layer
#   shielded/pr-5c-receive-pipeline  -> NEW PR, base = pr-5b-shielded-tx-utils
#
# 3 Yubikey touches (one signed commit per layer).
# PR descriptions ready in SHIELDED_PR5_SPLIT_DESCRIPTIONS.md.
# NOTE: pr-6 must later rebase onto pr-5c (not pr-5) — usual cascade.
set -euo pipefail

cd "$(dirname "$0")"

START_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

for v in validate/pr-5a validate/pr-5b validate/pr-5c; do
  git rev-parse --verify -q "$v" >/dev/null || { echo "ERROR: missing $v" >&2; exit 1; }
done
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree has tracked changes; commit or reset first." >&2
  exit 1
fi

git fetch origin

make_layer() {
  local branch="$1" base="$2" source="$3" msg_file="$4"
  echo "═══ Building ${branch} from ${base} ═══"
  git checkout -B "${branch}" "${base}"
  # Stage the validated cumulative tree for this layer.
  git checkout "${source}" -- src __tests__
  git add -A -- src __tests__
  git commit -S -F "${msg_file}"
  echo "→ tip: $(git log -1 --oneline)"
}

# --- 5a: reuses the existing branch/PR (#1088) -------------------------------
cat > /tmp/msg_5a.txt << 'EOF'
feat(shielded): data model + storage layer for shielded addresses

First of three PRs split from the original storage-layer PR for
reviewability. This layer answers "where shielded data lives":

- types.ts (additive only): IHistoryShieldedOutput + IHistoryTx
  .shielded_outputs/.headers, IAddressChainOptions, IUtxo shielded fields
  (blindingFactor/assetBlindingFactor), IWalletData per-chain shielded
  address indices, IUtxoFilterOptions.shielded, IStore/IStorage surface
  (getAddressAtIndex/getCurrentAddress/index getters with chain opts,
  getUtxo, getScanXPrivKey/getSpendXPrivKey/getScanXPubKey/getSpendXPubKey,
  shieldedCryptoProvider).
- storage/storage.ts: shielded key getters, crypto-provider field/setter,
  chain-aware address methods.
- storage/memory_store.ts: shieldedAddressIndexes map, saveAddress routing
  by addressType, per-chain gap/current-index tracking.
- utils/address.ts: deriveShieldedAddressFromStorage (returns the 71-byte
  shielded address + its on-chain spend-P2PKH pair).
- wallet/wallet.ts: balance loop guards for inputs without transparent
  fields.

The breaking history-shape changes (IHistoryOutput union, IHistoryInput
optionality) are NOT here — they land with their consumers in the next
layer. tsc/lint clean; full unit suite passes (79 suites / 1031 tests).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
make_layer shielded/pr-5-storage-layer origin/shielded/pr-4-address-derivation validate/pr-5a /tmp/msg_5a.txt
git push --force-with-lease origin shielded/pr-5-storage-layer

# --- 5b: new branch ----------------------------------------------------------
cat > /tmp/msg_5b.txt << 'EOF'
feat(shielded): shielded-aware transaction utils + history data model

Second of three PRs split from the original storage-layer PR. This layer
changes the history data shape and adapts every consumer in the same diff:

- types.ts: IHistoryOutput becomes ITransparentOutput |
  IShieldedOutputEntry (discriminated on type==='shielded');
  IHistoryInput transparent fields become optional (shielded inputs carry
  no value/token — hidden in commitments); IDataTx gains
  shieldedOutputs/excessBlindingFactor.
- utils/transaction.ts: isShieldedOutputEntry guard,
  normalizeShieldedOutputs (extracts wire shielded entries from outputs[]
  to shielded_outputs[], base64->hex), findSpentOutput (sparse-decode-safe
  parent lookup by onChainIndex), shielded debits in per-tx balance,
  prepareTransaction/_attachShieldedHeaders (ShieldedOutputs/Unshield
  headers from IDataTx), spend-key signing.
- models/transaction.ts: shielded output count in serialization limits.
- storage/storage.ts: addTx normalizes wire shielded entries;
  utxoSelectAsInput resolves outputs via findSpentOutput.
- utils/storage.ts: minimal type-level guard skipping inputs without
  transparent fields (their balance handling lands with the pipeline).
- wallet/walletServiceStorageProxy.ts: pass shielded entries through
  untouched in output mapping.
- NEW __tests__/utils/transaction_shielded.test.ts: direct coverage for
  the guard, findSpentOutput (incl. the sparse-decode case), and
  normalizeShieldedOutputs.

tsc/lint clean; full unit suite passes (80 suites / 1037 tests).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
make_layer shielded/pr-5b-shielded-tx-utils shielded/pr-5-storage-layer validate/pr-5b /tmp/msg_5b.txt
git push --force-with-lease origin shielded/pr-5b-shielded-tx-utils

# --- 5c: new branch ----------------------------------------------------------
cat > /tmp/msg_5c.txt << 'EOF'
feat(shielded): receive pipeline — detect, decrypt and store shielded outputs

Third of three PRs split from the original storage-layer PR. The pipeline:

- shielded/processing.ts: processShieldedOutputs — per-output scan-key
  derivation, rewind (AmountShielded via token_data; FullShielded with
  recovered token UID cross-checked against the on-chain asset commitment),
  appends decoded entries to tx.outputs[] with onChainIndex.
- utils/storage.ts: loadAddresses derives the shielded+spend address pair
  per index; per-chain gap-limit tracking (checkGapLimit/checkIndexLimit);
  processHistory/processSingleTx invoke the decrypt pipeline when a crypto
  provider is set and create shielded UTXOs carrying their blinding
  factors; sender-local input resolution reads the parent's spent output
  entry.
- storage/storage.ts + types.ts: processHistory/processNewTx accept the
  optional pinCode that scan-key derivation needs (HistorySyncFunction
  ditto).
- shielded/index.ts: export processShieldedOutputs.
- Tests: processing.test.ts (rewind paths, token cross-check failure,
  provider-error handling) and utils/storage.test.ts pipeline cases.

tsc/lint clean; full unit suite passes (81 suites / 1052 tests). The tree
after this PR is byte-identical to the pre-split validated pr-5 rebase
plus the new 5b test file.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
make_layer shielded/pr-5c-receive-pipeline shielded/pr-5b-shielded-tx-utils validate/pr-5c /tmp/msg_5c.txt
git push origin shielded/pr-5c-receive-pipeline

git checkout "${START_BRANCH}"
echo
echo "✓ Three branches pushed:"
echo "    shielded/pr-5-storage-layer      (PR #1088 — retitle to 'data model + storage layer')"
echo "    shielded/pr-5b-shielded-tx-utils (open NEW PR, base = pr-5-storage-layer)"
echo "    shielded/pr-5c-receive-pipeline  (open NEW PR, base = pr-5b-shielded-tx-utils)"
echo "  Descriptions: SHIELDED_PR5_SPLIT_DESCRIPTIONS.md"
echo "  Reminder: pr-6 must later rebase onto pr-5c."
