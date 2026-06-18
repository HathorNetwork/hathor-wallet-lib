#!/usr/bin/env bash
#
# Cascade rebase after PR #1087 (pr-4 address derivation) squash-merged to
# master as 5fd97e1c. Re-chains the whole downstream stack onto the new
# master and records the merge into the feat integration branch.
#
#   master(5fd97e1c) ─ 5a ─ 5b ─ 5c ─ 6 ─ 7 ─ 8        (rebased)
#   master(5fd97e1c) ──────────────────────────▶ feat  (-s ours merge)
#
# PRE-VALIDATED locally (identical operations, signing disabled):
#   - 5a/5b/5c replay with ZERO conflicts.
#   - pr-6 has ONE conflict (import block of __tests__/new/sendTransaction.test.ts);
#     resolved deterministically from the saved snapshot. pr-7/pr-8 clean.
#   - pr-6 also gets a follow-up commit restoring the loud rejection of a
#     shielded address placed in a transparent output (the guard pr-4 review
#     added a test for; pr-6's send-pipeline relaxation had turned it into a
#     silent rewrite to the spend-derived P2PKH, which surfaced as a wrong
#     "insufficient funds" error). Decision: keep guard, fix pr-6.
#   - Final pr-8 tip: tsc clean, lint 0 errors, 81 suites / 1071 tests pass.
#   - feat: master is 1 commit ahead (the pr-4 squash, all shielded content
#     feat already implements its own way). Merge -s ours keeps feat's tree
#     byte-for-byte (verified) and records pr-4 as merged — same pattern as
#     the post-PR3 merge already on feat. Stays green (80 suites/1054 tests).
#
# ~23 Yubikey touches total (front-loaded in the rebase phase):
#   5a 1 · 5b 1 · 5c 1 · pr-6 5 replays + 1 guard fixup · pr-7 7 · pr-8 6 · feat 1
# PIN caution: 3 wrong PIN entries lock the card; a missed touch shows as a
# signing "Timeout" and stalls the rebase. If that happens: the failing pick
# left staged changes -> `git commit -C <orig-sha>` then `git rebase --continue`.
#
# Branches are pushed only AFTER the full chain validates green.
# Run from any branch; clean tracked tree required.
set -euo pipefail
cd "$(dirname "$0")"

SNAP=.cascade-pr4/sendTransaction.test.ts.resolved
GUARD=.cascade-pr4/pr6-restore-guard.patch
TESTFILE=__tests__/new/sendTransaction.test.ts

