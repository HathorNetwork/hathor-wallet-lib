#!/usr/bin/env bash
#
# tuliomir (PR #1087, non-blocking): the stricter versionByte validation
# is missing an error-handling test.
#
# Adds a unit test covering the "No decoded length registered for version
# byte" branch in validateAddress (the undefined guard added in the
# version-byte -> length map). The branch is unreachable through the public
# path by construction — isVersionByteValid gates it and only accepts the
# same three bytes the size map registers — so the test forces the
# divergence by stubbing isVersionByteValid to accept an unmapped byte,
# which documents the guard's intent and protects against a future byte
# being added to the network's validity check without a size entry.
#
# address.test.ts: 12 tests pass; lint clean.
#
# NOTE: pr-5a/5b/5c chain from pr-4's tip; this commit propagates to them
# at the next cascade (same as all pr-4 review commits).
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

git add -- __tests__/models/address.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^__tests__/models/address\.test\.ts$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

git status --short

git commit -S -m "test(address): cover the unmapped-version-byte error path

Review response (tuliomir, non-blocking): the stricter versionByte
validation was missing an error-handling test.

Covers the 'No decoded length registered for version byte' guard in
validateAddress. That branch is defensive and unreachable through the
public path — isVersionByteValid only accepts the same three bytes the
size map registers — so the test stubs isVersionByteValid to accept an
unmapped byte, exercising the guard that protects against a future byte
added to the network's validity check without a matching size entry.

address.test.ts: 12 tests pass; lint clean.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
