#!/usr/bin/env bash
#
# PR 5a review (memory_store, 3 points):
#
#  1. addressIter: revert the shielded-chain sort back to a single
#     this.addresses.values() loop with the legacy/shielded if-else. The sort
#     guarded against out-of-order insertion that loadAddresses never produces
#     (it saves each index sequentially), and it made the shielded chain
#     inconsistent with the legacy chain, which has always relied on the same
#     sequential-insertion == BIP32-index-order invariant. (Supersedes the
#     sort added in 5ff8d9ed for CodeRabbit; insertion order is sufficient.)
#  2. addressCount(opts?): count per chain via the index maps in O(1)
#     (addressIndexes.size / shieldedAddressIndexes.size — each holds exactly
#     its chain; shielded-spend is in neither) instead of scanning
#     this.addresses, and add the legacy/shielded opt for API consistency with
#     the other chain-aware store methods. Interface updated in types.ts.
#  3. getCurrentAddress: reuse getAddressAtIndex(currentIndex, opts) instead of
#     duplicating the index-map lookup.
#
# Validated on 5a: tsc clean, lint clean, full unit suite 79/1034.
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

git add -- src/storage/memory_store.ts src/types.ts __tests__/storage/memory_store.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/storage/memory_store\.ts|src/types\.ts|__tests__/storage/memory_store\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "refactor(storage): simplify addressIter, count per chain via index maps

Review follow-ups on the shielded MemoryStore methods:

- addressIter: revert the shielded-chain sort to a single addresses.values()
  loop with the legacy/shielded if-else. loadAddresses saves each index
  sequentially, so insertion order already equals BIP32-index order — the
  same invariant the legacy chain has always relied on. The sort guarded an
  out-of-order case that never occurs and made the two chains inconsistent.
- addressCount(opts?): return the per-chain count from the index maps
  (addressIndexes.size / shieldedAddressIndexes.size) in O(1) instead of
  scanning addresses, and accept the legacy/shielded opt for consistency with
  the other chain-aware store methods (IStore updated). shielded-spend is in
  neither index map, so it is excluded as before.
- getCurrentAddress: reuse getAddressAtIndex(currentIndex, opts) rather than
  duplicating the index-map lookup.

tsc clean, lint clean, full unit suite (79 suites / 1034 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
