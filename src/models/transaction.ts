/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { crypto as cryptoBL, util } from 'bitcore-lib';
import buffer from 'buffer';
import { clone } from 'lodash';
import crypto from 'crypto';
import {
  BLOCK_VERSION,
  DEFAULT_SIGNAL_BITS,
  CREATE_TOKEN_TX_VERSION,
  DECIMAL_PLACES,
  DEFAULT_TX_VERSION,
  MAX_INPUTS,
  MAX_OUTPUTS,
  MERGED_MINED_BLOCK_VERSION,
  TX_HASH_SIZE_BYTES,
  TX_WEIGHT_CONSTANTS,
} from '../constants';
import {
  bufferToHex,
  hexToBuffer,
  unpackToFloat,
  unpackToHex,
  unpackToInt,
  intToBytes,
  floatToBytes,
} from '../utils/buffer';
import Input from './input';
import Output from './output';
import Network from './network';
import { MaximumNumberInputsError, MaximumNumberOutputsError } from '../errors';
import { OutputValueType } from '../types';
import type Header from '../headers/base';
import NanoContractHeader from '../nano_contracts/header';
import HeaderParser from '../headers/parser';
import { getVertexHeaderIdFromBuffer } from '../headers/types';

enum txType {
  BLOCK = 'Block',
  TRANSACTION = 'Transaction',
  CREATE_TOKEN_TRANSACTION = 'Create Token Transaction',
  MERGED_MINING_BLOCK = 'Merged Mining Block',
}

type optionsType = {
  signalBits?: number;
  version?: number;
  weight?: number;
  nonce?: number;
  timestamp?: number | null;
  parents?: string[];
  tokens?: string[];
  hash?: string | null;
  headers?: Header[];
};

/**
 * Representation of a transaction with helper methods.
 *
 * Besides the class `constructor`, there are some helper methods are available to build instances of this class
 * according to context:
 * - `Transaction.createFromBytes`: creates a transaction from a buffer and a network
 * - `helpers.createTxFromData`: creates from a standard lib data object
 * - `helpers.createTxFromHistoryObject`: creates from a tx populated by the HathorWallet history methods
 */
class Transaction {
  inputs: Input[];

  outputs: Output[];

  signalBits: number;

  version: number;

  weight: number;

  nonce: number;

  timestamp: number | null;

  parents: string[];

  tokens: string[];

  hash: string | null;

  headers: Header[];

  protected _dataToSignCache: Buffer | null;

  constructor(inputs: Input[], outputs: Output[], options: optionsType = {}) {
    const defaultOptions: optionsType = {
      signalBits: DEFAULT_SIGNAL_BITS,
      version: DEFAULT_TX_VERSION,
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null,
      headers: [],
    };
    const newOptions = Object.assign(defaultOptions, options);
    const { signalBits, version, weight, nonce, timestamp, parents, tokens, hash, headers } =
      newOptions;

    this.inputs = inputs;
    this.outputs = outputs;
    this.signalBits = signalBits!;
    this.version = version!;
    this.weight = weight!;
    this.nonce = nonce!;
    this.timestamp = timestamp!;
    this.parents = parents!;
    this.tokens = tokens!;
    this.hash = hash!;
    this.headers = headers!;

    // All inputs sign the same data, so we cache it in the first getDataToSign method call
    this._dataToSignCache = null;
  }

  /**
   * Returns a string with the short version of the tx hash
   * Returns {first12Chars}...{last12Chars}
   *
   * @return {string}
   * @memberof Transaction
   * @inner
   *
   */
  getShortHash(): string {
    return this.hash === null
      ? ''
      : `${this.hash.substring(0, 12)}...${this.hash.substring(52, 64)}`;
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

    const arr: Buffer[] = [];

    this.serializeFundsFields(arr, false);

    for (const header of this.headers) {
      // For the dataToSign we use only the sighash serialization
      header.serializeSighash(arr);
    }

    this._dataToSignCache = util.buffer.concat(arr);
    return this._dataToSignCache!;
  }

