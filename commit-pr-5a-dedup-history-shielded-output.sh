#!/usr/bin/env bash
#
# PR 5a review (self): IHistoryShieldedOutput duplicated every crypto wire
# field of IShieldedOutput (shielded/types.ts), kept in step only by a
# "keep both in sync when modifying" comment — a drift hazard.
#
# Make IHistoryShieldedOutput extend IShieldedOutput, overriding `decoded`
# with the richer IHistoryOutputDecoded (adds `data?`) and adding `spent_by`.
# The crypto wire fields (mode/commitment/range_proof/script/token_data/
# ephemeral_pubkey/asset_commitment/surjection_proof) become single-source.
# ShieldedOutputMode is no longer referenced directly here -> dropped from the
# import.
#
# Validated on 5a: tsc clean, lint 0 errors, full unit suite 79/1032 pass.
#
# NOTE: 5a is the base of the stack; this advances it by one commit. Per the
# plan we do NOT re-cascade 5b..8 now — that happens after 5a merges (the
# follow-up commit squashes into 5a's merge anyway).
#
# Branch: shielded/pr-5-storage-layer
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-5-storage-layer
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

git add -- src/types.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE '^src/types\.ts$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "refactor(types): derive IHistoryShieldedOutput from IShieldedOutput

IHistoryShieldedOutput duplicated every crypto wire field of IShieldedOutput
(shielded/types.ts), kept consistent only by a 'keep both in sync' comment.

Make it extend Omit<IShieldedOutput, 'decoded'>, override decoded with the
richer IHistoryOutputDecoded (adds the data? field), and add spent_by. The
crypto wire fields are now single-source and cannot drift. ShieldedOutputMode
is no longer referenced directly in types.ts, so it is dropped from the import.

Type-only change; no runtime effect. tsc clean, lint clean, full unit suite
(79 suites / 1032 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
