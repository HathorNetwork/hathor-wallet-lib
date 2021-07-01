/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { hexToBuffer } from '../utils/buffer';
import helpers from '../utils/helpers';
import { TX_HASH_SIZE_BYTES } from '../constants';
import { unpackToInt, unpackToHex, unpackLen } from '../utils/buffer';
import _ from 'lodash';

type optionsType = {
  data?: Buffer | null | undefined,
};

class Input {
  // Hash of the transaction is being spent
  hash: string;
  // Index of the outputs array from the output being spent
  index: number;
  // Input signed data for P2PKH and redeemScript for P2SH
  data: Buffer | null;

  constructor(hash: string, index: number, options: optionsType = {}) {
    const defaultOptions = {
      data: null
    }
    const newOptions = Object.assign(defaultOptions, options);
    const { data } = newOptions;

    if (!hash) {
      throw Error('You must provide a hash.');
    }

    if (isNaN(index)) {
      throw Error('You must provide an index.');
    }

    this.hash = hash;
    this.index = index;
    this.data = data;
  }

  /**
   * Serialize an input to bytes
   *
   * @param {boolean} addData If should add the input data to the serialization
   * The data is not used to sign/verify the transaction (see https://github.com/HathorNetwork/rfcs/blob/master/text/0015-anatomy-of-tx.md)
   * thus it's important to have this parameter and not add the data to serialization when getting the transaction data to sign
   *
   * @return {Buffer[]}
   * @memberof Input
   * @inner
   */
  serialize(addData: boolean = true): Buffer[] {
    const arr: Buffer[] = [];
    arr.push(hexToBuffer(this.hash));
    arr.push(helpers.intToBytes(this.index, 1));
    if (this.data && addData) {
      arr.push(helpers.intToBytes(this.data.length, 2));
      arr.push(this.data);
    } else {
      arr.push(helpers.intToBytes(0, 2));
    }
    return arr;
  }

  setData(data: Buffer) {
    this.data = data;
  }

  /**
   * Create input object from bytes
   *
   * @param {Buffer} buf Buffer with bytes to get input fields
   *
   * @return {[Input, Buffer]} Created input and rest of buffer bytes
   * @memberof Input
   * @static
   * @inner
   */
  static createFromBytes(buf: Buffer): [Input, Buffer] {
    // Cloning buffer so we don't mutate anything sent by the user
    let inputBuffer = _.clone(buf);
    let hash, index, dataLen, data;

    // Hash
    [hash, inputBuffer] = unpackToHex(TX_HASH_SIZE_BYTES, inputBuffer);

    // Index
    [index, inputBuffer] = unpackToInt(1, false, inputBuffer);

    // Data
    [dataLen, inputBuffer] = unpackToInt(2, false, inputBuffer);
    if (dataLen) {
      [data, inputBuffer] = unpackLen(dataLen, inputBuffer);
    }

    const input = new Input(hash, index, {data});

    return [input, inputBuffer];
  }
}

export default Input;
