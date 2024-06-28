/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import _ from 'lodash';
import { hexToBuffer, unpackToInt, unpackToHex, unpackLen, intToBytes } from '../utils/buffer';
import { TX_HASH_SIZE_BYTES } from '../constants';

type optionsType = {
  data?: Buffer | null | undefined;
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
      data: null,
    };
    const newOptions = Object.assign(defaultOptions, options);
    const { data } = newOptions;

    if (!hash) {
      throw Error('You must provide a hash.');
    }

    if (Number.isNaN(index)) {
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
    arr.push(intToBytes(this.index, 1));
    if (this.data && addData) {
      arr.push(intToBytes(this.data.length, 2));
      arr.push(this.data);
    } else {
      arr.push(intToBytes(0, 2));
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
    let hash;
    let index;
    let dataLen;
    let data;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // Hash
    [hash, inputBuffer] = unpackToHex(TX_HASH_SIZE_BYTES, inputBuffer);

    // Index
    [index, inputBuffer] = unpackToInt(1, false, inputBuffer);

    // Data
    [dataLen, inputBuffer] = unpackToInt(2, false, inputBuffer);
    if (dataLen) {
      [data, inputBuffer] = unpackLen(dataLen, inputBuffer);
    }
    /* eslint-enable prefer-const */

    const input = new Input(hash, index, { data });

    return [input, inputBuffer];
  }
}

export default Input;
