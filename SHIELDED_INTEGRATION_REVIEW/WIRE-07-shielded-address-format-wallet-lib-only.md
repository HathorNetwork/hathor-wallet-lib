# WIRE-07: Shielded address wire format is a wallet-lib-only convention that diverges from the RFC sketch — cross-client interop must be standardized before release

**Severity:** info - **Status:** confirmed by adversarial review

**Also reported as:** a second WIRE-07 write-up (wallet-lib-only convention) — merged here.

## Summary

wallet-lib invents its own shielded address encoding — `Base58(version(1) || scan_pubkey(33) || spend_pubkey(33) || checksum(4))` with version bytes `0x3c` (mainnet) and `0x5d` (testnet/privatenet) — that exists nowhere outside this repository. The RFC sketches a different, shorter format (`scan_pubkey(33) || hash(spend_pubkey)(20)`), and hathor-core defines no shielded address format at all, since consensus only sees scripts and ephemeral pubkeys. Nothing is broken today because wallet-lib is the only client, but any second implementation following the RFC sketch would produce addresses this library cannot parse, and vice versa. The format and its version-byte registry must be ratified upstream before external wallets integrate.

## Location

- `src/utils/shieldedAddress.ts:28` — format documented as `Base58(version_byte(1B) || scan_pubkey(33B) || spend_pubkey(33B) || checksum(4B))`
- `src/utils/shieldedAddress.ts:53-57` — encoding implementation
- `src/models/network.ts:17,24,31` — invented version bytes `shielded: 0x3c` (mainnet) / `0x5d` (testnet, privatenet)
- `src/models/address.ts:25` — `SHIELDED_ADDR_LENGTH = 71` (decode/validation side)
- `src/models/address.ts:83-84,94-130` — `validateAddress` accepts the 71-byte form
- `src/models/address.ts:148-151` — `getType()` classifies via the `shielded` version byte

## Details

The encoder in `src/utils/shieldedAddress.ts` builds the address from two full 33-byte compressed pubkeys plus a network-specific version byte and a 4-byte checksum:

```ts
// src/utils/shieldedAddress.ts:53-57
const versionByte = Buffer.from([network.versionBytes.shielded]);
const payload = Buffer.concat([versionByte, scanPubkey, spendPubkey]);
const checksum = helpers.getChecksum(payload);
const full = Buffer.concat([payload, checksum]);
return encoding.Base58.encode(full);
```

The version bytes come from a wallet-lib-local table:

```ts
// src/models/network.ts:13-35 (excerpt)
mainnet:    { p2pkh: 0x28, p2sh: 0x64, shielded: 0x3c, ... },
testnet:    { p2pkh: 0x49, p2sh: 0x87, shielded: 0x5d, ... },
privatenet: { p2pkh: 0x49, p2sh: 0x87, shielded: 0x5d, ... },
```

The decode side mirrors the same convention: `src/models/address.ts:25` hardcodes `SHIELDED_ADDR_LENGTH = 71` (1 + 33 + 33 + 4), `validateAddress` (`src/models/address.ts:94-130`) accepts 25- or 71-byte payloads and checks the first byte against `versionBytes.shielded`, and `getType()` (`src/models/address.ts:148-151`) returns `'shielded'` based on that byte.

Three independent design choices in this format are repo-local inventions with no upstream backing:

1. **Full 33-byte spend pubkey** instead of the RFC's 20-byte `hash(spend_pubkey)` — a deliberate trade (longer address, ~97 base58 chars, but no out-of-band spend-pubkey retrieval needed).
2. **A leading version byte** (`0x3c` / `0x5d`) — the RFC sketch has no version byte at all.
3. **A Base58Check-style 4-byte checksum** wrapping the payload.

Grep confirms `0x3c`/`0x5d` appear as address version bytes nowhere in hathor-core or hathor-ct-crypto (the only `0x5d` hit in core is the unrelated `OP_13` opcode at `hathor/transaction/scripts/opcode.py:71`).

## Source of truth

