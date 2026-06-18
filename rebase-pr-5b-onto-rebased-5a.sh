#!/usr/bin/env bash
#
# Re-chain 5b onto the NEW 5a tip after 5a was rebased onto master.
#
# 5b's 3 own commits (tx-utils, weight-leak fix, IShieldedOutputEntry dedup)
# currently sit on the OLD 5a tip be24e0ce. 5a was rebased onto master
# (#1078); the new 5a tip 3f55431a has identical content for 5b's files
# (#1078 only touched __tests__/integration/*), so replaying 5b's 3 commits
# onto it is conflict-free — unlike the first 5b rebase, there's no types.ts
# import conflict this time (it was already resolved when 5b was chained onto
# be24e0ce, and that 5a content is unchanged in the new tip).
#
# PRE-VALIDATED (identical rebase, signing disabled): 0 conflicts; rebased
# tip is tsc clean, lint 0 errors, full unit suite 80 suites / 1045 tests.
#
# ~3 Yubikey touches (3 replayed commits). Force-pushes 5b.
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-5b-shielded-tx-utils
BASE_BRANCH=shielded/pr-5-storage-layer
OLD_BASE=be24e0ce           # old 5a tip that 5b's own commits sit on
EXPECTED_5A=3f55431a        # new 5a tip, validated against
EXPECTED_5B=b278b03a        # 5b tip, validated against

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: tracked working-tree changes present; commit/reset first." >&2; exit 1
fi

git fetch origin

GOT_5A=$(git rev-parse --short=8 "origin/${BASE_BRANCH}")
GOT_5B=$(git rev-parse --short=8 "origin/${BRANCH}")
if [[ "$GOT_5B" != "$EXPECTED_5B" ]]; then
  echo "ERROR: origin 5b is ${GOT_5B}, expected ${EXPECTED_5B} (re-validate)." >&2; exit 1
fi
if [[ "$GOT_5A" != "$EXPECTED_5A" ]]; then
  echo "⚠ origin 5a is ${GOT_5A}, validated against ${EXPECTED_5A}." >&2
  echo "  Proceeding; the conflict-halt below catches any divergence." >&2
fi

git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

echo "═══ rebase 5b's own commits --onto ${BASE_BRANCH} (old-base ${OLD_BASE}) ═══"
if ! git rebase --onto "origin/${BASE_BRANCH}" "$OLD_BASE"; then
  echo "ERROR: unexpected conflict (validated clean). Files:" >&2
  git diff --name-only --diff-filter=U | sed 's/^/    /' >&2
  echo "  (git rebase --abort to back out)" >&2
  exit 1
fi
echo "→ $(git log -1 --oneline)"

echo "═══ validating rebased 5b (tsc · lint · unit) ═══"
npm run tsc
npm run lint
npx jest --silent --testPathIgnorePatterns '/node_modules/' '__tests__/integration/'
echo "✓ 5b validates green"

git push --force-with-lease origin "$BRANCH"
echo
echo "✓ 5b re-chained onto the rebased 5a and pushed."
echo "  (5c still sits on the old 5b tip — re-chain it next if you're reviewing it,"
echo "   or leave it for the post-5a-merge cascade.)"
