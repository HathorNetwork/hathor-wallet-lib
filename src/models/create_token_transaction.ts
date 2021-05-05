/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { CREATE_TOKEN_TX_VERSION, TOKEN_INFO_VERSION } from '../constants';
import { encoding, util } from 'bitcore-lib';
import helpers from '../utils/helpers';
import Input from './input';
import Output from './output';
import Transaction from './transaction';
import { CreateTokenTxInvalid } from '../errors';
import buffer from 'buffer';

type optionsType = {
  weight?: number,
  nonce?: number,
  timestamp?: number | null,
  parents?: string[],
  tokens?: string[],
  hash?: string | null,
  name?: string | null,
  symbol?: string | null,
};

const defaultOptions: optionsType = {
  weight: 0,
  nonce: 0,
  timestamp: null,
  parents: [],
  tokens: [],
  hash: null,
  name: null,
  symbol: null,
}

class CreateTokenTransaction extends Transaction {
  name: string | null;
  symbol: string | null;

  constructor(inputs: Input[], outputs: Output[], options: optionsType = defaultOptions) {
    const newOptions = Object.assign(defaultOptions, options);
    const { name, symbol } = newOptions;

    super(inputs, outputs, newOptions);
    this.name = name!;
    this.symbol = symbol!;
  }

  /**
   * Return transaction data to sign in inputs
   * 
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  getDataToSign(): Buffer {
    if (this._dataToSignCache !== null) {
      return this._dataToSignCache!;
    }

    let arr: any[] = []
    // Tx version
    arr.push(helpers.intToBytes(this.version, 2))

    // Funds len and fields
    this.serializeFundsFieldsLen(arr);
    this.serializeFundsFields(arr, false);

    // Create token tx need to add extra information
    arr = [...arr, ...this.serializeTokenInfo()];

    this._dataToSignCache = util.buffer.concat(arr);
    return this._dataToSignCache!;
  }

  /**
   * Serialize tx to bytes
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  toBytes(): Buffer {
    let arr: any = []
    // Serialize first the funds part
    //
    // Tx version
    arr.push(helpers.intToBytes(this.version, 2))

    // Funds len and fields
    this.serializeFundsFieldsLen(arr);
    this.serializeFundsFields(arr, true);

    // Create token tx need to add extra information
    arr = [...arr, ...this.serializeTokenInfo()];

    // Graph fields
    this.serializeGraphFields(arr);

    return util.buffer.concat(arr);
  }

  /**
   * Serialize create token tx info to bytes
   *
   * @return {Array} array of bytes
   * @memberof Transaction
   * @inner
   */
  serializeTokenInfo(): Buffer[] {
    if (!(this.name) || !(this.symbol)) {
      throw new CreateTokenTxInvalid('Token name and symbol are required when creating a new token');
    }

    const nameBytes = buffer.Buffer.from(this.name, 'utf8');
    const symbolBytes = buffer.Buffer.from(this.symbol, 'utf8');
    const arr: any[] = [];
    // Token info version
    arr.push(helpers.intToBytes(TOKEN_INFO_VERSION, 1));
    // Token name size
    arr.push(helpers.intToBytes(nameBytes.length, 1));
    // Token name
    arr.push(nameBytes);
    // Token symbol size
    arr.push(helpers.intToBytes(symbolBytes.length, 1));
    // Token symbol
    arr.push(symbolBytes);
    return arr;
  }
}

export default CreateTokenTransaction;