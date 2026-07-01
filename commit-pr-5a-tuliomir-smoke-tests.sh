#!/usr/bin/env bash
#
# PR 5a review (tuliomir):
#
#  T1 (non-blocking): remove the obsolete "HDPrivateKey comes from the
#     top-level import..." comment in address.test.ts — it documented a past
#     local-shadowing fix that no longer applies; pure noise.
#  T2: add smoke unit tests for the shielded key-access methods in storage.ts
#     where they're built (getScanXPubKey/getSpendXPubKey,
#     getScanXPrivKey/getSpendXPrivKey, setShieldedCryptoProvider), covering
#     the error paths callers will mock rather than exercise: missing shielded
#     keys -> throws, wrong PIN -> rejects, xpub getters non-throwing.
#
#  T3 (return both addresses): not changed — see PR reply. All three callers
#     (loadAddresses, wallet.getAddressAtIndex, sync/stream) save both the
#     shielded receive address and its spend-P2PKH at the same index
#     atomically, so the method returns a derivation pair that is always
#     consumed together.
#
# Validated on 5a: tsc clean, lint clean, full unit suite 79/1038.
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

git add -- __tests__/storage/storage.test.ts __tests__/utils/address.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(__tests__/storage/storage\.test\.ts|__tests__/utils/address\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2; echo "$UNEXPECTED" >&2; exit 1
fi

git status --short

git commit -S -m "test(storage): smoke-test shielded key access + drop obsolete comment

Review responses (tuliomir):

- Add smoke unit tests for the shielded key-access methods in storage.ts at
  the point they're built: getScanXPubKey/getSpendXPubKey return the stored
  xpubs (undefined for pre-shielded wallets), getScanXPrivKey/getSpendXPrivKey
  decrypt with the PIN and throw 'private key is not present' when the keys
  are absent and reject on a wrong PIN, and the shieldedCryptoProvider
  field/setter round-trips. These are the error paths the future callers will
  mock rather than exercise directly.
- Remove the obsolete 'HDPrivateKey comes from the top-level import' comment
  in address.test.ts (documented a past local-shadowing fix; now just noise).

tsc clean, lint clean, full unit suite (79 suites / 1038 tests) passes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
