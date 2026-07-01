#!/usr/bin/env bash
#
# PR 5a — CodeRabbit review (4 comments, all addressed):
#
#  1. memory_store.test.ts — assert transparent classification, not the exact
#     stored representation: `expect(shielded).toBeUndefined()` ->
#     `not.toBe(true)` (the filter treats undefined and false alike).
#  2. storage.ts coverage — new getChangeAddress test: a wallet-owned shielded
#     change address resolves to its on-chain spend-derived P2PKH.
#  3. utils/address.ts coverage — new positive-path test for
#     deriveShieldedAddressFromStorage: asserts the shielded + shielded-spend
#     records (same bip32 index, types, spend matching deriveShieldedAddress).
#  4. memory_store.ts addressIter — the shielded branch is documented as
#     BIP32-index ordered but walked this.addresses.values() (insertion
#     order). Now iterates shieldedAddressIndexes sorted by index, so the
#     order holds even if addresses were saved/restored out of order. New
#     out-of-order test covers it.
#
# Validated on 5a: tsc clean, lint clean, full unit suite 79/1035.
#
# NOTE: advances 5a; the stack re-cascades after 5a merges (per plan).
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

git add -- src/storage/memory_store.ts \
  __tests__/storage/memory_store.test.ts \
  __tests__/storage/storage.test.ts \
  __tests__/utils/address.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/storage/memory_store\.ts|__tests__/storage/memory_store\.test\.ts|__tests__/storage/storage\.test\.ts|__tests__/utils/address\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "test(shielded): address CodeRabbit review + fix shielded addressIter order

- memory_store.addressIter: the shielded chain is documented as BIP32-index
  ordered but iterated this.addresses.values() (insertion order). Walk
  shieldedAddressIndexes sorted by index so the documented order holds even
  when addresses are saved or restored out of order. Add a regression test
  that saves shielded indices out of order and asserts sorted iteration.
- memory_store.test: assert the transparent classification (filter treats
  undefined and false alike) instead of the exact stored representation.
- storage.test: cover getChangeAddress converting a wallet-owned shielded
  change address to its on-chain spend-derived P2PKH.
- address.test: add the positive path for deriveShieldedAddressFromStorage —
  assert the paired shielded + shielded-spend records (same bip32 index,
  addressType, spend address matching deriveShieldedAddress).

tsc clean, lint clean, full unit suite (79 suites / 1035 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
