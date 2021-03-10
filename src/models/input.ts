/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { util } from 'bitcore-lib';
import helpers from '../utils/helpers';

type optionsType = {
  data?: Buffer | null,
};

const defaultOptions = {
  data: null
}

class Input {
  // Hash of the transaction is being spent
  hash: string;
  // Index of the outputs array from the output being spent
  index: number;
  // Input signed data for P2PKH and redeemScript for P2SH
  data: Buffer | null;

  constructor(hash: string, index: number, options: optionsType = defaultOptions) {
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
    arr.push(util.buffer.hexToBuffer(this.hash));
    arr.push(helpers.intToBytes(this.index, 1));
    if (this.data && addData) {
      arr.push(helpers.intToBytes(this.data.length, 2));
      arr.push(this.data);
    } else {
      arr.push(helpers.intToBytes(0, 2));
    }
    return arr;
  }
}

export default Input;
