#!/usr/bin/env bash
#
# PR 5b review (calculateWeight), two issues — both introduced by 5b:
#
#  1. CRITICAL privacy leak (GAP1-01): getOutputsSum() folded the plaintext
#     value of every shielded output into the sum calculateWeight() uses as
#     the `amount` term. The min-weight formula is publicly invertible (tx
#     size + network constants are public) and the weight is published on
#     chain as float64, so a passive observer could recover the exact total
#     shielded amount of every tx — defeating amount confidentiality.
#     Fix: drop the shielded loop from getOutputsSum (hathor-core derives the
#     min weight from the transparent sum_outputs only; the max(1,sum) floor
#     already covers fully-shielded txs). Correct the ShieldedOutput.value doc
#     so it can't be reintroduced, and add a regression test asserting two
#     shielded txs differing only in hidden amounts produce identical sums and
#     weights. This is the same fix as pr-8's 37579732, moved to where the
#     leak is introduced.
#  2. Redundant kTerm guard: 5b added `txMinWeightK === 0 ? 4 : ...` claiming
#     to avoid a division-by-zero. amount is floored by max(1,sumOutputs) so
#     it is never 0 — there is no division by zero — and when txMinWeightK is
#     0 the original `4/(1 + 0/amount)` already evaluates to 4. Reverted to
#     master's formula.
#
# Validated on 5b: tsc clean, lint clean, transaction suite 16/16 (incl. the
# GAP1-01 regression). Full unit suite: 1044 passing; the lone intermittent
# failure is a known parallel-jest flake in native-binding suites
# (crypto/wallet — different each run, all pass in isolation), unrelated.
#
# CASCADE NOTE: pr-8's 37579732 becomes redundant. Its transaction.ts/
# shielded_output.ts hunks auto-empty when it replays; its test-append (to a
# describe block that lives downstream) would duplicate this regression test,
# so DROP 37579732 during the next cascade.
#
# Branch: shielded/pr-5b-shielded-tx-utils
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-5b-shielded-tx-utils
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

git add -- src/models/transaction.ts src/models/shielded_output.ts \
  __tests__/models/transaction.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/models/transaction\.ts|src/models/shielded_output\.ts|__tests__/models/transaction\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "fix(shielded): exclude shielded values from tx weight + drop redundant kTerm guard

Two issues in 5b's calculateWeight, both introduced by this PR:

- GAP1-01 (critical privacy leak): getOutputsSum() folded the plaintext value
  of each shielded output into the sum calculateWeight() uses as the amount
  term. The minimum-weight formula is publicly invertible and the weight is
  published on-chain, so an observer could recover the exact total shielded
  amount of every tx. Drop the shielded loop from getOutputsSum() — hathor-core
  derives the minimum weight from the transparent sum_outputs only, and the
  max(1, sum) floor already covers fully-shielded txs. Correct the
  ShieldedOutput.value doc so the field can't be re-folded into the weight, and
  add a regression test (two shielded txs differing only in hidden amounts ->
  identical output sums and identical weights).
- Redundant kTerm guard: the txMinWeightK === 0 ternary was added claiming to
  avoid a division-by-zero, but amount is floored by max(1, sumOutputs) and is
  never 0, and 4/(1 + 0/amount) already evaluates to 4. Reverted to the
  original formula.

tsc clean, lint clean, transaction suite (16 tests incl. the GAP1-01
regression) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
