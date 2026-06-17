/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  encoding,
  util,
  Address as BitcoreAddress,
  PublicKey as bitcorePublicKey,
} from 'bitcore-lib';
import _ from 'lodash';
import { AddressError } from '../errors';
import Network from './network';
import P2PKH from './p2pkh';
import P2SH from './p2sh';
import helpers from '../utils/helpers';
import {
  COMPRESSED_PUBKEY_SIZE_BYTES,
  LEGACY_ADDRESS_SIZE_BYTES,
  SHIELDED_ADDRESS_SIZE_BYTES,
} from '../constants';
import type { AddressType } from '../types';
import type { IShieldedAddressParts } from '../shielded/types';

// Re-export so existing `import { AddressType } from 'models/address'`
// consumers keep working; the canonical home is src/types.ts.
export type { AddressType };

// Shielded address layout offsets, derived from the pubkey size so the
// 33-byte width is stated once: version(1) | scan(33) | spend(33) | checksum(4)
const SCAN_PUBKEY_START = 1;
const SCAN_PUBKEY_END = SCAN_PUBKEY_START + COMPRESSED_PUBKEY_SIZE_BYTES;
const SPEND_PUBKEY_END = SCAN_PUBKEY_END + COMPRESSED_PUBKEY_SIZE_BYTES;

class Address {
  // String with address as base58
  base58: string;

  // Network to validate the address
  network: Network;

  constructor(base58: string, options = { network: new Network('testnet') }) {
    const { network } = options;

    if (!_.isString(base58)) {
      throw Error('Parameter should be a string.');
    }

    this.base58 = base58;
    this.network = network;
  }

  /**
   * Check if address is a valid string
   *
   * @return {boolean} If address is valid
   * @memberof Address
   * @inner
   */
  isValid(): boolean {
    try {
      return this.validateAddress();
    } catch (e) {
      if (e instanceof AddressError) {
        return false;
      }
      throw e;
    }
  }

  /**
   * Decode address in base58 to bytes
   *
   * @return {Buffer} address in bytes
   * @memberof Address
   * @inner
   */
  decode(): Buffer {
    try {
      return encoding.Base58.decode(this.base58);
    } catch (e) {
      throw new AddressError('Invalid base58 address');
    }
  }

  /**
   * Validate address
   *
   * Supports both legacy 25-byte addresses and 71-byte shielded addresses.
   * 1. Address must have 25 bytes (legacy) or 71 bytes (shielded)
   * 2. Address checksum must be valid
   * 3. Address first byte must match one of the valid version bytes
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {boolean}
   * @memberof Address
   * @inner
   */
  validateAddress({ skipNetwork }: { skipNetwork: boolean } = { skipNetwork: false }): boolean {
    const addressBytes = this.decode();
    const errorMessage = `Invalid address: ${this.base58}.`;

    // Validate address length
    if (
      addressBytes.length !== LEGACY_ADDRESS_SIZE_BYTES &&
      addressBytes.length !== SHIELDED_ADDRESS_SIZE_BYTES
    ) {
      throw new AddressError(
        `${errorMessage} Address has ${addressBytes.length} bytes and should have ${LEGACY_ADDRESS_SIZE_BYTES} or ${SHIELDED_ADDRESS_SIZE_BYTES}.`
      );
    }

    // Validate address checksum
    const checksum = addressBytes.subarray(-4);
    const addressSlice = addressBytes.subarray(0, -4);
    const correctChecksum = helpers.getChecksum(addressSlice);
    if (!util.buffer.equals(checksum, correctChecksum)) {
      throw new AddressError(
        `${errorMessage} Invalid checksum. Expected: ${correctChecksum} != Received: ${checksum}.`
      );
    }

    if (skipNetwork) {
      return true;
    }

    // Validate version byte
    const firstByte = addressBytes[0];
    if (!this.network.isVersionByteValid(firstByte)) {
      throw new AddressError(
        `${errorMessage} Invalid network byte. Expected: ${this.network.versionBytes.p2pkh}, ${this.network.versionBytes.p2sh}, or ${this.network.versionBytes.shielded} and received ${firstByte}.`
      );
    }

    // Cross-check length against version byte: the length and version-byte
    // checks above are individually necessary but not jointly sufficient —
    // without this, a crafted 25-byte address carrying the shielded version
    // byte (or a 71-byte one carrying a legacy byte) validates, and the
    // pubkey extractors would silently clamp `subarray` reads on the short
    // buffer. Note this runs only when the network is known (not under
    // `skipNetwork`), since the byte→length mapping is network-defined.
    //
    // Each valid version byte maps explicitly to its family's decoded
    // length. `firstByte` is guaranteed present by isVersionByteValid above,
    // but a future address family added to the network without an entry
    // here must fail loudly rather than silently default to a length.
    const sizeByVersionByte: Record<number, number> = {
      [this.network.versionBytes.p2pkh]: LEGACY_ADDRESS_SIZE_BYTES,
      [this.network.versionBytes.p2sh]: LEGACY_ADDRESS_SIZE_BYTES,
      [this.network.versionBytes.shielded]: SHIELDED_ADDRESS_SIZE_BYTES,
    };
    const expectedLength = sizeByVersionByte[firstByte];
    if (expectedLength === undefined) {
      throw new AddressError(
        `${errorMessage} No decoded length registered for version byte ${firstByte}.`
      );
    }
    if (addressBytes.length !== expectedLength) {
      throw new AddressError(
        `${errorMessage} Version byte ${firstByte} requires ${expectedLength} bytes, got ${addressBytes.length}.`
      );
    }
    return true;
  }

