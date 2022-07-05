/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BLOCK_VERSION,
  CREATE_TOKEN_TX_VERSION,
  DECIMAL_PLACES,
  DEFAULT_TX_VERSION,
  MAX_INPUTS,
  MAX_OUTPUTS,
  MERGED_MINED_BLOCK_VERSION,
  TX_HASH_SIZE_BYTES,
  TX_WEIGHT_CONSTANTS
} from '../constants'
import {crypto as cryptoBL, encoding, util} from 'bitcore-lib'
import {bufferToHex, hexToBuffer, unpackToFloat, unpackToHex, unpackToInt} from '../utils/buffer'
import helpers from '../utils/helpers'
import Input from './input'
import Output from './output'
import Network from './network'
import {MaximumNumberInputsError, MaximumNumberOutputsError} from '../errors'
import buffer from 'buffer'
import {clone} from 'lodash'
import crypto from 'crypto'

enum txType {
  BLOCK = 'Block',
  TRANSACTION = 'Transaction',
  CREATE_TOKEN_TRANSACTION = 'Create Token Transaction',
  MERGED_MINING_BLOCK = 'Merged Mining Block',
}

type optionsType = {
  version?: number,
  weight?: number,
  nonce?: number,
  timestamp?: number | null,
  parents?: string[],
  tokens?: string[],
  hash?: string | null,
};

export type HistoryTransactionOutput = {
  value: number,
  token_data: number,
  script: string,
  decoded: {
    type?: string,
    address?: string,
    timelock?: number | null,
  },
  token: string,
  spent_by?: string | null,
  selected_as_input?: boolean,
};

export type HistoryTransactionInput = {
  value: number,
  token_data: number,
  script: string,
  decoded: {
    type?: string,
    address?: string,
    timelock?: number | null,
  },
  token: string,
  tx_id: string,
  index: number,
};

