/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { encoding, HDPublicKey } from 'bitcore-lib';
import Network from '../models/network';
import helpers from './helpers';
import { publicKeyToP2PKH } from './address';

export interface IShieldedAddressInfo {
  /** Full shielded address in base58 */
  base58: string;
  /** BIP32 index used to derive both scan and spend keys */
  bip32AddressIndex: number;
  /** 33-byte compressed scan pubkey (hex) */
  scanPubkey: string;
  /** 33-byte compressed spend pubkey (hex) */
  spendPubkey: string;
  /** P2PKH address derived from HASH160(spend_pubkey) — the on-chain address */
  spendAddress: string;
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
  if (scanPubkey.length !== 33 || (scanPubkey[0] !== 0x02 && scanPubkey[0] !== 0x03)) {
    throw new Error(
      `Invalid scan pubkey: expected 33-byte compressed EC point (02/03 prefix), ` +
        `got ${scanPubkey.length} bytes with prefix 0x${scanPubkey[0]?.toString(16).padStart(2, '0')}`
    );
  }
  if (spendPubkey.length !== 33 || (spendPubkey[0] !== 0x02 && spendPubkey[0] !== 0x03)) {
    throw new Error(
      `Invalid spend pubkey: expected 33-byte compressed EC point (02/03 prefix), ` +
        `got ${spendPubkey.length} bytes with prefix 0x${spendPubkey[0]?.toString(16).padStart(2, '0')}`
    );
  }

  const versionByte = Buffer.from([network.versionBytes.shielded]);
  const payload = Buffer.concat([versionByte, scanPubkey, spendPubkey]);
  const checksum = helpers.getChecksum(payload);
  const full = Buffer.concat([payload, checksum]);
  return encoding.Base58.encode(full);
}

/**
 * Derive a shielded address at a given BIP32 index from xpub keys.
 *
 * @param scanXpubkey xpub at the scan chain (m/44'/280'/1'/0)
 * @param spendXpubkey xpub at the spend chain (m/44'/280'/2'/0)
 * @param index BIP32 address index
 * @param networkName Network name (mainnet, testnet, privatenet)
 * @returns Shielded address info
 */
export function deriveShieldedAddress(
  scanXpubkey: string,
  spendXpubkey: string,
  index: number,
  networkName: string
): IShieldedAddressInfo {
  const network = new Network(networkName);

  const scanHdPub = new HDPublicKey(scanXpubkey);
  const spendHdPub = new HDPublicKey(spendXpubkey);

  // Standard BIP32 derivation for public keys.
  // Note: private key derivation (in processing.ts) uses deriveNonCompliantChild
  // due to a historical bitcore-lib bug. Do not align these — the asymmetry is intentional.
  const scanKey = scanHdPub.deriveChild(index);
  const spendKey = spendHdPub.deriveChild(index);

  const scanPubkeyBuf: Buffer = scanKey.publicKey.toBuffer();
  const spendPubkeyBuf: Buffer = spendKey.publicKey.toBuffer();

  const base58 = encodeShieldedAddress(scanPubkeyBuf, spendPubkeyBuf, network);

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
