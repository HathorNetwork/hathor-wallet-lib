/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OP_GREATERTHAN_TIMESTAMP, OP_DUP, OP_HASH160, OP_EQUALVERIFY, OP_CHECKSIG } from '../opcodes';
import { util } from 'bitcore-lib';
import helpers from '../utils/helpers';
import Address from './address';

type optionsType = {
  timelock?: number | null | undefined,
};


class P2PKH {
  // Address object of the value destination
  address: Address;
  // Timestamp of the timelock of the output
  timelock: number | null;

  constructor(address: Address, options: optionsType = {}) {
    const defaultOptions = {
      timelock: null,
    };

    const newOptions = Object.assign(defaultOptions, options);
    const { timelock } = newOptions;

    if (!address) {
      throw Error('You must provide an address.');
    }

    this.address = address;
    this.timelock = timelock;
  }

  /**
   * Create a P2PKH script
   *
   * @return {Buffer}
   * @memberof P2PKH
   * @inner
   */
  createScript(): Buffer {
    const arr: Buffer[] = [];
    const addressBytes = this.address.decode();
    const addressHash = addressBytes.slice(1, -4);
    if (this.timelock) {
      let timelockBytes = helpers.intToBytes(this.timelock, 4);
      helpers.pushDataToStack(arr, timelockBytes);
      arr.push(OP_GREATERTHAN_TIMESTAMP);
    }
    arr.push(OP_DUP);
    arr.push(OP_HASH160);
    // addressHash has a fixed size of 20 bytes, so no need to push OP_PUSHDATA1
    arr.push(helpers.intToBytes(addressHash.length, 1));
    arr.push(addressHash);
    arr.push(OP_EQUALVERIFY);
    arr.push(OP_CHECKSIG);
    return util.buffer.concat(arr);
  }
}

export default P2PKH;
