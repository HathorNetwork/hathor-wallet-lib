#!/usr/bin/env bash
#
# Rebase shielded/pr-5-storage-layer onto the UPDATED pr-4 tip (ec439b72,
# which gained 5 review commits since the post-PR3 stack rebase), so PR 5
# review starts from current code. PR 4 is not merged yet — this is a
# stack-maintenance rebase; pr-6/7/8 stay where they are and re-chain later
# as usual.
#
# PRE-VALIDATED locally (identical rebase, signing disabled):
#   - All 8 pr-5 commits replay with ZERO conflicts onto ec439b72.
#   - tsc clean, full unit suite 80 suites / 1046 tests pass.
#   - ONE semantic collision found and fixed: pr-4's review tests added a
#     top-level `HDPrivateKey` import to __tests__/utils/address.test.ts,
#     and a pr-5 test re-imports it locally -> @typescript-eslint/no-shadow
#     warning. The one-hunk fix (pr5-deshadow.patch) removes the local
#     re-import; applied here as a dedicated commit.
#
# OLD_BASE: 0d16dcb3 (pr-4's pre-review tip, where pr-5 was chained).
# ~9 Yubikey touches (8 replayed commits + 1 fixup commit).
#
# Branch: any (script switches itself); pushes pr-5 with --force-with-lease.
set -euo pipefail

cd "$(dirname "$0")"

START_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PATCH=pr5-deshadow.patch
[[ -f "$PATCH" ]] || { echo "ERROR: missing $PATCH" >&2; exit 1; }

git fetch origin

# Sanity: pr-4 tip should be the validated one (warn-only; a newer pr-4 tip
# just means re-validate before trusting the zero-conflict guarantee).
PR4_TIP=$(git rev-parse --short origin/shielded/pr-4-address-derivation)
if [[ "$PR4_TIP" != "ec439b72" ]]; then
  echo "⚠ origin pr-4 tip is ${PR4_TIP}, validation was against ec439b72."
  echo "  Continuing, but conflicts are possible if pr-4 changed again."
fi

echo "═══ Rebasing pr-5-storage-layer (--onto origin/pr-4 0d16dcb3) ═══"
git checkout shielded/pr-5-storage-layer
git reset --hard origin/shielded/pr-5-storage-layer
if ! git rebase --onto origin/shielded/pr-4-address-derivation 0d16dcb3; then
  echo "⚠ Unexpected conflict (pre-validated clean). Resolve, git rebase"
  echo "  --continue, then re-run from the patch step manually."
  exit 1
fi
echo "→ Rebased tip: $(git log -1 --oneline)"

echo "═══ Applying deshadow fixup ═══"
git apply "$PATCH"
git add __tests__/utils/address.test.ts
git commit -S -m "test(address): use top-level HDPrivateKey import after pr-4 rebase

pr-4's review tests added a top-level \`import { HDPrivateKey } from
'bitcore-lib'\` to this file; the dynamic re-import inside
'deriveShieldedAddressFromStorage returns null...' now shadowed it
(@typescript-eslint/no-shadow). Use the top-level import.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin shielded/pr-5-storage-layer

git checkout "${START_BRANCH}"
echo
echo "✓ pr-5 rebased onto pr-4(ec439b72) and pushed — ready for review."
echo "  Note: pr-6/7/8 still chain from the OLD pr-5 tip; re-chain later."
echo "  You can delete the patch:  rm ${PATCH}"
