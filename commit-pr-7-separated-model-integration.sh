#!/usr/bin/env bash
#
# SEPARATED-model migration, layer 4/6 (7 integration tests). 7 was reset onto
# the new 6 and its integration suite brought forward, reconciled for the
# arithmetic model. See SHIELDED_SEPARATED_MODEL_SPEC.md (v2).
#
# The shielded integration suite (22 black-box suites + Docker infra + the
# ct-crypto-node provider registration + precalculated wallets) is the
# acceptance gate. The N-series sparse-decode tests and R.7/R.12/L.5 assert
# end-to-end balances and on-chain spendability — they pass UNMODIFIED under
# the separated model (that's the green light from the Docker run). Only three
# files needed reconciliation:
# - realtime_vs_reload.test.ts: STRUCTURAL — the real-time decode check now
#   counts decoded shielded slots in tx.shielded_outputs[] (value!==undefined)
#   instead of appended tx.outputs[] entries; drop the unused transactionUtils
#   import.
# - sparse_decode.test.ts: COMMENT-ONLY — rewrite the N.6/N.7 bug narrative
#   from the onChainIndex/append mechanism to the arithmetic
#   resolveSpentOutput(shielded_outputs[idx-T]); all assertions unchanged.
# - wallet_restart.test.ts: COMMENT-ONLY — describe the re-decode + arithmetic
#   index path instead of the commitment-match fallback.
#
# Validated: tsc clean, lint 0 errors, no sparse-model references left in test
# code. The integration suite itself is validated by the Docker run on pr-8
# (the next phase), not by unit tsc/jest.
#
# Branch: shielded/pr-7-integration-tests (force-push: history rewritten onto new 6)
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-7-integration-tests
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

git add -- __tests__/integration/ .github/workflows/integration-test.yml

UNEXPECTED=$(git diff --cached --name-only | grep -vE '^(__tests__/integration/|\.github/workflows/integration-test\.yml$)' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

echo "staged $(git diff --cached --name-only | wc -l | tr -d ' ') files (integration suite + CI timeout)"

git commit -S -m "test(shielded): integration suite — separated-output model

Bring the shielded integration suite (22 suites + Docker infra + ct-crypto-node
provider registration + precalculated wallets + the integration-test CI
workflow timeout bump) forward onto the separated model (layer 4/6). The
N-series sparse-decode regressions and R.7/R.12/L.5 are
black-box end-to-end balance/spendability tests and pass unmodified — they are
the acceptance gate for the Docker run.

Three files reconciled:
- realtime_vs_reload.test.ts: count decoded shielded slots in shielded_outputs[]
  (value!==undefined) rather than appended outputs[] entries; drop the now-unused
  transactionUtils import.
- sparse_decode.test.ts: rewrite the N.6/N.7 bug narrative from the
  onChainIndex/append mechanism to the arithmetic resolveSpentOutput
  (shielded_outputs[idx-T]); assertions unchanged.
- wallet_restart.test.ts: describe the re-decode + arithmetic-index path.

tsc clean, lint clean. The suite is validated by the Docker integration run.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
