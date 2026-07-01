# WIRE-04: Address validation does not bind payload length to version byte — 25-byte addresses with the shielded version byte (and 71-byte addresses with p2pkh/p2sh bytes) validate as the wrong type

**Severity:** low - **Status:** confirmed by adversarial review

**Also reported as:** a second WIRE-04 write-up (address-validation length/version-byte binding) — merged here.

## Summary

`Address.validateAddress` checks the decoded length (must be 25 or 71 bytes) and the version byte (must be p2pkh, p2sh, or shielded) as two independent conditions. Any cross combination with a correct checksum passes validation — e.g. a 25-byte address carrying the shielded version byte, or a 71-byte address carrying the p2pkh byte. `getType()` then classifies purely on the version byte, so such addresses are typed as the wrong kind: shielded accessors silently slice short/empty pubkeys out of a 25-byte payload, and a 71-byte "p2pkh" address produces a malformed, unspendable script. Checksums are trivially computable, so these addresses are craftable; validation should reject them up front instead of letting them fail late with confusing errors or burn funds.

## Location

- `src/models/address.ts:94-130` — `validateAddress`: independent length and version-byte checks
- `src/models/address.ts:144-159` — `getType`: keyed purely on first byte
- `src/models/address.ts:185-191`, `202-208` — `getScanPubkey` / `getSpendPubkey`: `subarray` slices without length re-check
- `src/models/address.ts:219-226` — `getSpendAddress`: feeds the (possibly empty) spend pubkey slice to bitcore
- `src/models/network.ts:169-176` — `isVersionByteValid`: accepts any of the three bytes, no length context
- `src/models/p2pkh.ts:67-84` — `createScript`: `addressBytes.slice(1, -4)` assumes a 20-byte hash

## Details

The decoded-length check accepts either format with no correlation to the version byte (`src/models/address.ts:99-106`):

```ts
if (
  addressBytes.length !== LEGACY_ADDR_LENGTH &&        // 25
  addressBytes.length !== SHIELDED_ADDR_LENGTH         // 71
) {
  throw new AddressError(...);
}
```

After the checksum check, the version byte is validated independently (`src/models/address.ts:122-128`) via `Network.isVersionByteValid` (`src/models/network.ts:169-176`), which returns true for any of `p2pkh` (0x28 mainnet / 0x49 testnet), `p2sh` (0x64 / 0x87), or `shielded` (0x3c / 0x5d):

```ts
const firstByte = addressBytes[0];
if (!this.network.isVersionByteValid(firstByte)) {
  throw new AddressError(...);
}
return true;
```

So a checksum-valid 25-byte payload starting with 0x3c (mainnet shielded byte), or a checksum-valid 71-byte payload starting with 0x28 (mainnet p2pkh byte), both pass `validateAddress`. `getType()` (`src/models/address.ts:148-158`) then dispatches solely on the first byte, classifying these as `'shielded'` and `'p2pkh'` respectively.

Consequences per cross combination:

**25-byte payload + shielded version byte → typed `'shielded'`.**
- `getScanPubkey()` (`src/models/address.ts:185-191`) returns `Buffer.from(addressBytes.subarray(1, 34))`. `Buffer.subarray` clamps past the end, so on a 25-byte buffer this silently yields a 24-byte "scan pubkey" instead of throwing.
- `getSpendPubkey()` (`src/models/address.ts:202-208`) returns `subarray(34, 67)` — an empty buffer.
- Real call sites (e.g. `src/new/sendTransaction.ts:1090-1109`, `src/new/wallet.ts:1984-1995`) call `getSpendAddress()` first, which passes the empty buffer to `bitcorePublicKey(...)` (`src/models/address.ts:219-226`); the failure surfaces as an opaque bitcore exception deep inside transaction building, not as an `AddressError` at validation time. Paths that hit the 24-byte scan pubkey instead fail later inside ct-crypto's 33-byte point check.

**71-byte payload + p2pkh version byte → typed `'p2pkh'`.**
- `P2PKH.createScript` (`src/models/p2pkh.ts:67-84`) computes `addressBytes.slice(1, -4)` — 66 bytes instead of the assumed 20 — and emits `OP_DUP OP_HASH160 <push 0x42> <66 bytes> OP_EQUALVERIFY OP_CHECKSIG`. This script is malformed: it fails `P2PKH.identify` (length must be 25 or 31, `src/models/p2pkh.ts:112`) and can never satisfy `OP_EQUALVERIFY` against HASH160's 20-byte output. An output built with it is unspendable; funds sent there are burned.
- The analogous problem applies to a 71-byte payload with the p2sh byte.

The encode side is strict — `encodeShieldedAddress` (`src/utils/shieldedAddress.ts:40-51`) requires both pubkeys to be 33-byte compressed EC points with 0x02/0x03 prefixes — but nothing on the decode/validate side mirrors those constraints. A grep across the integration found no other layer that binds length to version byte: `isShielded()`, `getType()`, and `validateAddress()` are the sole gate for `src/new/sendTransaction.ts`, `src/new/wallet.ts`, `src/utils/address.ts:129-151`, `src/utils/transaction.ts:827`, and `src/storage/storage.ts:333-339`.

