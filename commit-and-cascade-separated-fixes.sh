#!/usr/bin/env bash
#
# Land the separated-model integration fixes into PR 6 and cascade to 7 & 8.
#
# Seven src files + one new test fix the 7 separated-model regressions the
# shielded integration suite surfaced (all unit-invisible): genesis-cascade
# schema bug, inline shielded outputs in outputs[], shielded-input reload debit,
# onNewTx trust-wire security hole, bare-redelivery decoded-data erosion,
# getTxHistory shielded omission, token-creation shielded change address.
#
# Validated on the assembled stack: full unit suite (1102 tests) + FULL shielded
# integration suite (22 suites / 147 tests) both green; each fix also confirmed
# by its own single-suite probe.
#
# Layout: ALL fixes land as ONE commit on pr-6 (the complete separated-model
# layer). pr-7 (integration tests) and pr-8 (headless fixes) are rebased on top.
# Cascade pre-verified in a throwaway worktree: patch applies clean to pr-6;
# pr-7 & pr-8 rebase with NO conflicts; new-pr-8 delta == this patch exactly.
#
# YUBIKEY: 3 signed operations — pr-6 commit, pr-7 rebase (1 commit), pr-8 rebase
# (1 commit). Touch when prompted. NOTHING is pushed until all local steps +
# build + lint + signature checks pass, so a mid-cascade failure pushes nothing.
#
# Recovery if it aborts mid-way:
#   git checkout shielded/pr-6-wallet-lifecycle && git reset --hard 3237bbf4
#   git checkout shielded/pr-7-integration-tests && git reset --hard 8555e1e4
#   git checkout shielded/pr-8-headless-fixes-and-release && git reset --hard a9c54909
#   git apply ./separated-model-integration-fixes.patch   # restore the fixes
set -euo pipefail
cd "$(dirname "$0")"

PATCH="./separated-model-integration-fixes.patch"
PR6=shielded/pr-6-wallet-lifecycle
PR7=shielded/pr-7-integration-tests
PR8=shielded/pr-8-headless-fixes-and-release

# Old tips: cascade bases + --force-with-lease expectation + recovery anchors.
OLD6=3237bbf4
OLD7=8555e1e4
OLD8=a9c54909

# ---------------------------------------------------------------- safety checks
[[ -f "$PATCH" ]] || { echo "ERROR: patch $PATCH not found"; exit 1; }
CUR=$(git branch --show-current)
[[ "$CUR" == "$PR8" ]] || { echo "ERROR: expected to start on $PR8, on $CUR"; exit 1; }
[[ "$(git rev-parse "$PR6")" == "$(git rev-parse "$OLD6")" ]] || { echo "ERROR: $PR6 != $OLD6 (stack moved)"; exit 1; }
[[ "$(git rev-parse "$PR7")" == "$(git rev-parse "$OLD7")" ]] || { echo "ERROR: $PR7 != $OLD7 (stack moved)"; exit 1; }
[[ "$(git rev-parse "$PR8")" == "$(git rev-parse "$OLD8")" ]] || { echo "ERROR: $PR8 != $OLD8 (stack moved)"; exit 1; }

# Guard: the working tree must be exactly base+patch, then revert it (the fixes
# live in $PATCH; we re-apply them on pr-6). Reverse-apply check prevents losing
# any unexpected local edit.
git apply --check -R "$PATCH" || { echo "ERROR: working tree != base+patch; aborting to avoid data loss"; exit 1; }
echo "working tree matches patch — reverting to a clean pr-8 tree..."
git apply -R "$PATCH"

verify_signed() { git verify-commit "$1" >/dev/null 2>&1 || { echo "ERROR: commit $1 is NOT signed"; exit 1; }; }

# --------------------------------------------------- 1) commit fixes on pr-6
git checkout "$PR6"
git apply "$PATCH"
git add -A
echo ">>> YUBIKEY TOUCH 1/3: signing the pr-6 fix commit"
git commit -S -m "fix(shielded): separated-model integration fixes

The separated-model migration regressed 7 behaviours that only the shielded
integration suite surfaced (all unit-invisible). Fix them so the full shielded
suite passes (22 suites / 147 tests) with no unit regression (1102 unit tests):

- schemas: accept a transparent input \`type\` and inline shielded outputs in
  outputs[] (the alpha-v3 wire form); normalizeShieldedOutputs relocates the
  inline entries into shielded_outputs[]. The strict schema rejected them
  BEFORE normalize ran, throwing while loading history and bricking wallet load.
- storage(processNewTx): debit shielded inputs from the balance counter by
  resolving the parent tx's decoded shielded output, so a reload (bare
  address_history inputs) matches realtime (sender-enriched inputs) instead of
  over-counting the spent shielded UTXO.
- wallet(onNewTx): strip untrusted wire-provided decoded values — a malicious or
  compromised data source could otherwise pre-fill them to forge a credit past
  the ECDH rewind; and restore stored shielded_outputs on a metadata-only
  re-delivery so previously-decoded balances are not eroded to undefined.
- memory_store(historyIter): include owned shielded_outputs[] so a shielded-only
  receive appears in getTxHistory / tokenHistory.
- tokens/address: resolve a shielded change address to its spend-derived P2PKH
  in token creation (getAddressType throws on a shielded address directly).

Adds __tests__/schemas.test.ts (regression: schema acceptance + normalize relocation).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
NEW6=$(git rev-parse HEAD)
verify_signed "$NEW6"
echo "pr-6 committed + signed: $(git rev-parse --short HEAD)"
npm run build
npm run lint
echo "pr-6 build + lint OK"

# --------------------------------------------------- 2) rebase pr-7 onto new pr-6
echo ">>> YUBIKEY TOUCH 2/3: re-signing pr-7 during rebase"
git -c commit.gpgsign=true rebase --onto "$NEW6" "$OLD6" "$PR7"
NEW7=$(git rev-parse HEAD)
verify_signed "$NEW7"
echo "pr-7 rebased + signed: $(git rev-parse --short HEAD)"

# --------------------------------------------------- 3) rebase pr-8 onto new pr-7
echo ">>> YUBIKEY TOUCH 3/3: re-signing pr-8 during rebase"
git -c commit.gpgsign=true rebase --onto "$NEW7" "$OLD7" "$PR8"
verify_signed "$(git rev-parse HEAD)"
echo "pr-8 rebased + signed: $(git rev-parse --short HEAD)"
npm run build
npm run lint
echo "pr-8 build + lint OK"

# --------------------------------------------------- 4) push the cascade
git push --force-with-lease origin "$PR6"
git push --force-with-lease origin "$PR7"
git push --force-with-lease origin "$PR8"

echo
echo "DONE — separated-model fixes landed on pr-6 and cascaded to pr-7 & pr-8."
echo "  pr-6 $(git rev-parse --short "$PR6")  pr-7 $(git rev-parse --short "$PR7")  pr-8 $(git rev-parse --short "$PR8")"
