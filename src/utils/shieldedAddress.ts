/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { encoding, HDPublicKey, PublicKey } from 'bitcore-lib';
import Network from '../models/network';
import { COMPRESSED_PUBKEY_SIZE_BYTES } from '../constants';
import helpers from './helpers';
import { publicKeyToP2PKH } from './address';
import type { IShieldedAddressInfo } from '../shielded/types';

/**
 * Assert a buffer is a valid compressed secp256k1 public key: 33 bytes,
 * 02/03 prefix, AND an x-coordinate that decompresses to a point on the
 * curve. The shape checks alone would accept ~50% of random 33-byte
 * buffers (any x without a curve point fails only at decompression), so
 * skipping the curve check lets a malformed address be encoded/sent around
 * and only fail much later, inside the crypto provider, with an opaque
 * error far from the cause.
 *
 * The explicit shape check is NOT redundant with `PublicKey.fromBuffer`:
 * bitcore also accepts 65-byte UNCOMPRESSED keys (04/06/07 prefix), which
 * would silently corrupt the fixed 33-byte slots of the address layout —
 * and its own rejection message for bad shapes is an opaque 'Invalid X'.
 */
export function assertValidCompressedPubkey(pubkey: Buffer, label: string): void {
  if (
    pubkey.length !== COMPRESSED_PUBKEY_SIZE_BYTES ||
    (pubkey[0] !== 0x02 && pubkey[0] !== 0x03)
  ) {
    throw new Error(
      `Invalid ${label}: expected ${COMPRESSED_PUBKEY_SIZE_BYTES}-byte compressed EC point (02/03 prefix), ` +
        `got ${pubkey.length} bytes with prefix 0x${pubkey[0]?.toString(16).padStart(2, '0')}`
    );
  }
  try {
    // bitcore validates curve membership at construction (throws on
    // invalid x / point not on curve).
    PublicKey.fromBuffer(pubkey);
  } catch (e) {
    throw new Error(
      `Invalid ${label}: not a point on the secp256k1 curve (${e instanceof Error ? e.message : e})`
    );
  }
}

/**
 * Encode a shielded address from two public keys.
 * Format: Base58(version_byte(1B) || scan_pubkey(33B) || spend_pubkey(33B) || checksum(4B))
 *
 * @param scanPubkey 33-byte compressed EC public key for scanning (ECDH)
 * @param spendPubkey 33-byte compressed EC public key for spending
 * @param network Network instance
 * @returns Base58-encoded shielded address (~97 characters)
 */
export function encodeShieldedAddress(
  scanPubkey: Buffer,
  spendPubkey: Buffer,
  network: Network
): string {
  assertValidCompressedPubkey(scanPubkey, 'scan pubkey');
  assertValidCompressedPubkey(spendPubkey, 'spend pubkey');
  return encodeShieldedAddressTrusted(scanPubkey, spendPubkey, network);
}

/**
 * Byte assembly of encodeShieldedAddress WITHOUT the on-curve validation.
 * Only for pubkeys we derived ourselves in this module (bitcore's deriveChild
 * can only produce valid curve points) — external/user-supplied pubkeys must
 * go through encodeShieldedAddress, whose curve check catches malformed input
 * early. The validation is expensive (a bitcore point decompression per key),
 * which matters on the address-loading hot path.
 */
function encodeShieldedAddressTrusted(
  scanPubkey: Buffer,
  spendPubkey: Buffer,
  network: Network
): string {
  const versionByte = Buffer.from([network.versionBytes.shielded]);
  const payload = Buffer.concat([versionByte, scanPubkey, spendPubkey]);
  const checksum = helpers.getChecksum(payload);
  const full = Buffer.concat([payload, checksum]);
  return encoding.Base58.encode(full);
}

/**
 * Derive a shielded address at a given BIP32 index from xpub keys.
 *
 * The parent keys may be passed either as xpub strings or as already-parsed
 * HDPublicKey instances. Callers deriving MANY indexes (address loading) should
 * parse once and pass the instances — bitcore's xpub parsing (base58check decode
 * + point decompression) is expensive and identical for every index.
 *
 * @param scanXpubkey xpub (or parsed HDPublicKey) at the scan chain (m/44'/280'/1'/0)
 * @param spendXpubkey xpub (or parsed HDPublicKey) at the spend chain (m/44'/280'/2'/0)
 * @param index BIP32 address index
 * @param networkName Network name (mainnet, testnet, privatenet)
 * @returns Shielded address info
 */
export function deriveShieldedAddress(
  scanXpubkey: string | HDPublicKey,
  spendXpubkey: string | HDPublicKey,
  index: number,
  networkName: string
): IShieldedAddressInfo {
  // Fail loud with a deterministic error: negative/non-integer/hardened-range
  // indexes would otherwise die deep inside bitcore with low-level errors
  // (xpubs cannot derive hardened children, i.e. index >= 2^31).
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error(
      `Invalid BIP32 address index: expected a non-negative integer < 2^31, got ${index}`
    );
  }
  const network = new Network(networkName);

  const scanHdPub = typeof scanXpubkey === 'string' ? new HDPublicKey(scanXpubkey) : scanXpubkey;
  const spendHdPub =
    typeof spendXpubkey === 'string' ? new HDPublicKey(spendXpubkey) : spendXpubkey;

  // Compliant BIP32 derivation. The matching private keys (processing.ts scan,
  // transaction.ts spend) use the same deriveChild, so the ECDH scan keypair and
  // the spend signing key line up with the address.
  const scanKey = scanHdPub.deriveChild(index);
  const spendKey = spendHdPub.deriveChild(index);

  const scanPubkeyBuf: Buffer = scanKey.publicKey.toBuffer();
  const spendPubkeyBuf: Buffer = spendKey.publicKey.toBuffer();

  // Trusted path: these pubkeys came straight out of bitcore's own derivation,
  // so the on-curve re-validation of encodeShieldedAddress is redundant here.
  const base58 = encodeShieldedAddressTrusted(scanPubkeyBuf, spendPubkeyBuf, network);

  // Derive on-chain P2PKH from spend_pubkey
  const spendAddress = publicKeyToP2PKH(spendKey.publicKey, network);

  return {
    base58,
    bip32AddressIndex: index,
    scanPubkey: scanPubkeyBuf.toString('hex'),
    spendPubkey: spendPubkeyBuf.toString('hex'),
    spendAddress,
  };
}