## Source of truth

hathor-core defines no shielded address format at all — its network settings only declare transparent version bytes (`hathor-core:hathor/conf/mainnet.py:23-24`, `P2PKH_VERSION_BYTE = b'\x28'`, `MULTISIG_VERSION_BYTE = b'\x64'`). Shielded addresses never appear on-chain (the on-chain script is a plain P2PKH over the spend pubkey hash); the 71-byte `version || scan_pubkey(33) || spend_pubkey(33) || checksum(4)` convention exists only in client code. wallet-lib is therefore the sole enforcement point for this format, which is exactly why its decoder must be strict: there is no consensus-level backstop that would reject a malformed shielded address.

## Impact

- **Who:** any consumer passing externally supplied or corrupted addresses through wallet-lib validation — wallets accepting pasted/QR-scanned addresses, integrators with buggy encoders, or tooling that round-trips addresses.
- **What goes wrong:**
  - A 25-byte address with the shielded byte is reported valid and `'shielded'`, then blows up much later with an opaque bitcore or ct-crypto error during transaction construction instead of a clear `AddressError` at input time.
  - A 71-byte address with the p2pkh/p2sh byte is reported valid and `'p2pkh'`/`'p2sh'`, and the wallet will happily build and send an output with a malformed script — permanently burning the funds.
- **Bounded severity:** an attacker who supplies the address already controls the destination, so this is not a redirection vulnerability; checksum validity means random corruption is overwhelmingly caught. The realistic failure modes are buggy third-party encoders and deliberate confusion-testing — both should be rejected at validation, not produce late errors or unspendable outputs.

## Recommendation

Bind length and version byte bidirectionally in `validateAddress`, and tighten shielded decoding:

```ts
// in validateAddress, after the checksum check:
const firstByte = addressBytes[0];
const isShieldedByte = firstByte === this.network.versionBytes.shielded;
const isLegacyByte =
  firstByte === this.network.versionBytes.p2pkh ||
  firstByte === this.network.versionBytes.p2sh;

if (!isShieldedByte && !isLegacyByte) {
  throw new AddressError(`${errorMessage} Invalid network byte ...`);
}
if (isShieldedByte && addressBytes.length !== SHIELDED_ADDR_LENGTH) {
  throw new AddressError(`${errorMessage} Shielded version byte requires ${SHIELDED_ADDR_LENGTH} bytes.`);
}
if (isLegacyByte && addressBytes.length !== LEGACY_ADDR_LENGTH) {
  throw new AddressError(`${errorMessage} Legacy version byte requires ${LEGACY_ADDR_LENGTH} bytes.`);
}
```

Additionally, in `getScanPubkey`/`getSpendPubkey`, verify the extracted slice is 33 bytes with an 0x02/0x03 prefix (mirroring `encodeShieldedAddress` in `src/utils/shieldedAddress.ts:40-51`), so decode-side guarantees match encode-side guarantees. Add unit tests for both cross combinations (25-byte/shielded-byte and 71-byte/p2pkh-byte, with recomputed checksums) asserting `validateAddress` throws.

## Verification notes

The skeptic panel confirmed the core claim at every cited location: the length check (`src/models/address.ts:99-106`) and version-byte check (`:122-128` via `src/models/network.ts:169-176`) are independent; `getType` (`:148-158`) keys purely on the first byte; `getScanPubkey` (`:185-191`) uses `subarray(1, 34)`, which clamps and returns 24 bytes on a 25-byte payload. An exhaustive grep confirmed no other layer binds length to version byte — `src/utils/shieldedAddress.ts` validates only on encode, and all call sites rely on `isShielded()`/`getType()`. hathor-core defines only transparent version bytes (`hathor-core:hathor/conf/mainnet.py:23-24`), confirming wallet-lib as the sole enforcement point.

Two mechanism details in the original finding were corrected without changing the verdict: (a) for the 71-byte/p2pkh case, `P2PKH.createScript` slices 66 bytes (`slice(1, -4)`, `src/models/p2pkh.ts:70`), not 20, so the result is a malformed unspendable script (funds burned) rather than a "spendable-looking output paying an arbitrary hash" — impact is comparable; (b) for the 25-byte/shielded case, real call sites reach `getSpendAddress()` first, so the typical failure is a bitcore exception on an empty spend-pubkey buffer rather than ct-crypto's 33-byte check. Severity low is appropriate: exploitation requires a crafted or encoder-corrupted address, the supplier of an address controls the destination anyway, and the outcomes are late confusing errors or unspendable outputs rather than fund redirection.

## Evidence folded from the duplicate write-up

- Encode-side contrast: `src/utils/shieldedAddress.ts:40-51` *does* validate component lengths when building shielded addresses — only the decode/validation side fails to bind payload length to the version byte.
