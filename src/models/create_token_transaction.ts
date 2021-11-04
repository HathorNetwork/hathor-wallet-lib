/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { CREATE_TOKEN_TX_VERSION, TOKEN_INFO_VERSION, MAX_TOKEN_NAME_SIZE, MAX_TOKEN_SYMBOL_SIZE } from '../constants';
import { encoding, util } from 'bitcore-lib';
import { unpackToInt, unpackLen } from '../utils/buffer';
import helpers from '../utils/helpers';
import Input from './input';
import Output from './output';
import Transaction from './transaction';
import Network from './network';
import { CreateTokenTxInvalid } from '../errors';
import buffer from 'buffer';
import { clone } from 'lodash';

type optionsType = {
  weight?: number,
  nonce?: number,
  timestamp?: number | null,
  parents?: string[],
  tokens?: string[],
  hash?: string | null,
};


class CreateTokenTransaction extends Transaction {
  name: string;
  symbol: string;

  constructor(name: string, symbol: string, inputs: Input[], outputs: Output[], options: optionsType = {}) {
    const defaultOptions: optionsType = {
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null,
    };
    const newOptions = Object.assign(defaultOptions, options);

    super(inputs, outputs, newOptions);
    this.version = CREATE_TOKEN_TX_VERSION;
    this.name = name;
    this.symbol = symbol;
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
    this.serializeFundsFields(arr, false);

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
    this.serializeFundsFields(arr, true);

    // Graph fields
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

    return util.buffer.concat(arr);
  }

  /**
   * Serialize funds fields
   * version, len inputs, len outputs, inputs, outputs and token info
   *
   * @param {Buffer[]} array Array of buffer to push the serialized fields
   * @param {boolean} addInputData If should add input data when serializing it
   *
   * @memberof Transaction
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    // Tx version
    array.push(helpers.intToBytes(this.version, 2))

    // Funds len and fields
    this.serializeFundsFieldsLen(array);
    this.serializeInputsOutputs(array, addInputData);

    // Create token tx need to add extra information
    this.serializeTokenInfo(array);
  }

  /**
   * Serialize create token tx info to bytes
   *
   * @return {Array} array of bytes
   * @memberof Transaction
   * @inner
   */
  serializeTokenInfo(array: Buffer[]) {
    if (!(this.name) || !(this.symbol)) {
      throw new CreateTokenTxInvalid('Token name and symbol are required when creating a new token');
    }

    if (this.name.length > MAX_TOKEN_NAME_SIZE) {
      throw new CreateTokenTxInvalid(`Token name size is ${this.name.length} but maximum size is ${MAX_TOKEN_NAME_SIZE}`);
    }

    if (this.symbol.length > MAX_TOKEN_SYMBOL_SIZE) {
      throw new CreateTokenTxInvalid(`Token symbol size is ${this.symbol.length} but maximum size is ${MAX_TOKEN_SYMBOL_SIZE}`);
    }

    const nameBytes = buffer.Buffer.from(this.name, 'utf8');
    const symbolBytes = buffer.Buffer.from(this.symbol, 'utf8');
    // Token info version
    array.push(helpers.intToBytes(TOKEN_INFO_VERSION, 1));
    // Token name size
    array.push(helpers.intToBytes(nameBytes.length, 1));
    // Token name
    array.push(nameBytes);
    // Token symbol size
    array.push(helpers.intToBytes(symbolBytes.length, 1));
    // Token symbol
    array.push(symbolBytes);
  }

  getTokenInfoFromBytes(buf: Buffer): Buffer {
    let tokenInfoVersion, lenName, lenSymbol, bufName, bufSymbol;

    [tokenInfoVersion, buf] = unpackToInt(1, false, buf);

    if (tokenInfoVersion !== TOKEN_INFO_VERSION) {
      throw new CreateTokenTxInvalid(`Unknown token info version: ${tokenInfoVersion}`);
    }

    [lenName, buf] = unpackToInt(1, false, buf);

    if (lenName > MAX_TOKEN_NAME_SIZE) {
      throw new CreateTokenTxInvalid(`Token name size is ${lenName} but maximum size is ${MAX_TOKEN_NAME_SIZE}`);
    }

    [bufName, buf] = unpackLen(lenName, buf);
    this.name = bufName.toString('utf-8');


    [lenSymbol, buf] = unpackToInt(1, false, buf);

    if (lenSymbol > MAX_TOKEN_SYMBOL_SIZE) {
      throw new CreateTokenTxInvalid(`Token symbol size is ${lenSymbol} but maximum size is ${MAX_TOKEN_SYMBOL_SIZE}`);
    }

    [bufSymbol, buf] = unpackLen(lenSymbol, buf);
    this.symbol = bufSymbol.toString('utf-8');

    return buf;
  }

  /**
   * Gets funds fields (version, inputs, outputs) from bytes
   * and saves them in `this`
   *
   * @param {Buffer} buf Buffer with bytes to get fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {Buffer} Rest of buffer after getting the fields
   * @memberof CreateTokenTransaction
   * @inner
   */
  getFundsFieldsFromBytes(buf: Buffer, network: Network): Buffer {
    // Tx version
    [this.version, buf] = unpackToInt(2, false, buf);

    let lenInputs, lenOutputs;

    // Len inputs
    [lenInputs, buf] = unpackToInt(1, false, buf);

    // Len outputs
    [lenOutputs, buf] = unpackToInt(1, false, buf);

    // Inputs array
    for (let i=0; i<lenInputs; i++) {
      let input;
      [input, buf] = Input.createFromBytes(buf);
      this.inputs.push(input);
    }

    // Outputs array
    for (let i=0; i<lenOutputs; i++) {
      let output;
      [output, buf] = Output.createFromBytes(buf, network);
      this.outputs.push(output);
    }

    return buf;
  }

  /**
   * Create transaction object from bytes
   *
   * @param {Buffer} buf Buffer with bytes to get transaction fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {CreateTokenTransaction} Transaction object
   * @memberof CreateTokenTransaction
   * @static
   * @inner
   */
  static createFromBytes(buf: Buffer, network: Network): CreateTokenTransaction {
    const tx = new CreateTokenTransaction('', '', [], []);

    // Cloning buffer so we don't mutate anything sent by the user
    // as soon as it's available natively we should use an immutable buffer
    let txBuffer = clone(buf);

    txBuffer = tx.getFundsFieldsFromBytes(txBuffer, network);
    txBuffer = tx.getTokenInfoFromBytes(txBuffer);
    tx.getGraphFieldsFromBytes(txBuffer);

    tx.updateHash();

    return tx;
  }
}

export default CreateTokenTransaction;