#!/usr/bin/env bash
#
# PR 5b review: IShieldedOutputEntry re-declared fields that already exist
# elsewhere — the standard output fields (value/token_data/script/decoded/
# token/spent_by, == ITransparentOutput) and the on-chain shielded crypto
# fields (commitment/range_proof/ephemeral_pubkey/asset_commitment?/
# surjection_proof?, also on IShieldedOutput) — a drift hazard like the one
# fixed for IHistoryShieldedOutput.
#
# Extract the shared shielded crypto fields into IShieldedOutputProofs in
# shielded/types.ts (so the genuinely-shielded fields live in the shielded
# module, and IShieldedOutput extends it), then compose IShieldedOutputEntry
# from Omit<ITransparentOutput,'selected_as_input'> + IShieldedOutputProofs,
# adding only the 'shielded' discriminant and the wallet-local decryption
# results (blindingFactor?/assetBlindingFactor?/onChainIndex?).
#
# The entry stays in types.ts (not shielded/types.ts) because it is a member
# of the IHistoryOutput discriminated union and reuses ITransparentOutput, both
# of which live in types.ts; moving it would split the union across files and
# create bidirectional type imports. The cast-based union guard
# ((o as {type?}).type === 'shielded') is unaffected by the `extends`.
#
# Validated on 5b: tsc clean, lint clean, full unit suite 80 suites / 1045
# tests (the union narrows correctly at runtime).
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

git add -- src/types.ts src/shielded/types.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE '^src/(types\.ts|shielded/types\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "refactor(types): compose IShieldedOutputEntry from shared bases

IShieldedOutputEntry re-declared the standard output fields (== ITransparentOutput)
and the on-chain shielded crypto fields (also on IShieldedOutput), a drift
hazard like the one fixed for IHistoryShieldedOutput.

- Extract the shared shielded crypto fields (commitment, range_proof,
  ephemeral_pubkey, asset_commitment?, surjection_proof?) into a new
  IShieldedOutputProofs in shielded/types.ts; IShieldedOutput extends it.
- Compose IShieldedOutputEntry as Omit<ITransparentOutput, 'selected_as_input'>
  + IShieldedOutputProofs, adding only the 'shielded' discriminant and the
  wallet-local decryption results (blindingFactor?, assetBlindingFactor?,
  onChainIndex?).

The entry stays in types.ts: it is a member of the IHistoryOutput discriminated
union and reuses ITransparentOutput, both defined there; moving it would split
the union across files. The cast-based union guard is unaffected by extends.

tsc clean, lint clean, full unit suite (80 suites / 1045 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
