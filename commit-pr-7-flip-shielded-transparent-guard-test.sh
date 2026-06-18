#!/usr/bin/env bash
#
# Integration-test counterpart of the pr-6 "keep guard" decision.
#
# core.test.ts had `should send transparent output to a shielded address
# (auto-converts to spend P2PKH)` asserting that a plain (non-shielded) send
# to a 71-byte shielded address SUCCEEDS by silently rewriting to the
# spend-derived P2PKH. pr-6 restored the loud rejection of that case
# (getAddressType throws before utxo selection), so this test now contradicts
# the code and was the lone integration failure (146/147).
#
# Flip it to assert the rejection, matching the pr-6 unit test
# (__tests__/new/sendTransaction.test.ts) and the actual error that
# HathorWallet.sendTransaction -> run() -> prepareTxData propagates unchanged.
#
# Validated: tsc clean, lint clean. Behavioural correctness established by the
# equivalent passing unit test + the unchanged error-propagation path
# (run() re-throws the SendTxError as-is; toThrow(/regex/) matches substring).
#
# NOTE: advances pr-7 by one commit; pr-8 re-chains at the post-5a-merge
# cascade as usual.
#
# Branch: shielded/pr-7-integration-tests
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-7-integration-tests
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

git add -- __tests__/integration/shielded_outputs/core.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE '^__tests__/integration/shielded_outputs/core\.test\.ts$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "test(shielded): assert transparent send to a shielded address is rejected

pr-6 restored the loud rejection of a shielded address placed in a transparent
output (getAddressType throws before utxo selection). This integration test
still asserted the old auto-convert-to-spend-P2PKH behavior and was the only
failure in the shielded suite (146/147).

Flip it to assert the rejection, matching the pr-6 unit test and the error
HathorWallet.sendTransaction propagates. To pay a shielded address, callers
use a shielded output definition, which is exercised elsewhere in the suite.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