  /**
   * Serialize funds fields
   * signal bits, version, len tokens, len inputs, len outputs, tokens array, inputs and outputs
   *
   * @param {Buffer[]} array Array of buffer to push the serialized fields
   * @param {boolean} addInputData If should add input data when serializing it
   *
   * @memberof Transaction
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    // Signal bits
    array.push(intToBytes(this.signalBits, 1));

    // Tx version
    array.push(intToBytes(this.version, 1));

    // Len tokens
    array.push(intToBytes(this.tokens.length, 1));

    // Len of inputs and outputs
    this.serializeFundsFieldsLen(array);

    // Tokens array
    this.serializeTokensArray(array);

    // Inputs and outputs
    this.serializeInputsOutputs(array, addInputData);
  }

  /**
   * Add to buffer array the serialization of the tokens array
   *
   * @memberof Transaction
   * @inner
   */
  serializeTokensArray(array: Buffer[]) {
    // Tokens data
    for (const token of this.tokens) {
      array.push(hexToBuffer(token));
    }
  }

  /**
   * Add to buffer array the serialization of funds fields len (len of inputs and outputs)
   *
   * @memberof Transaction
   * @inner
   */
  serializeFundsFieldsLen(array: Buffer[]) {
    // Len inputs
    array.push(intToBytes(this.inputs.length, 1));

    // Len outputs
    array.push(intToBytes(this.outputs.length, 1));
  }

  /**
   * Add to buffer array the serialization of funds fields (inputs and outputs)
   *
   * @memberof Transaction
   * @inner
   */
  serializeInputsOutputs(array: Buffer[], addInputData: boolean) {
    for (const inputTx of this.inputs) {
      array.push(...inputTx.serialize(addInputData));
    }

    for (const outputTx of this.outputs) {
      array.push(...outputTx.serialize());
    }
  }

  /**
   * Add to buffer array the serialization of graph fields and other serialization fields (weight, timestamp, parents and nonce)
   *
   * @memberof Transaction
   * @inner
   */
  serializeGraphFields(array: Buffer[]) {
    // Now serialize the graph part
    //
    // Weight is a float with 8 bytes
    array.push(floatToBytes(this.weight, 8));
    // Timestamp
    array.push(intToBytes(this.timestamp!, 4));

    if (this.parents) {
      array.push(intToBytes(this.parents.length, 1));
      for (const parent of this.parents) {
        array.push(hexToBuffer(parent));
      }
    } else {
      // Len parents (parents will be calculated in the backend)
      array.push(intToBytes(0, 1));
    }
  }

  /**
   * Serializes nonce
   *
   * @param {Buffer[]} array Array of buffer to push serialized nonce
   *
   * @memberof Transaction
   * @inner
   */
  serializeNonce(array: Buffer[]) {
    // Add nonce in the end
    array.push(intToBytes(this.nonce, 4));
  }

  /**
   * Serializes transaction headers
   *
   * @param {Buffer[]} array Array of buffer to push serialized headers
   *
   * @memberof Transaction
   * @inner
   */
  serializeHeaders(array: Buffer[]) {
    for (const h of this.headers) {
      h.serialize(array);
    }
  }

  /*
   * Execute hash of the data to sign
   *
   * @return {Buffer} data to sign hashed
   *
   * @memberof Transaction
   * @inner
   */
  getDataToSignHash(): Buffer {
    const dataToSign = this.getDataToSign();
    return cryptoBL.Hash.sha256sha256(dataToSign);
  }

