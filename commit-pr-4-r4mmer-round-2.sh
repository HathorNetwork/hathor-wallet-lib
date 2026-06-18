#!/usr/bin/env bash
#
# r4mmer's round-2 comments on PR #1087:
#
#  R1 (taken): the byte→length cross-check ternary becomes an explicit
#     version-byte → decoded-length map. Each valid byte maps explicitly,
#     and an unmapped byte (a future address family added to the network
#     without a size entry) fails loudly instead of silently defaulting
#     to the legacy length.
#  R3 (doc only): getAddressType's JSDoc now states it returns the OUTPUT
#     SCRIPT type (which is what every caller feeds into output building)
#     and points to Address.getType() as the general classifier that
#     includes 'shielded'. See PR thread for why a general util variant
#     wasn't added.
#  R2 (parseShielded caching) — not taken; see PR thread.
#  R4 — praise on the derivation-asymmetry comment; no action.
#
# lint clean, build clean, full unit suite 79 suites / 1029 tests.
#
# NOTE: pr-5a/5b/5c chain from pr-4's previous tip; this commit propagates
# to them at the next cascade (same as all pr-4 review commits).
#
# Branch: shielded/pr-4-address-derivation
# Yubikey touch required (signed commit).
set -euo pipefail

cd "$(dirname "$0")"

BRANCH=shielded/pr-4-address-derivation
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2
  exit 1
fi

git add -- src/models/address.ts src/utils/address.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^src/(models|utils)/address\.ts$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

git status --short

git commit -S -m "refactor(address): map version byte to decoded length explicitly

Review responses (r4mmer, round 2):

- Replace the byte→length ternary in validateAddress with an explicit
  version-byte → decoded-length map. The ternary treated 'not shielded' as
  legacy implicitly; with the map, each valid byte is stated, and an
  unmapped byte — a future address family added to the network without a
  size entry here — fails loudly instead of silently defaulting to the
  25-byte length.
- Clarify getAddressType's doc: it returns the OUTPUT SCRIPT type (what
  every caller feeds into output building), and the general
  address-family classifier including 'shielded' is Address.getType().

lint, build, and the full unit suite (79 suites / 1029 tests) pass.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
