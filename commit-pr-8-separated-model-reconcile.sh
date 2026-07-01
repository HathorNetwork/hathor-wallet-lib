#!/usr/bin/env bash
#
# SEPARATED-model migration, layer 5/6 (8 headless fixes + release). 8 was
# reset onto the new 7; its five non-redundant fixes were applied and
# reconciled with the separated model. The old weight-leak fix (37579732) is
# DROPPED — it already lives in 5b. See SHIELDED_SEPARATED_MODEL_SPEC.md (v2).
#
# Applied (reconciled where they touch the reworked files):
# - reject value < 1 in createShieldedOutputs (creation.ts + test).
# - getUtxos defaults to order_by_value 'desc' (new/types.ts + wallet.ts).
# - dedup identical wallet-load-partial-update emits (utils/storage.ts
#   apiSyncHistory — reconciled onto the separated receive pipeline).
# - preserve type/data on data outputs in sendManyOutputsSendTransaction
#   (wallet.ts — inserted after the separated shielded-output branch).
# - explicit registerShieldedProvider per HathorWallet construction
#   (@hathor/ct-crypto-node devDep + provider registration across the shielded
#   integration suites; not duplicating 7's existing auto-registration).
# Dropped: 37579732 (weight leak) — redundant, present via 5b (verified:
# getOutputsSum has no shielded loop).
#
# Constraints satisfied: normalizeShieldedOutputs left decoded-field-preserving
# (no stripping); no sparse-append shape reintroduced (no append/onChainIndex-
# field/findSpentOutput/IShieldedOutputEntry); no 5b/5c/6 logic reverted.
#
# Validated: tsc clean, lint 0 errors (2 pre-existing warnings), full unit
# suite 81/1096 (+4 unit tests). No version bump (no release commit in range).
#
# Branch: shielded/pr-8-headless-fixes-and-release (force-push: history rewritten onto new 7)
# Yubikey touch required (signed commit).
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=shielded/pr-8-headless-fixes-and-release
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2; exit 1
fi

FILES=(
  src/new/types.ts src/new/wallet.ts src/shielded/creation.ts src/utils/storage.ts
  package.json package-lock.json
  __tests__/new/hathorwallet.test.ts __tests__/shielded/creation.test.ts
  __tests__/integration/adapters/fullnode.adapter.ts
  __tests__/integration/adapters/service.adapter.ts
  __tests__/integration/adapters/types.ts
  __tests__/integration/helpers/wallet.helper.ts
  __tests__/integration/shared/send-many-outputs.test.ts
  __tests__/integration/shielded_outputs/access_data_migration.test.ts
  __tests__/integration/shielded_outputs/address_derivation.test.ts
  __tests__/integration/shielded_outputs/core.test.ts
  __tests__/integration/shielded_outputs/realtime_vs_reload.test.ts
  __tests__/integration/shielded_outputs/wallet_restart.test.ts
  __tests__/integration/fullnode-specific/get-utxos-ordering.test.ts
  __tests__/integration/fullnode-specific/load-partial-update-emit.test.ts
)
git add -- "${FILES[@]}"

STAGED=$(git diff --cached --name-only | sort)
EXPECTED=$(printf '%s\n' "${FILES[@]}" | sort)
if [[ "$STAGED" != "$EXPECTED" ]]; then
  echo "ERROR: staged set != expected. Staged:" >&2; echo "$STAGED" >&2; exit 1
fi

git status --short

git commit -S -m "fix(shielded): headless fixes — separated-output model reconcile

Apply pr-8's five non-redundant fixes on the separated model (layer 5/6); the
old weight-leak fix is dropped (already in 5b).

- reject value < 1 in createShieldedOutputs.
- getUtxos defaults to order_by_value 'desc'.
- dedup identical wallet-load-partial-update emits (reconciled onto the
  separated apiSyncHistory).
- preserve type/data on data outputs in sendManyOutputsSendTransaction
  (inserted after the separated shielded-output branch).
- explicit registerShieldedProvider per HathorWallet construction
  (@hathor/ct-crypto-node devDependency + provider registration across the
  shielded integration suites).

normalizeShieldedOutputs stays decoded-field-preserving; no sparse-append shape
is reintroduced; no separated-model logic from 5b/5c/6 is reverted.

tsc clean, lint clean, full unit suite (81 suites / 1096 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push --force-with-lease origin "${BRANCH}"