  /**
   * Get address type
   *
   * Will check the version byte of the address against the network's version bytes.
   * Valid types are p2pkh, p2sh, and shielded.
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {AddressType}
   * @memberof Address
   * @inner
   */
  getType(): AddressType {
    this.validateAddress();
    const addressBytes = this.decode();

    const firstByte = addressBytes[0];
    if (firstByte === this.network.versionBytes.shielded) {
      return 'shielded';
    }
    if (firstByte === this.network.versionBytes.p2pkh) {
      return 'p2pkh';
    }
    if (firstByte === this.network.versionBytes.p2sh) {
      return 'p2sh';
    }
    throw new AddressError('Invalid address type.');
  }

  /**
   * Check if this is a shielded address (71-byte format with scan + spend pubkeys)
   *
   * @return {boolean}
   * @memberof Address
   * @inner
   */
  isShielded(): boolean {
    try {
      return this.getType() === 'shielded';
    } catch (e) {
      // Only AddressError means "structurally not a shielded address".
      // Anything else is an unexpected failure that must not be silently
      // converted into a misleading `false`.
      if (e instanceof AddressError) {
        return false;
      }
      throw e;
    }
  }

  /**
   * Split a shielded address into its structural parts:
   * version(1) | scan_pubkey(33) | spend_pubkey(33) | checksum(4).
   *
   * Single decode + on-curve validation of BOTH embedded pubkeys; the
   * individual getters delegate here. Note this is stricter than
   * extracting one key in isolation: an address with ANY invalid key is
   * invalid as a whole, so both are checked regardless of which part the
   * caller wants.
   *
   * @throws {AddressError} If address is not shielded or a pubkey is not
   *   a point on the secp256k1 curve
   * @return {IShieldedAddressParts}
   * @memberof Address
   * @inner
   */
  parseShielded(): IShieldedAddressParts {
    if (!this.isShielded()) {
      throw new AddressError('Not a shielded address');
    }
    const addressBytes = this.decode();
    const parts: IShieldedAddressParts = {
      versionByte: addressBytes[0],
      scanPubkey: Buffer.from(addressBytes.subarray(SCAN_PUBKEY_START, SCAN_PUBKEY_END)),
      spendPubkey: Buffer.from(addressBytes.subarray(SCAN_PUBKEY_END, SPEND_PUBKEY_END)),
      checksum: Buffer.from(addressBytes.subarray(SPEND_PUBKEY_END)),
    };
    this.assertOnCurve(parts.scanPubkey, 'scan pubkey');
    this.assertOnCurve(parts.spendPubkey, 'spend pubkey');
    return parts;
  }

  /**
   * Extract the 33-byte scan pubkey from a shielded address.
   *
   * @throws {AddressError} If address is not shielded or carries an
   *   invalid pubkey (see parseShielded)
   * @return {Buffer} 33-byte compressed EC public key
   * @memberof Address
   * @inner
   */
  getScanPubkey(): Buffer {
    return this.parseShielded().scanPubkey;
  }

  /**
   * Extract the 33-byte spend pubkey from a shielded address.
   *
   * @throws {AddressError} If address is not shielded or carries an
   *   invalid pubkey (see parseShielded)
   * @return {Buffer} 33-byte compressed EC public key
   * @memberof Address
   * @inner
   */
  getSpendPubkey(): Buffer {
    return this.parseShielded().spendPubkey;
  }

  /**
   * Assert an extracted pubkey decompresses to a point on the secp256k1
   * curve. Base58 checksum only protects against transmission corruption —
   * a deliberately crafted address can carry a 02/03-prefixed buffer whose
   * x-coordinate has no curve point. Without this check such a key only
   * fails much later (inside the crypto provider for scan keys, or inside
   * bitcore for spend keys) with an opaque error far from the cause.
   *
   * @throws {AddressError} If the pubkey is not a valid curve point
   */
  private assertOnCurve(pubkey: Buffer, label: string): void {
    try {
      // bitcore validates curve membership at construction.
      bitcorePublicKey.fromBuffer(pubkey);
    } catch (e) {
      throw new AddressError(
        `Invalid address: ${this.base58}. The ${label} is not a point on the secp256k1 curve.`
      );
    }
  }

  /**
   * Derive the on-chain P2PKH address from the spend_pubkey of a shielded address.
   * This is the address that appears on-chain in the shielded output script.
   *
   * @throws {AddressError} If address is not shielded
   * @return {Address} The P2PKH address derived from HASH160(spend_pubkey)
   * @memberof Address
   * @inner
   */
  getSpendAddress(): Address {
    const spendPubkey = this.getSpendPubkey();
    const base58 = new BitcoreAddress(
      bitcorePublicKey(spendPubkey),
      this.network.bitcoreNetwork
    ).toString();
    return new Address(base58, { network: this.network });
  }

  /**
   * Get address script
   *
   * Will get the type of the address (p2pkh, p2sh, or shielded)
   * then create the script.
   * For shielded addresses, creates a P2PKH script from the spend_pubkey.
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {Buffer}
   * @memberof Address
   * @inner
   */
  getScript(): Buffer {
    const addressType = this.getType();
    if (addressType === 'shielded') {
      // For shielded addresses, derive P2PKH script from spend_pubkey
      const spendAddress = this.getSpendAddress();
      const p2pkh = new P2PKH(spendAddress);
      return p2pkh.createScript();
    }
    if (addressType === 'p2pkh') {
      const p2pkh = new P2PKH(this);
      return p2pkh.createScript();
    }
    const p2sh = new P2SH(this);
    return p2sh.createScript();
  }
}

export default Address;
