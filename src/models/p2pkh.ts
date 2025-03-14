/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { util } from 'bitcore-lib';
import {
  OP_GREATERTHAN_TIMESTAMP,
  OP_DUP,
  OP_HASH160,
  OP_EQUALVERIFY,
  OP_CHECKSIG,
} from '../opcodes';
import { intToBytes } from '../utils/buffer';
import helpers from '../utils/helpers';
import Address from './address';
import { IHistoryOutputDecoded } from '../types';

type optionsType = {
  timelock?: number | null | undefined;
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
   * Get script type
   *
   * @return {string}
   * @memberof P2PKH
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this -- This method returns a hardcoded constant
  getType(): 'p2pkh' {
    return 'p2pkh';
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
      const timelockBytes = intToBytes(this.timelock, 4);
      helpers.pushDataToStack(arr, timelockBytes);
      arr.push(OP_GREATERTHAN_TIMESTAMP);
    }
    arr.push(OP_DUP);
    arr.push(OP_HASH160);
    // addressHash has a fixed size of 20 bytes, so no need to push OP_PUSHDATA1
    arr.push(intToBytes(addressHash.length, 1));
    arr.push(addressHash);
    arr.push(OP_EQUALVERIFY);
    arr.push(OP_CHECKSIG);
    return util.buffer.concat(arr);
  }

  /**
   * Build the original decoded script
   */
  toData(): IHistoryOutputDecoded {
    return {
      type: this.getType().toUpperCase(),
      address: this.address.base58,
      timelock: this.timelock,
    };
  }

  /**
   * Identify a script as P2PKH or not.
   *
   * @param {Buffer} buf Script as buffer.
   *
   * @return {Boolean}
   * @memberof P2PKH
   * @inner
   */
  static identify(buf: Buffer): boolean {
    const op_greaterthan_timestamp = OP_GREATERTHAN_TIMESTAMP.readUInt8(0);
    const op_dup = OP_DUP.readUInt8(0);
    const op_hash160 = OP_HASH160.readUInt8(0);
    const op_equalverify = OP_EQUALVERIFY.readUInt8(0);
    const op_checksig = OP_CHECKSIG.readUInt8(0);
    if (buf.length !== 31 && buf.length !== 25) {
      // this is not a P2PKH script
      return false;
    }
    let ptr = 0;
    if (buf.length === 31) {
      // with timelock, we begin with timestamp
      if (buf.readUInt8(ptr++) !== 4) {
        return false;
      }
      ptr += 4;
      // next byte is OP_GREATERTHAN_TIMESTAMP
      if (buf.readUInt8(ptr++) !== op_greaterthan_timestamp) {
        return false;
      }
    }

    // OP_DUP OP_HASH160
    if (buf.readUInt8(ptr++) !== op_dup || buf.readUInt8(ptr++) !== op_hash160) {
      return false;
    }
    // address hash
    if (buf.readUInt8(ptr++) !== 20) {
      return false;
    }
    ptr += 20;
    // OP_EQUALVERIFY OP_CHECKSIG
    if (buf.readUInt8(ptr++) !== op_equalverify || buf.readUInt8(ptr++) !== op_checksig) {
      return false;
    }
    return true;
  }
}

export default P2PKH;
