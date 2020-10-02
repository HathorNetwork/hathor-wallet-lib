/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AddressError } from '../errors';
import { crypto, encoding, util } from 'bitcore-lib';
import defaultNetwork from '../network';
import Network from './network';
import _ from 'lodash';


class Address {
  // String with address as base58
  base58: string;
  // Optional object with network to validate the address
  options?: {network: Network};

  constructor(base58: string, options = {network: defaultNetwork}) {
    const {network} = options;
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
      return this.validateAddress()
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
   * Validate if the address is valid
   *
   * 1. Address must have 25 bytes
   * 2. Address checksum must be valid
   * 3. Address first byte must match one of the options for P2PKH or P2SH
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {boolean}
   * @memberof Address
   * @inner
   */
  validateAddress(): boolean {
    const addressBytes = this.decode();
    const errorMessage = `Invalid address: ${this.base58}`;

    // Validate address length
    if (addressBytes.length !== 25) {
      throw new AddressError(errorMessage);
    }

    // Validate address checksum
    const checksum = addressBytes.slice(-4);
    const addressSlice = addressBytes.slice(0, -4);
    const correctChecksum = this.getChecksum(addressSlice);
    if (!util.buffer.equals(checksum, correctChecksum)) {
      throw new AddressError(errorMessage);
    }

    // Validate version byte. Should be the p2pkh or p2sh
    const firstByte = addressBytes[0];
    if (firstByte !== this.network.getVersionBytes().p2pkh && firstByte !== this.network.getVersionBytes().p2sh) {
      throw new AddressError(errorMessage);
    }
    return true;
  }
  
  /**
   * Return the checksum of the bytes passed
   * Checksum is calculated as the 4 first bytes of the double sha256
   * 
   * @param {Buffer} bytes Data from where the checksum is calculated
   *
   * @return {Buffer}
   * @memberof Address
   * @inner
   */
  getChecksum(bytes: Buffer): Buffer {
    return crypto.Hash.sha256sha256(bytes).slice(0, 4);
  }
}

export default Address;