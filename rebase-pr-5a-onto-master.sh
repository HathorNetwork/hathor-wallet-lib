#!/usr/bin/env bash
#
# Update PR #1088 (5a, shielded/pr-5-storage-layer) by REBASING it onto the
# current master, instead of GitHub's "Update branch" (which would add a merge
# commit). Keeps 5a's history linear on top of master.
#
# master advanced by one commit since 5a's base: #1078 ("shared UTXO query
# tests for both facades"), which touches only __tests__/integration/* —
# zero overlap with 5a's files. Replaying 5a's 7 commits onto master is
# conflict-free.
#
# PRE-VALIDATED (identical rebase, signing disabled): 0 conflicts; rebased
# tip is tsc clean, lint 0 errors, full unit suite 79 suites / 1038 tests.
#
# ~7 Yubikey touches (7 replayed commits). Force-pushes 5a.
#
# NOTE: this moves 5a's tip, so 5b/5c fall behind 5a again — they re-chain at
# the usual post-merge cascade (or rebase them onto the new 5a if you want to
# keep reviewing them in the meantime).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-5-storage-layer
EXPECTED_MASTER=c67f526a   # validated against this master tip

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: tracked working-tree changes present; commit/reset first." >&2; exit 1
fi

git fetch origin

GOT_MASTER=$(git rev-parse --short=8 origin/master)
if [[ "$GOT_MASTER" != "$EXPECTED_MASTER" ]]; then
  echo "⚠ origin/master is ${GOT_MASTER}, validated against ${EXPECTED_MASTER}." >&2
  echo "  Proceeding — a clean replay still updates 5a, but if a newer master" >&2
  echo "  commit conflicts the script will halt below; re-run the dry-run then." >&2
fi

# 5a diverged from master here (where 5a's own commits begin).
OLD_BASE=$(git merge-base origin/master "origin/${BRANCH}")
echo "old-base (5a fork point): $(git rev-parse --short=8 "$OLD_BASE")"

git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

echo "═══ rebase 5a --onto origin/master (old-base ${OLD_BASE:0:8}) ═══"
if ! git rebase --onto origin/master "$OLD_BASE"; then
  echo "ERROR: unexpected conflict (validated clean against ${EXPECTED_MASTER})." >&2
  echo "  master likely changed. Resolve manually or abort:" >&2
  git diff --name-only --diff-filter=U | sed 's/^/    /' >&2
  echo "  (git rebase --abort to back out)" >&2
  exit 1
fi
echo "→ $(git log -1 --oneline)"

echo "═══ validating rebased 5a (tsc · lint · unit) ═══"
npm run tsc
npm run lint
npx jest --silent --testPathIgnorePatterns '/node_modules/' '__tests__/integration/'
echo "✓ 5a validates green"

git push --force-with-lease origin "$BRANCH"
echo
echo "✓ 5a rebased onto master and pushed — PR #1088 'out-of-date' clears."
echo "  Remaining merge blocker is the 2nd approval (1 pending review)."