  /**
   * Calculate the minimum tx weight
   *
   * @throws {ConstantNotSet} If the weight constants are not set yet
   *
   * @return {number} Minimum weight calculated (float)
   * @memberof Transaction
   * @inner
   */
  calculateWeight(): number {
    let txSize = this.toBytes().length;

    // If parents are not in txData, we need to consider them here
    if (!this.parents || !this.parents.length || this.parents.length === 0) {
      // Parents are always two and have 32 bytes each
      txSize += 64;
    }

    // Here we have to explicitly convert a bigint to a number (a double), which loses precision,
    // but is exactly compatible with the reference Python implementation because of the calculations below.
    let sumOutputs = Number(this.getOutputsSum());

    // Preventing division by 0 when handling authority methods that have no outputs
    sumOutputs = Math.max(1, sumOutputs);

    // We need to take into consideration the decimal places because it is inside the amount.
    // For instance, if one wants to transfer 20 HTRs, the amount will be 2000.
    const amount = sumOutputs / 10 ** DECIMAL_PLACES;

    let weight =
      TX_WEIGHT_CONSTANTS.txWeightCoefficient * Math.log2(txSize) +
      4 / (1 + TX_WEIGHT_CONSTANTS.txMinWeightK / amount) +
      4;

    // Make sure the calculated weight is at least the minimum
    weight = Math.max(weight, TX_WEIGHT_CONSTANTS.txMinWeight);
    // FIXME precision difference between backend and frontend (weight (17.76246721531992) is smaller than the minimum weight (17.762467215319923))
    // Even though it must be fixed, there is no practical effect when mining the transaction
    return weight + 1e-6;
  }

  /**
   * Calculate the sum of outputs. Authority outputs are ignored.
   *
   * @return {number} Sum of outputs
   * @memberof Transaction
   * @inner
   */
  getOutputsSum(): OutputValueType {
    let sumOutputs = 0n;
    for (const output of this.outputs) {
      if (output.isAuthority()) {
        continue;
      }
      sumOutputs += output.value;
    }
    return sumOutputs;
  }

  /**
   * Serialize tx to bytes
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  toBytes(): Buffer {
    const arr: Buffer[] = [];
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Weight, timestamp, parents
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

    // Headers
    this.serializeHeaders(arr);

    return util.buffer.concat(arr);
  }

  /**
   * Validate transaction information.
   * For now, we only verify the maximum number of inputs and outputs.
   *
   * @throws {MaximumNumberInputsError} If the tx has more inputs than the maximum allowed
   * @throws {MaximumNumberOutputsError} If the tx has more outputs than the maximum allowed
   *
   * @memberof Transaction
   * @inner
   */
  validate() {
    if (this.inputs.length > MAX_INPUTS) {
      throw new MaximumNumberInputsError(
        `Transaction has ${this.inputs.length} inputs and can have at most ${MAX_INPUTS}.`
      );
    }

    if (this.outputs.length > MAX_OUTPUTS) {
      throw new MaximumNumberOutputsError(
        `Transaction has ${this.outputs.length} outputs and can have at most ${MAX_OUTPUTS}.`
      );
    }
  }

  /**
   * Get tx data and return it in hexadecimal
   *
   * @return {String} Hexadecimal of a serialized tx
   * @memberof Transaction
   * @inner
   */
  toHex(): string {
    const txBytes = this.toBytes();
    return util.buffer.bufferToHex(txBytes);
  }

  /**
   * Get object type (Transaction or Block)
   *
   * @return {string} Type of the object
   *
   * @memberof Transaction
   * @inner
   */
  getType(): string {
    if (this.isBlock()) {
      if (this.version === BLOCK_VERSION) {
        return txType.BLOCK;
      }
      if (this.version === MERGED_MINED_BLOCK_VERSION) {
        return txType.MERGED_MINING_BLOCK;
      }
    } else {
      if (this.version === DEFAULT_TX_VERSION) {
        return txType.TRANSACTION;
      }
      if (this.version === CREATE_TOKEN_TX_VERSION) {
        return txType.CREATE_TOKEN_TRANSACTION;
      }
    }

    // If there is no match
    return 'Unknown';
  }

  /**
   * Check if object is a block or a transaction
   *
   * @return {boolean} true if object is a block, false otherwise
   *
   * @memberof Transaction
   * @inner
   */
  isBlock(): boolean {
    return this.version === BLOCK_VERSION || this.version === MERGED_MINED_BLOCK_VERSION;
  }

  /**
   * Set tx timestamp and weight
   *
   * @memberof Transaction
   * @inner
   */
  prepareToSend() {
    this.updateTimestamp();
    this.weight = this.calculateWeight();
  }

