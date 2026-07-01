#!/usr/bin/env bash
#
# Responses to Pedro's PR #1087 review comments:
#
# 1. assertValidCompressedPubkey — "doesn't PublicKey.fromBuffer already
#    check this?" Almost, but not quite: verified empirically that bitcore
#    ALSO ACCEPTS 65-byte UNCOMPRESSED keys (04/06/07 prefix), which would
#    silently corrupt the fixed 33-byte slots of the 71-byte address layout;
#    and bitcore's own shape-rejection message is an opaque 'Invalid X'.
#    So the explicit check stays (it is load-bearing for the uncompressed
#    case), the literal 33 becomes COMPRESSED_PUBKEY_SIZE_BYTES per the
#    second half of the suggestion, and the doc comment now records the
#    non-redundancy rationale.
#
# 2. IShieldedAddressInfo moved from utils/shieldedAddress.ts to
#    src/shielded/types.ts — the established home for shielded-domain types
#    since PR 2. Verified zero stack ripple: pr-5/pr-6 consume the return
#    type structurally and never import it by name.
#
# lint clean, build clean, full unit suite 79 suites / 1022 tests.
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
  src/utils/shieldedAddress.ts \
  src/shielded/types.ts

UNEXPECTED=$(git diff --cached --name-only | grep -vE \
  '^src/(utils/shieldedAddress|shielded/types)\.ts$' || true)
if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: unexpected files staged, aborting:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

git status --short

git commit -S -m "refactor(shielded): use pubkey size constant + move IShieldedAddressInfo to shielded types

Review responses:

- assertValidCompressedPubkey: the explicit shape check is NOT redundant
  with PublicKey.fromBuffer — bitcore also accepts 65-byte uncompressed
  keys (04/06/07 prefix), verified empirically, which would silently
  corrupt the fixed 33-byte slots of the 71-byte address layout; and
  bitcore's own shape error is an opaque 'Invalid X'. Keep the check,
  switch the literal 33 to COMPRESSED_PUBKEY_SIZE_BYTES, and document the
  rationale in the doc comment.
- Move IShieldedAddressInfo from utils/shieldedAddress.ts to
  src/shielded/types.ts, the established home for shielded-domain types
  since PR 2 (#1085). No stack ripple: pr-5/pr-6 use deriveShieldedAddress's
  return type structurally and never import the interface by name.

lint, build, and the full unit suite (79 suites / 1022 tests) pass.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin "${BRANCH}"
