/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MERGED_MINED_BLOCK_VERSION, BLOCK_VERSION, CREATE_TOKEN_TX_VERSION, DEFAULT_TX_VERSION, DECIMAL_PLACES, TOKEN_INFO_VERSION, TX_WEIGHT_CONSTANTS, MAX_INPUTS, MAX_OUTPUTS } from '../constants';
import { crypto, encoding, util } from 'bitcore-lib';
import helpers from '../utils/helpers';
import Input from './input';
import Output from './output';
import { CreateTokenTxInvalid, MaximumNumberInputsError, MaximumNumberOutputsError } from '../errors';
import buffer from 'buffer';

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
  name?: string | null,
  symbol?: string | null,
};

const defaultOptions: optionsType = {
  version: DEFAULT_TX_VERSION,
  weight: 0,
  nonce: 0,
  timestamp: null,
  parents: [],
  tokens: [],
  hash: null,
  name: null,
  symbol: null,
}

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
  name: string | null;
  symbol: string | null;
  private _dataToSignCache: Buffer | null;

  constructor(inputs: Input[], outputs: Output[], options: optionsType = defaultOptions) {
    const newOptions = Object.assign(defaultOptions, options);
    const { version, weight, nonce, timestamp, parents, tokens, hash, name, symbol } = newOptions;

    this.inputs = inputs;
    this.outputs = outputs;
    this.version = version!;
    this.weight = weight!;
    this.nonce = nonce!;
    this.timestamp = timestamp!;
    this.parents = parents!;
    this.tokens = tokens!;
    this.hash = hash!;
    this.name = name!;
    this.symbol = symbol!;

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
    // Tx version
    arr.push(helpers.intToBytes(this.version, 2))

    // Len tokens
    if (this.version !== CREATE_TOKEN_TX_VERSION) {
      // Create token tx does not have tokens array
      arr.push(helpers.intToBytes(this.tokens.length, 1))
    }

    // Len inputs
    arr.push(helpers.intToBytes(this.inputs.length, 1))
    // Len outputs
    arr.push(helpers.intToBytes(this.outputs.length, 1))

    // Tokens data
    for (const token of this.tokens) {
      arr.push(new encoding.BufferReader(token).buf);
    }

    for (const inputTx of this.inputs) {
      arr.push(...inputTx.serialize(false));
    }

    for (const outputTx of this.outputs) {
      arr.push(...outputTx.serialize());
    }

    if (this.version === CREATE_TOKEN_TX_VERSION) {
      // Create token tx need to add extra information
      arr = [...arr, ...this.serializeTokenInfo()];
    }

    this._dataToSignCache = util.buffer.concat(arr);
    return this._dataToSignCache!;
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
    const hashbuf = crypto.Hash.sha256sha256(dataToSign);
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
    // Tx version
    arr.push(helpers.intToBytes(this.version, 2))
    if (this.version !== CREATE_TOKEN_TX_VERSION) {
      // Create token tx does not have tokens array
      arr.push(helpers.intToBytes(this.tokens.length, 1))
    }
    // Len inputs
    arr.push(helpers.intToBytes(this.inputs.length, 1))
    // Len outputs
    arr.push(helpers.intToBytes(this.outputs.length, 1))

    for (const token of this.tokens) {
      arr.push(new encoding.BufferReader(token).buf);
    }

    for (const inputTx of this.inputs) {
      arr.push(...inputTx.serialize());
    }

    for (const outputTx of this.outputs) {
      arr.push(...outputTx.serialize());
    }

    if (this.version === CREATE_TOKEN_TX_VERSION) {
      // Create token tx need to add extra information
      arr = [...arr, ...this.serializeTokenInfo()];
    }

    // Now serialize the graph part
    //
    // Weight is a float with 8 bytes
    arr.push(helpers.floatToBytes(this.weight, 8));
    // Timestamp
    arr.push(helpers.intToBytes(this.timestamp!, 4))

    if (this.parents) {
      arr.push(helpers.intToBytes(this.parents.length, 1))
      for (const parent of this.parents) {
        arr.push(util.buffer.hexToBuffer(parent));
      }
    } else {
      // Len parents (parents will be calculated in the backend)
      arr.push(helpers.intToBytes(0, 1))
    }

    // Add nonce in the end
    arr.push(helpers.intToBytes(this.nonce, 4));
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
}

export default Transaction;
