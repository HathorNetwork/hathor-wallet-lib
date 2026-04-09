/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { crypto, encoding, util, Address as BitcoreAddress, PublicKey as bitcorePublicKey } from 'bitcore-lib';
import _ from 'lodash';
import { AddressError } from '../errors';
import Network from './network';
import P2PKH from './p2pkh';
import P2SH from './p2sh';
import helpers from '../utils/helpers';

/** Valid address types */
export type AddressType = 'p2pkh' | 'p2sh' | 'shielded';

/** Shielded address payload length: 1B version + 33B scan + 33B spend = 67B + 4B checksum = 71B */
const SHIELDED_ADDR_LENGTH = 71;
/** Legacy address payload length: 1B version + 20B hash + 4B checksum = 25B */
const LEGACY_ADDR_LENGTH = 25;

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
    if (addressBytes.length !== LEGACY_ADDR_LENGTH && addressBytes.length !== SHIELDED_ADDR_LENGTH) {
      throw new AddressError(
        `${errorMessage} Address has ${addressBytes.length} bytes and should have ${LEGACY_ADDR_LENGTH} or ${SHIELDED_ADDR_LENGTH}.`
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
    } catch {
      return false;
    }
  }

  /**
   * Extract the 33-byte scan pubkey from a shielded address.
   * Bytes [1..34) of the decoded address.
   *
   * @throws {AddressError} If address is not shielded
   * @return {Buffer} 33-byte compressed EC public key
   * @memberof Address
   * @inner
   */
  getScanPubkey(): Buffer {
    if (!this.isShielded()) {
      throw new AddressError('Not a shielded address');
    }
    const addressBytes = this.decode();
    return Buffer.from(addressBytes.subarray(1, 34));
  }

  /**
   * Extract the 33-byte spend pubkey from a shielded address.
   * Bytes [34..67) of the decoded address.
   *
   * @throws {AddressError} If address is not shielded
   * @return {Buffer} 33-byte compressed EC public key
   * @memberof Address
   * @inner
   */
  getSpendPubkey(): Buffer {
    if (!this.isShielded()) {
      throw new AddressError('Not a shielded address');
    }
    const addressBytes = this.decode();
    return Buffer.from(addressBytes.subarray(34, 67));
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
