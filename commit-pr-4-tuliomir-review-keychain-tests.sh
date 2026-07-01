#!/usr/bin/env bash
#
# Responses to tuliomir's PR #1087 review — the key-chain code was
# line-covered but its critical properties were not ASSERTED. One small
# hardening + six test additions:
#
#  T2 change-pin test now asserts scan/spendMainKey re-encryption:
#     checkPassword under the new pin (and NOT the old), decrypted xprivs
#     unchanged (re-encryption, not re-derivation; catches oldPin/newPin
#     swap and scan/spend copy-paste mix-ups), password change leaves the
#     pin-encrypted keys untouched.
#  T3 HARDENING: migrateShieldedAccessData now cross-checks the PIN against
#     mainKey before writing anything — a mismatched PIN previously yielded
#     scan/spend blobs encrypted under a different pin than the rest of the
#     record, silently. New M.6 test (throws, record untouched, cause
#     preserved). BIP39 passphrases cannot be validated the same way
#     (unverifiable by design) — doc comment now states this explicitly.
#  T4 pipeline-level test: SendTransaction.prepareTxData rejects a shielded
#     address in a transparent output (utils-level test existed; this pins
#     the throw through the real send path).
#  T5 passphrase tests: M.7 (migrate with original passphrase == fresh
#     create) and M.8 (different passphrase silently derives different
#     keys — pins the documented, undetectable failure mode).
#  T6 xpriv key-chain test: root import asserts scan/spend xpubs at the
#     exact documented paths + encrypted under the pin; change-level import
#     asserts all four fields ABSENT (the depth-guard else arm); seed
#     import and root-xpriv import of the same wallet yield identical
#     shielded keys (guards the compliant/non-compliant asymmetry).
#  T7 M.9 partial-record test: a record with some-but-not-all shielded
#     fields is healed by deterministic re-derivation (same seed -> same
#     keys), all four fields repopulated equal to the originals.
#
# (T1 — enum vs literal union for AddressType — reply-only: keeping the
# union; see PR thread.)
#
# lint clean, build clean, full unit suite 79 suites / 1029 tests.
#
# Branch: shielded/pr-4-address-derivation
# Yubikey touch required (signed commit).
set -euo pipefail

cd "$(dirname "$0")"

BRANCH=shielded/pr-4-address-derivation
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $CURRENT" >&2
  exit 1
fi

git add -- \
  src/utils/wallet.ts \
  __tests__/utils/wallet.test.ts \
  __tests__/new/sendTransaction.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/utils/wallet\.ts|__tests__/(utils/wallet|new/sendTransaction)\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

git status --short

git commit -S -m "fix(wallet): validate migration PIN against mainKey + assert key-chain properties in tests

Responses to tuliomir's review: the shielded key-chain code was
line-covered but its critical properties were unasserted.

Hardening: migrateShieldedAccessData now cross-checks the PIN against the
record's mainKey BEFORE writing anything. A mismatched PIN previously
yielded scan/spend blobs silently encrypted under a different pin than the
rest of the record — the wallet would then fail to decrypt its shielded
keys on every unlock with no hint that migration was the cause. BIP39
passphrases cannot be validated the same way (any passphrase yields a
valid seed, by design); the doc comment now states callers must supply the
wallet's original passphrase.

Test additions:
- change-pin test asserts scan/spendMainKey re-encryption: valid under the
  new pin, invalid under the old, decrypted xprivs unchanged (catches an
  oldPin/newPin swap, a scan/spend copy-paste mix-up, or a dropped block —
  all previously stayed green), and password change leaves them untouched.
- M.6: wrong migration PIN throws a specific error and leaves the record
  untouched (cause preserved).
- M.7/M.8: passphrase wallets — migrating with the original passphrase
  matches fresh-create; a different passphrase silently derives different
  keys (pins the documented, inherently undetectable failure mode).
- M.9: a partial record (some-but-not-all shielded fields) is healed by
  deterministic re-derivation — all four fields repopulated equal to the
  originals.
- access-data-from-xpriv: root import asserts scan/spend xpubs at the
  exact documented paths and encrypted under the pin; change-level import
  asserts all four fields absent (the depth-guard else arm); seed import
  and root-xpriv import of the same wallet yield identical shielded keys.
- SendTransaction.prepareTxData rejects a shielded address in a
  transparent output (pipeline-level; the utils-level test already
  existed).

lint, build, and the full unit suite (79 suites / 1029 tests) pass.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