  /**
   * Update transaction timestamp
   * If timestamp parameter is not sent, we use now
   *
   * @memberof Transaction
   * @inner
   */
  updateTimestamp(timestamp: number | null = null) {
    let timestampToSet = timestamp;
    if (!timestamp) {
      timestampToSet = Math.floor(Date.now() / 1000);
    }
    this.timestamp = timestampToSet;
  }

  /**
   * Gets funds fields (signalBits, version, tokens, inputs, outputs) from bytes
   * and saves them in `this`
   *
   * @param srcBuf Buffer with bytes to get fields
   * @param network Network to get output addresses first byte
   *
   * @return Rest of buffer after getting the fields
   * @memberof Transaction
   * @inner
   */
  getFundsFieldsFromBytes(srcBuf: Buffer, network: Network): Buffer {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Signal bits
    [this.signalBits, buf] = unpackToInt(1, false, buf);

    // Tx version
    [this.version, buf] = unpackToInt(1, false, buf);

    let lenTokens;
    let lenInputs;
    let lenOutputs;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // Len tokens
    [lenTokens, buf] = unpackToInt(1, false, buf);

    // Len inputs
    [lenInputs, buf] = unpackToInt(1, false, buf);

    // Len outputs
    [lenOutputs, buf] = unpackToInt(1, false, buf);
    /* eslint-enable prefer-const */

    // Tokens array
    for (let i = 0; i < lenTokens; i++) {
      let tokenUid;
      [tokenUid, buf] = unpackToHex(TX_HASH_SIZE_BYTES, buf);
      this.tokens.push(tokenUid);
    }

    // Inputs array
    for (let i = 0; i < lenInputs; i++) {
      let input;
      [input, buf] = Input.createFromBytes(buf);
      this.inputs.push(input);
    }

    // Outputs array
    for (let i = 0; i < lenOutputs; i++) {
      let output;
      [output, buf] = Output.createFromBytes(buf, network);
      this.outputs.push(output);
    }

    return buf;
  }

  /**
   * Gets graph fields (weight, timestamp, parents, nonce) from bytes
   * and saves them in `this`
   *
   * @param srcBuf Buffer with bytes to get fields
   *
   * @return Rest of buffer after getting the fields
   * @memberof Transaction
   * @inner
   */
  getGraphFieldsFromBytes(srcBuf: Buffer): Buffer {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Weight
    [this.weight, buf] = unpackToFloat(buf);

    // Timestamp
    [this.timestamp, buf] = unpackToInt(4, false, buf);

    // Parents
    let parentsLen;
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [parentsLen, buf] = unpackToInt(1, false, buf);

    for (let i = 0; i < parentsLen; i++) {
      let p;
      [p, buf] = unpackToHex(TX_HASH_SIZE_BYTES, buf);
      this.parents.push(p);
    }

    // Nonce
    [this.nonce, buf] = unpackToInt(4, false, buf);

    return buf;
  }

  /**
   * Gets headers objects from bytes
   * and pushes them in `this.headers`
   *
   * @param srcBuf Buffer with bytes to get headers data
   * @param network Network used to deserialize headers
   *
   * @return Rest of buffer after getting the fields
   * @memberof Transaction
   * @inner
   */
  getHeadersFromBytes(srcBuf: Buffer, network: Network): void {
    // Creates a new subarray buffer not to change anything of the source buffer
    let buf = srcBuf.subarray();

    if (srcBuf.length <= 1) {
      // We need 1 byte for the header type and more for the header itself
      return;
    }

    // The header serialization doesn't have the headers length
    // so we must exhaust the buffer until it's empty
    // or we will throw an error
    while (buf.length > 0) {
      const headerId = getVertexHeaderIdFromBuffer(buf);
      const headerClass = HeaderParser.getHeader(headerId);
      let header;
      // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
      [header, buf] = headerClass.deserialize(buf, network);

      this.headers.push(header);
    }
  }

