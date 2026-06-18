#!/usr/bin/env bash
#
# PR 5a review (design): getChangeAddress was eagerly converting a shielded
# change address into its spend-derived P2PKH inside the storage layer. That
# duplicated a transaction-construction rule that already lives in the script
# layer — createOutputScript (utils/transaction.ts) and
# createOutputScriptFromAddress (utils/address.ts) both resolve a shielded
# address to its spend-P2PKH script, keyed off the address, at build time.
#
# Drop the eager conversion: getChangeAddress is a storage-layer resolver and
# now returns the owned change address verbatim (including the 71-byte
# shielded form). The shielded -> spend-P2PKH script rule stays in one place
# (the transaction layer), which keeps change consistent with every other
# output address and activates createOutputScript's shielded branch for its
# intended purpose. The on-chain result is unchanged (same P2PKH script);
# output processing already derives the change UTXO's address from the script,
# not the build-time field.
#
# Also removes the now-unused Address import from storage.ts and inverts the
# storage.test.ts change-address test to assert the no-conversion behavior
# (this supersedes the conversion-coverage test added in 5ff8d9ed, in
# response to CodeRabbit — the conversion no longer exists to cover).
#
# Validated on 5a: tsc clean, lint clean, full unit suite 79/1035.
# NOTE: send-path behavior change — see the integration note in chat; the
# shielded-change-address integration tests (token_creation K.2,
# mint_melt_shielded) should be re-run at the next cascade integration pass.
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

git add -- src/storage/storage.ts __tests__/storage/storage.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/storage/storage\.ts|__tests__/storage/storage\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "refactor(storage): getChangeAddress returns shielded addresses unconverted

getChangeAddress eagerly converted a shielded change address to its
spend-derived P2PKH inside the storage layer. That duplicated a
transaction-construction rule already owned by the script layer:
createOutputScript and createOutputScriptFromAddress both resolve a shielded
address to its spend-P2PKH script (keyed off the address) at build time.

Drop the conversion. getChangeAddress now returns the owned change address
verbatim, including the 71-byte shielded form; the shielded -> spend-P2PKH
rule lives in one place (the transaction layer), keeping change consistent
with every other output address. On-chain output is unchanged (same P2PKH
script), and output processing derives the change UTXO's address from the
script, not the build-time field. Also drop the now-unused Address import.

Inverts the storage change-address test to assert the no-conversion behavior,
superseding the conversion-coverage test from the prior commit (the
conversion CodeRabbit asked to cover no longer exists).

tsc clean, lint clean, full unit suite (79 suites / 1035 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
