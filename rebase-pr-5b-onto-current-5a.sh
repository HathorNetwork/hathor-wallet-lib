#!/usr/bin/env bash
#
# Rebase 5b (shielded/pr-5b-shielded-tx-utils) onto the CURRENT 5a tip
# (shielded/pr-5-storage-layer) so its PR diff shows only the 5b layer.
#
# 5b was branched from 5a's old tip (82850bc0); 5a has since gained review
# commits. Replaying 5b's single own commit onto current 5a hits exactly ONE
# conflict — the `./shielded/types` import block in src/types.ts:
#   5a (after the IHistoryShieldedOutput dedup): { IShieldedCryptoProvider, IShieldedOutput }
#   5b (adds IDataShieldedOutput, kept ShieldedOutputMode):
#       { IShieldedCryptoProvider, ShieldedOutputMode, IDataShieldedOutput }
# Resolution = the union of the symbols actually used after the merge, which
# drops ShieldedOutputMode (the dedup moved the `mode` field into the inherited
# IShieldedOutput, so it's no longer referenced in types.ts). The resolved
# whole-file is in .cascade-pr4/types-5b.resolved.
#
# PRE-VALIDATED (identical rebase, signing disabled): one types.ts conflict,
# resolved from the snapshot; rebased 5b tip is tsc clean, lint 0 errors, full
# unit suite 80 suites / 1044 tests.
#
# Determinism guard: the snapshot is valid only while 5a's types.ts is
# unchanged from validation. The script pins that blob and HALTS if 5a's
# types.ts moved (re-validate then). 5a's tip itself may advance (e.g. the
# tuliomir smoke-test commit, which doesn't touch types.ts) — the rebase
# targets the branch ref, so it lands on whatever 5a is at run time.
#
# ~1 Yubikey touch (the single replayed 5b commit).
# After this: open the 5b PR (base = shielded/pr-5-storage-layer).
set -euo pipefail
cd "$(dirname "$0")"

SNAP=.cascade-pr4/types-5b.resolved
TYPES=src/types.ts
EXPECTED_5A_TYPES_BLOB=b33b85549bfa
OLD_BASE=82850bc0
EXPECTED_5B_TIP=4e560872

[[ -f "$SNAP" ]] || { echo "ERROR: missing $SNAP" >&2; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: tracked working-tree changes present; commit/reset first." >&2; exit 1
fi

git fetch origin

# 5b must be at the validated tip.
GOT_5B=$(git rev-parse --short=8 origin/shielded/pr-5b-shielded-tx-utils)
[[ "$GOT_5B" == "$EXPECTED_5B_TIP" ]] || {
  echo "ERROR: origin 5b is $GOT_5B, expected $EXPECTED_5B_TIP (re-validate)." >&2; exit 1; }

# 5a's types.ts must match what the snapshot resolution was built against.
GOT_BLOB=$(git rev-parse --short=12 "origin/shielded/pr-5-storage-layer:$TYPES")
[[ "$GOT_BLOB" == "$EXPECTED_5A_TYPES_BLOB" ]] || {
  echo "ERROR: 5a's $TYPES changed (blob $GOT_BLOB != $EXPECTED_5A_TYPES_BLOB)." >&2
  echo "       The conflict snapshot is stale — re-run the dry-run rebase to refresh it." >&2
  exit 1; }

# Work on the local 5b branch, pinned to origin.
git checkout shielded/pr-5b-shielded-tx-utils
git reset --hard origin/shielded/pr-5b-shielded-tx-utils

echo "═══ rebase 5b --onto pr-5-storage-layer (old-base ${OLD_BASE}) ═══"
set +e
git -c rerere.enabled=false rebase --onto shielded/pr-5-storage-layer "$OLD_BASE"
rc=$?
set -e
if [[ $rc -ne 0 ]]; then
  unmerged=$(git diff --name-only --diff-filter=U)
  if [[ "$unmerged" != "$TYPES" ]]; then
    echo "ERROR: unexpected conflict (validated only for $TYPES):" >&2
    echo "$unmerged" >&2; exit 1
  fi
  echo "  resolving $TYPES from validated snapshot"
  cp "$SNAP" "$TYPES"
  git add "$TYPES"
  GIT_EDITOR=true git rebase --continue   # signs the replayed commit
fi
if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
  echo "ERROR: rebase did not finish cleanly." >&2; exit 1
fi
echo "→ $(git log -1 --oneline)"

echo "═══ validating rebased 5b (tsc · lint · unit) ═══"
npm run tsc
npm run lint
npx jest --silent --testPathIgnorePatterns '/node_modules/' '__tests__/integration/'
echo "✓ 5b validates green"

git push --force-with-lease origin shielded/pr-5b-shielded-tx-utils
echo
echo "✓ 5b rebased onto current 5a and pushed."
echo "  Open the 5b PR now: base = shielded/pr-5-storage-layer"
echo "  Description: SHIELDED_PR5_SPLIT_DESCRIPTIONS.md (section 5b)"