  /**
   * Create transaction object from bytes
   *
   * @param {Buffer} buf Buffer with bytes to get transaction fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {Transaction} Transaction object
   * @memberof Transaction
   * @static
   * @inner
   */
  static createFromBytes(buf: Buffer, network: Network): Transaction {
    const tx = new Transaction([], []);

    // Cloning buffer so we don't mutate anything sent by the user
    // as soon as it's available natively we should use an immutable buffer
    let txBuffer = clone(buf);

    txBuffer = tx.getFundsFieldsFromBytes(txBuffer, network);
    txBuffer = tx.getGraphFieldsFromBytes(txBuffer);

    // The header serialization doesn't have the headers length
    // so we must exhaust the buffer until it's empty
    // or we will throw an error
    tx.getHeadersFromBytes(txBuffer, network);

    tx.updateHash();

    return tx;
  }

  /**
   * Get funds fields hash to be used when calculating the tx hash
   *
   * @return The sha256 hash digest
   * @memberof Transaction
   * @inner
   */
  getFundsHash(): Buffer {
    const arrFunds = [];
    this.serializeFundsFields(arrFunds, true);
    const fundsHash = crypto.createHash('sha256');
    fundsHash.update(buffer.Buffer.concat(arrFunds));
    return fundsHash.digest();
  }

  /**
   * Get graph and headers fields hash to be used when calculating the tx hash
   *
   * @return The sha256 hash digest
   * @memberof Transaction
   * @inner
   */
  getGraphAndHeadersHash() {
    const arrGraph = [];
    this.serializeGraphFields(arrGraph);
    const hash = crypto.createHash('sha256');
    hash.update(buffer.Buffer.concat(arrGraph));

    if (this.headers.length !== 0) {
      // The hathor-core method returns b'' here if there are no headers
      const arrHeaders = [];
      this.serializeHeaders(arrHeaders);
      hash.update(buffer.Buffer.concat(arrHeaders));
    }

    return hash.digest();
  }

  /**
   * Calculate first part of transaction hash
   *
   * @return {object} Sha256 hash object of part1
   *
   * @memberof Transaction
   * @inner
   */
  calculateHashPart1(): crypto.Hash {
    const digestedFunds = this.getFundsHash();
    const digestedGraphAndHeaders = this.getGraphAndHeadersHash();

    const bufferPart1 = buffer.Buffer.concat([digestedFunds, digestedGraphAndHeaders]);

    const part1 = crypto.createHash('sha256');
    part1.update(bufferPart1);

    return part1;
  }

  /**
   * Calculate transaction hash from part1
   *
   * @return {Buffer} Transaction hash in bytes
   *
   * @memberof Transaction
   * @inner
   */
  calculateHashPart2(part1: crypto.Hash): Buffer {
    const arrNonce = [];
    this.serializeNonce(arrNonce);

    const bufferFill = buffer.Buffer.alloc(12);
    const fullNonceBytes = buffer.Buffer.concat([bufferFill, buffer.Buffer.concat(arrNonce)]);

    part1.update(fullNonceBytes);

    const part2 = crypto.createHash('sha256');
    part2.update(part1.digest());

    return part2.digest().reverse();
  }

  /**
   * Calculate transaction hash and return it
   *
   * @return {string} Transaction hash in hexadecimal
   *
   * @memberof Transaction
   * @inner
   */
  calculateHash(): string {
    const hashPart1 = this.calculateHashPart1();
    const hashPart2 = this.calculateHashPart2(hashPart1);

    return bufferToHex(hashPart2);
  }

  /**
   * Update transaction hash
   *
   * @memberof Transaction
   * @inner
   */
  updateHash() {
    this.hash = this.calculateHash();
  }

  /**
   * Return if the tx is a nano contract (if it has nano header)
   *
   * @return If the transaction object is a nano contract
   *
   * @memberof Transaction
   * @inner
   */
  isNanoContract(): boolean {
    const nanoHeaders = this.getNanoHeaders();

    if (nanoHeaders.length === 0) return false;

    return true;
  }

  /**
   * Get the nano contract header from the list of headers.
   *
   * @throws NanoHeaderNotFound in case the tx does not have a nano header
   *
   * @return The nano header object
   *
   * @memberof Transaction
   * @inner
   */
  getNanoHeaders(): NanoContractHeader[] {
    return NanoContractHeader.getHeadersFromTx(this);
  }
}

export default Transaction;