# ---- preconditions ----------------------------------------------------------
[[ -f "$SNAP"  ]] || { echo "ERROR: missing $SNAP"  >&2; exit 1; }
[[ -f "$GUARD" ]] || { echo "ERROR: missing $GUARD" >&2; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: tracked working-tree changes present; commit/reset first." >&2; exit 1
fi

git fetch origin

# Pin the exact state this script was validated against. Any mismatch means a
# branch moved since validation -> stop rather than rebase blindly.
check () { # name expected-sha
  local got; got=$(git rev-parse --short=8 "$1")
  [[ "$got" == "$2" ]] || { echo "ERROR: $1 is $got, expected $2 (re-validate)." >&2; exit 1; }
}
check origin/master                                5fd97e1c
check shielded/pr-5-storage-layer                  e4df8ff8
check shielded/pr-5b-shielded-tx-utils             c332aa4f
check shielded/pr-5c-receive-pipeline              97c73888
check shielded/pr-6-wallet-lifecycle               3617bc61
check shielded/pr-7-integration-tests              93b50be2
check shielded/pr-8-headless-fixes-and-release     5f523281
check feat/shielded-outputs-integration            ceb67232

# ---- phase 1: rebase the stack (no push yet) --------------------------------
# rebase <branch> --onto <new-base-ref> <old-base-sha>
rebase_layer () {
  local branch="$1" onto="$2" oldbase="$3"
  echo "═══ rebase ${branch#shielded/}  --onto ${onto#shielded/}  (old-base ${oldbase}) ═══"
  git checkout "$branch"
  git rebase --onto "$onto" "$oldbase"
  echo "→ $(git log -1 --oneline)"
}

rebase_layer shielded/pr-5-storage-layer       origin/master                      ec439b72
rebase_layer shielded/pr-5b-shielded-tx-utils  shielded/pr-5-storage-layer        e4df8ff8
rebase_layer shielded/pr-5c-receive-pipeline   shielded/pr-5b-shielded-tx-utils   c332aa4f

# pr-6: old-base is the OLD pr-5 MONOLITH tip (c399f8e3), NOT pr-4's tip — the
# split replaced those 8 monolith commits with 5a/5b/5c, so we replay only
# pr-6's own 5 commits. One expected conflict on the test's import block.
echo "═══ rebase pr-6-wallet-lifecycle  --onto pr-5c  (old-base c399f8e3) ═══"
git checkout shielded/pr-6-wallet-lifecycle
set +e
git -c rerere.enabled=false rebase --onto shielded/pr-5c-receive-pipeline c399f8e3
rc=$?
set -e
if [[ $rc -ne 0 ]]; then
  unmerged=$(git diff --name-only --diff-filter=U)
  if [[ "$unmerged" != "$TESTFILE" ]]; then
    echo "ERROR: unexpected pr-6 conflict (validated only for $TESTFILE):" >&2
    echo "$unmerged" >&2; exit 1
  fi
  echo "  resolving $TESTFILE from validated snapshot"
  cp "$SNAP" "$TESTFILE"
  git add "$TESTFILE"
  GIT_EDITOR=true git rebase --continue        # signs the replayed commit
fi
if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
  echo "ERROR: pr-6 rebase did not finish cleanly." >&2; exit 1
fi
echo "→ $(git log -1 --oneline)"

# pr-6 follow-up: restore the transparent-output guard (decision: keep guard).
echo "═══ pr-6: restore loud shielded-in-transparent rejection ═══"
git apply "$GUARD"
git add src/new/sendTransaction.ts
git commit -S -m "fix(shielded): restore loud rejection of shielded address in transparent output

pr-4 review added a test asserting a shielded (71-byte) address placed in an
explicitly transparent output fails loudly with 'Shielded addresses cannot be
used directly as output script type'. pr-6's send-pipeline relaxation had
replaced that guard with a silent rewrite to the spend-derived P2PKH, so the
case instead failed later with a misleading 'insufficient amount of tokens'.

Restore the guard: the transparent-output branch resolves the type via
getAddressType, which throws for a shielded address before any utxo selection.
Paying a shielded address still goes through a shielded output definition
(shieldedMode), handled by the isShieldedOutput branch.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
echo "→ $(git log -1 --oneline)"

rebase_layer shielded/pr-7-integration-tests           shielded/pr-6-wallet-lifecycle    3617bc61
rebase_layer shielded/pr-8-headless-fixes-and-release  shielded/pr-7-integration-tests   93b50be2

# ---- phase 2: validate the rebased tip before pushing anything --------------
echo "═══ validating rebased pr-8 tip (tsc · lint · unit) ═══"
git checkout shielded/pr-8-headless-fixes-and-release
npm run tsc
npm run lint
npx jest --silent --testPathIgnorePatterns '/node_modules/' '__tests__/integration/'
echo "✓ pr-8 tip validates green"

# ---- phase 3: push the rebased stack ----------------------------------------
for b in shielded/pr-5-storage-layer shielded/pr-5b-shielded-tx-utils \
         shielded/pr-5c-receive-pipeline shielded/pr-6-wallet-lifecycle \
         shielded/pr-7-integration-tests shielded/pr-8-headless-fixes-and-release; do
  echo "push $b"
  git push --force-with-lease origin "$b"
done

# ---- phase 4: feat — record the master(pr-4) merge, keep feat's design ------
echo "═══ feat: merge origin/master (-s ours, keep feat's tree) ═══"
git checkout feat/shielded-outputs-integration
git merge -S -s ours --no-edit origin/master       # 1 signed merge commit
git push --force-with-lease origin feat/shielded-outputs-integration
echo "→ $(git log -1 --oneline)"

git checkout shielded/pr-4-address-derivation 2>/dev/null || true
echo
echo "✓ cascade complete: 5a 5b 5c 6 7 8 rebased onto master; feat merged."
echo "  Reminder: on GitHub, 5b's PR base = pr-5-storage-layer, 5c's = pr-5b-…"
echo "  (the split PRs); the rest keep their existing bases."