export type HistoryTransaction = {
  tx_id: string,
  version: number,
  weight: number,
  timestamp: number,
  is_voided: boolean,
  nonce: number,
  inputs: HistoryTransactionInput[],
  outputs: HistoryTransactionOutput[],
  parents: string[],
  token_name?: string,
  token_symbol?: string,
  tokens: string[],
}

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
  version: number;
  weight: number;
  nonce: number;
  timestamp: number | null;
  parents: string[];
  tokens: string[];
  hash: string | null;
  protected _dataToSignCache: Buffer | null;

  constructor(inputs: Input[], outputs: Output[], options: optionsType = {}) {
    const defaultOptions: optionsType = {
      version: DEFAULT_TX_VERSION,
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null,
    };
    const newOptions = Object.assign(defaultOptions, options);
    const { version, weight, nonce, timestamp, parents, tokens, hash } = newOptions;

    this.inputs = inputs;
    this.outputs = outputs;
    this.version = version!;
    this.weight = weight!;
    this.nonce = nonce!;
    this.timestamp = timestamp!;
    this.parents = parents!;
    this.tokens = tokens!;
    this.hash = hash!;

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
    return this.hash === null ? '' : `${this.hash.substring(0,12)}...${this.hash.substring(52,64)}`;
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
   * Serialize funds fields
   * version, len tokens, len inputs, len outputs, tokens array, inputs and outputs
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

    // Len tokens
    array.push(helpers.intToBytes(this.tokens.length, 1))

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
    array.push(helpers.intToBytes(this.inputs.length, 1))

    // Len outputs
    array.push(helpers.intToBytes(this.outputs.length, 1))
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
    array.push(helpers.floatToBytes(this.weight, 8));
    // Timestamp
    array.push(helpers.intToBytes(this.timestamp!, 4))

    if (this.parents) {
      array.push(helpers.intToBytes(this.parents.length, 1))
      for (const parent of this.parents) {
        array.push(hexToBuffer(parent));
      }
    } else {
      // Len parents (parents will be calculated in the backend)
      array.push(helpers.intToBytes(0, 1))
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
    array.push(helpers.intToBytes(this.nonce, 4));
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
    const hashbuf = cryptoBL.Hash.sha256sha256(dataToSign);
    return new encoding.BufferReader(hashbuf).readReverse();
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

    let sumOutputs = this.getOutputsSum();
    // Preventing division by 0 when handling authority methods that have no outputs
    sumOutputs = Math.max(1, sumOutputs);

    // We need to take into consideration the decimal places because it is inside the amount.
    // For instance, if one wants to transfer 20 HTRs, the amount will be 2000.
    const amount = sumOutputs / (10 ** DECIMAL_PLACES);

    let weight = (TX_WEIGHT_CONSTANTS.txWeightCoefficient * Math.log2(txSize) + 4 / (1 + TX_WEIGHT_CONSTANTS.txMinWeightK / amount) + 4);

    // Make sure the calculated weight is at least the minimum
    weight = Math.max(weight, TX_WEIGHT_CONSTANTS.txMinWeight)
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
  getOutputsSum(): number {
    let sumOutputs = 0;
    for (const output of this.outputs) {
      if (output.isAuthority()) {
        continue
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
    let arr: any = []
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Weight, timestamp, parents
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

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
      throw new MaximumNumberInputsError(`Transaction has ${this.inputs.length} inputs and can have at most ${MAX_INPUTS}.`);
    }

    if (this.outputs.length > MAX_OUTPUTS) {
      throw new MaximumNumberOutputsError(`Transaction has ${this.outputs.length} outputs and can have at most ${MAX_OUTPUTS}.`);
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
      } else if (this.version === MERGED_MINED_BLOCK_VERSION) {
        return txType.MERGED_MINING_BLOCK;
      }
    } else {
      if (this.version === DEFAULT_TX_VERSION) {
        return txType.TRANSACTION;
      } else if (this.version === CREATE_TOKEN_TX_VERSION) {
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
   * Gets funds fields (version, tokens, inputs, outputs) from bytes
   * and saves them in `this`
   *
   * @param {Buffer} buf Buffer with bytes to get fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {Buffer} Rest of buffer after getting the fields
   * @memberof Transaction
   * @inner
   */
  getFundsFieldsFromBytes(buf: Buffer, network: Network): Buffer {
    // Tx version
    [this.version, buf] = unpackToInt(2, false, buf);

    let lenTokens, lenInputs, lenOutputs;

    // Len tokens
    [lenTokens, buf] = unpackToInt(1, false, buf);

    // Len inputs
    [lenInputs, buf] = unpackToInt(1, false, buf);

    // Len outputs
    [lenOutputs, buf] = unpackToInt(1, false, buf);

    // Tokens array
    for (let i=0; i<lenTokens; i++) {
      let tokenUid;
      [tokenUid, buf] = unpackToHex(TX_HASH_SIZE_BYTES, buf);
      this.tokens.push(tokenUid);
    }

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
   * Gets graph fields (weight, timestamp, parents, nonce) from bytes
   * and saves them in `this`
   *
   * @param {Buffer} buf Buffer with bytes to get fields
   *
   * @return {Buffer} Rest of buffer after getting the fields
   * @memberof Transaction
   * @inner
   */
  getGraphFieldsFromBytes(buf: Buffer): Buffer {
    // Weight
    [this.weight, buf] = unpackToFloat(buf);

    // Timestamp
    [this.timestamp, buf] = unpackToInt(4, false, buf);

    // Parents
    let parentsLen;
    [parentsLen, buf] = unpackToInt(1, false, buf);

    for (let i=0; i<parentsLen; i++) {
      let p;
      [p, buf] = unpackToHex(TX_HASH_SIZE_BYTES, buf);
      this.parents.push(p);
    }

    // Nonce
    [this.nonce, buf] = unpackToInt(4, false, buf);

    return buf;
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
    tx.getGraphFieldsFromBytes(txBuffer);

    tx.updateHash();

    return tx;
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
    const arrFunds = [];
    this.serializeFundsFields(arrFunds, true);
    const fundsHash = crypto.createHash('sha256');
    fundsHash.update(buffer.Buffer.concat(arrFunds));
    const digestedFunds = fundsHash.digest();

    const arrGraph = [];
    this.serializeGraphFields(arrGraph);
    const graphHash = crypto.createHash('sha256');
    graphHash.update(buffer.Buffer.concat(arrGraph));
    const digestedGraph = graphHash.digest();

    const bufferPart1 = buffer.Buffer.concat([digestedFunds, digestedGraph]);

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
    part2.update(part1.digest())

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
}

export default Transaction;