- **RFC sketch (conflicting):** `SHIELDED_INTEGRATION_REVIEW/reference/rfc-summary.md:11` — "Shielded address format: `scan_pubkey(33) || hash(spend_pubkey)(20)` — compact; full spend pubkey retrieved out-of-band or from chain for some operations." No version byte, no checksum, 53 bytes instead of 71.
- **hathor-core (silent):** hathor-core:hathor/conf/mainnet.py:23-24 defines only `P2PKH_VERSION_BYTE=b'\x28'` and `MULTISIG_VERSION_BYTE=b'\x64'`; there is no shielded address version byte and no mention of `scan_pubkey`/`spend_pubkey`/shielded addresses anywhere in core's Python sources. `hathor/crypto/shielded/` contains only crypto primitives.
- **Consensus is format-agnostic:** on-chain, a shielded output carries only its script, commitments, range proof, and `ephemeral_pubkey` (hathor-core:hathor/transaction/shielded_tx_output.py:70-73 — ECDH recovery operates on `output.ephemeral_pubkey`, never on any address). The address is purely a client-to-client coordination artifact.
- **Client integration guide:** the official SHIELDED-OUTPUTS-CLIENT-GUIDE / checklist never specifies an address format, so there is no normative document a second client could follow.

Because core is silent and the RFC sketches something else, the wallet-lib format is currently defined only by this repo's source code.

## Impact

No current bug: wallet-lib is the only shipping client, and its encoder and decoder agree with each other. The risk is forward-looking interop:

- A wallet-service sender, headless wallet, exchange integration, or third-party wallet that implements the RFC's `scan_pubkey(33) || hash(spend_pubkey)(20)` format would emit 53-byte addresses that wallet-lib rejects (`validateAddress` requires 25 or 71 bytes), and would be unable to parse wallet-lib's 71-byte addresses.
- The `0x3c`/`0x5d` version bytes are not in any registry; another client could legitimately pick different bytes (or none), creating addresses that fail `isVersionByteValid` or, worse, collide with future address types.
- The semantic difference matters too: the RFC's hash-of-spend-pubkey form requires receivers to publish the full spend pubkey out-of-band for some operations; wallet-lib's form embeds it. A client built around the RFC's data-availability assumptions would have a structurally different sending flow.

Since Hathor's ecosystem ships multiple clients off this library (desktop, mobile, headless, wallet-service), the format will become a de-facto standard by deployment — better to make it a de-jure one first.

## Recommendation

Ratify the address format upstream before any second client ships:

1. Update RFC #104 (or a core-adjacent spec / the client integration guide) to specify the actual wire format: `Base58(version(1) || scan_pubkey(33) || spend_pubkey(33) || checksum(4))`, with the rationale for embedding the full spend pubkey (self-contained sending, no out-of-band lookup) — or, if the RFC's compact form is preferred, change wallet-lib to match before release.
2. Register the shielded version bytes (`0x3c` mainnet, `0x5d` testnet/privatenet) alongside `P2PKH_VERSION_BYTE`/`MULTISIG_VERSION_BYTE` in hathor-core settings (even if core never parses them, the settings file is the de-facto version-byte registry) or in an explicit registry document.
3. Add the format, lengths (71 bytes raw / ~97 base58 chars), checksum rule, and version bytes to SHIELDED-OUTPUTS-CLIENT-GUIDE so external integrators implement the same encoding.

## Verification notes

The skeptic panel confirmed all four legs of the claim:

1. **Encoder/decoder convention:** `src/utils/shieldedAddress.ts:28` (doc) and `:53-57` (implementation) produce the 71-byte form; `src/models/address.ts:25,83-84,94-130,148-151` decode and classify it with the same convention — internally consistent.
2. **Version bytes are repo-local:** `0x3c`/`0x5d` defined only at `src/models/network.ts:17,24,31`; grep across hathor-core and hathor-ct-crypto finds no occurrence as an address byte (only the unrelated `OP_13 = 0x5d` opcode at hathor-core:hathor/transaction/scripts/opcode.py:71).
3. **Core is format-agnostic:** hathor-core:hathor/conf/mainnet.py:23-24 registers only P2PKH and MULTISIG version bytes; zero hits for `scan_pubkey`/`spend_pubkey`/`shielded_address` in core Python; consensus consumes only script + `ephemeral_pubkey` (hathor-core:hathor/transaction/shielded_tx_output.py:70-73); the client guide never mentions an address format.
4. **RFC divergence:** `SHIELDED_INTEGRATION_REVIEW/reference/rfc-summary.md:11` sketches `scan_pubkey(33) || hash(spend_pubkey)(20)`, which conflicts in length, content, and version-byte presence.

Severity `info` is appropriate: nothing breaks today, wallet-lib is the only client, and the gap is a standardization/process risk rather than a code defect.

## Evidence folded from the duplicate write-up

- Decode-side layout cite: `src/models/address.ts:185-191` extracts the scan pubkey from bytes `[1..34)` and the spend pubkey from `[34..67)` — the layout is hard-coded on both encode and decode sides with no upstream specification to point to.
