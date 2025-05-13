/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { encoding, util } from 'bitcore-lib';
import _ from 'lodash';
import { AddressError } from '../errors';
import Network from './network';
import P2PKH from './p2pkh';
import P2SH from './p2sh';
import helpers from '../utils/helpers';

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
  validateAddress({ skipNetwork }: { skipNetwork: boolean } = { skipNetwork: false }): boolean {
    const addressBytes = this.decode();
    const errorMessage = `Invalid address: ${this.base58}.`;

    // Validate address length
    if (addressBytes.length !== 25) {
      throw new AddressError(
        `${errorMessage} Address has ${addressBytes.length} bytes and should have 25.`
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
      // Validate version byte. Should be the p2pkh or p2sh
      const firstByte = addressBytes[0];
      if (!this.network.isVersionByteValid(firstByte)) {
        throw new AddressError(
          `${errorMessage} Invalid network byte. Expected: ${this.network.versionBytes.p2pkh} or ${this.network.versionBytes.p2sh} and received ${firstByte}.`
        );
      }
    }
    return true;
  }

  /**
   * Get address type
   *
   * Will check the version byte of the address against the network's version bytes.
   * Valid types are p2pkh and p2sh.
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {string}
   * @memberof Address
   * @inner
   */
  getType(): 'p2pkh' | 'p2sh' {
    this.validateAddress();
    const addressBytes = this.decode();

    const firstByte = addressBytes[0];
    if (firstByte === this.network.versionBytes.p2pkh) {
      return 'p2pkh';
    }
    if (firstByte === this.network.versionBytes.p2sh) {
      return 'p2sh';
    }
    throw new AddressError('Invalid address type.');
  }

  /**
   * Get address script
   *
   * Will get the type of the address (p2pkh or p2sh)
   * then create the script
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {Buffer}
   * @memberof Address
   * @inner
   */
  getScript(): Buffer {
    const addressType = this.getType();
    if (addressType === 'p2pkh') {
      const p2pkh = new P2PKH(this);
      return p2pkh.createScript();
    }
    const p2sh = new P2SH(this);
    return p2sh.createScript();
  }
}

export default Address;
