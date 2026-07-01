#!/usr/bin/env bash
#
# Responses to Pedro's PR #1087 review comments (batch 2):
#
# 1. AddressType moved from models/address.ts to src/types.ts (canonical
#    home next to IAddressInfo), and IAddressInfo.addressType now REUSES it
#    (`AddressType | 'shielded-spend'`) so the two unions cannot drift.
#    models/address.ts re-exports the type for API stability.
# 2. Address byte lengths moved to constants.ts following its *_SIZE_BYTES
#    convention: LEGACY_ADDRESS_SIZE_BYTES (25), SHIELDED_ADDRESS_SIZE_BYTES
#    (71), with layout-breakdown comments.
# 3. Hardcoded pubkey slice offsets (1/34/67) replaced with offsets derived
#    from COMPRESSED_PUBKEY_SIZE_BYTES — the 33-byte width is stated once.
# 4. New Address.parseShielded(): single structure-aware decode returning a
#    typed IShieldedAddressParts {versionByte, scanPubkey, spendPubkey,
#    checksum} (type lives in src/shielded/types.ts). getScanPubkey/
#    getSpendPubkey become thin wrappers. Deliberate behavior tightening:
#    BOTH pubkeys are on-curve-validated regardless of which part the
#    caller wants — an address with any invalid key is invalid as a whole
#    (previously extracting the "good half" of a half-corrupt address
#    succeeded). Off-curve test updated accordingly; new parseShielded test.
#
# lint clean, build clean, full unit suite 79 suites / 1023 tests.
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
  src/constants.ts \
  src/types.ts \
  src/models/address.ts \
  src/shielded/types.ts \
  __tests__/models/address.test.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^(src/(constants|types|models/address|shielded/types)\.ts|__tests__/models/address\.test\.ts)$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

git status --short

git commit -S -m "refactor(address): canonical type/constant homes + unified parseShielded decoder

Review responses (Pedro, batch 2):

- Move AddressType to src/types.ts next to IAddressInfo, and reuse it in
  IAddressInfo.addressType ('shielded-spend' added on top) so the two
  unions cannot drift. models/address.ts re-exports the type so existing
  imports keep working.
- Move the address byte lengths to constants.ts following the *_SIZE_BYTES
  convention: LEGACY_ADDRESS_SIZE_BYTES (25) and
  SHIELDED_ADDRESS_SIZE_BYTES (71).
- Replace the hardcoded pubkey slice offsets (1/34/67) with offsets derived
  from COMPRESSED_PUBKEY_SIZE_BYTES, so the 33-byte width is stated once:
  version(1) | scan(33) | spend(33) | checksum(4).
- Add Address.parseShielded(): a single structure-aware decode returning a
  typed IShieldedAddressParts {versionByte, scanPubkey, spendPubkey,
  checksum} (type in src/shielded/types.ts); getScanPubkey/getSpendPubkey
  are now thin wrappers over it. Deliberate tightening: both embedded
  pubkeys are on-curve-validated regardless of which part the caller asks
  for — an address with any invalid key is invalid as a whole, so
  extracting the 'good half' of a half-corrupt address no longer succeeds.
  Off-curve test updated; new parseShielded structural test.

lint, build, and the full unit suite (79 suites / 1023 tests) pass.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
