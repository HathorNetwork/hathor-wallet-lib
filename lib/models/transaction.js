"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
var _buffer = _interopRequireDefault(require("buffer"));
var _lodash = require("lodash");
var _crypto = _interopRequireDefault(require("crypto"));
var _constants = require("../constants");
var _buffer2 = require("../utils/buffer");
var _input = _interopRequireDefault(require("./input"));
var _output = _interopRequireDefault(require("./output"));
var _errors = require("../errors");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var txType = /*#__PURE__*/function (txType) {
  txType["BLOCK"] = "Block";
  txType["TRANSACTION"] = "Transaction";
  txType["CREATE_TOKEN_TRANSACTION"] = "Create Token Transaction";
  txType["MERGED_MINING_BLOCK"] = "Merged Mining Block";
  return txType;
}(txType || {});
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
  constructor(inputs, outputs, options = {}) {
    _defineProperty(this, "inputs", void 0);
    _defineProperty(this, "outputs", void 0);
    _defineProperty(this, "signalBits", void 0);
    _defineProperty(this, "version", void 0);
    _defineProperty(this, "weight", void 0);
    _defineProperty(this, "nonce", void 0);
    _defineProperty(this, "timestamp", void 0);
    _defineProperty(this, "parents", void 0);
    _defineProperty(this, "tokens", void 0);
    _defineProperty(this, "hash", void 0);
    _defineProperty(this, "_dataToSignCache", void 0);
    const defaultOptions = {
      signalBits: _constants.DEFAULT_SIGNAL_BITS,
      version: _constants.DEFAULT_TX_VERSION,
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null
    };
    const newOptions = Object.assign(defaultOptions, options);
    const {
      signalBits,
      version,
      weight,
      nonce,
      timestamp,
      parents,
      tokens,
      hash
    } = newOptions;
    this.inputs = inputs;
    this.outputs = outputs;
    this.signalBits = signalBits;
    this.version = version;
    this.weight = weight;
    this.nonce = nonce;
    this.timestamp = timestamp;
    this.parents = parents;
    this.tokens = tokens;
    this.hash = hash;

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
  getShortHash() {
    return this.hash === null ? '' : `${this.hash.substring(0, 12)}...${this.hash.substring(52, 64)}`;
  }

  /**
   * Return transaction data to sign in inputs
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  getDataToSign() {
    if (this._dataToSignCache !== null) {
      return this._dataToSignCache;
    }
    const arr = [];
    this.serializeFundsFields(arr, false);
    this._dataToSignCache = _bitcoreLib.util.buffer.concat(arr);
    return this._dataToSignCache;
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
  serializeFundsFields(array, addInputData) {
    // Signal bits
    array.push((0, _buffer2.intToBytes)(this.signalBits, 1));

    // Tx version
    array.push((0, _buffer2.intToBytes)(this.version, 1));

    // Len tokens
    array.push((0, _buffer2.intToBytes)(this.tokens.length, 1));

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
  serializeTokensArray(array) {
    // Tokens data
    for (const token of this.tokens) {
      array.push((0, _buffer2.hexToBuffer)(token));
    }
  }

  /**
   * Add to buffer array the serialization of funds fields len (len of inputs and outputs)
   *
   * @memberof Transaction
   * @inner
   */
  serializeFundsFieldsLen(array) {
    // Len inputs
    array.push((0, _buffer2.intToBytes)(this.inputs.length, 1));

    // Len outputs
    array.push((0, _buffer2.intToBytes)(this.outputs.length, 1));
  }

  /**
   * Add to buffer array the serialization of funds fields (inputs and outputs)
   *
   * @memberof Transaction
   * @inner
   */
  serializeInputsOutputs(array, addInputData) {
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
  serializeGraphFields(array) {
    // Now serialize the graph part
    //
    // Weight is a float with 8 bytes
    array.push((0, _buffer2.floatToBytes)(this.weight, 8));
    // Timestamp
    array.push((0, _buffer2.intToBytes)(this.timestamp, 4));
    if (this.parents) {
      array.push((0, _buffer2.intToBytes)(this.parents.length, 1));
      for (const parent of this.parents) {
        array.push((0, _buffer2.hexToBuffer)(parent));
      }
    } else {
      // Len parents (parents will be calculated in the backend)
      array.push((0, _buffer2.intToBytes)(0, 1));
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
  serializeNonce(array) {
    // Add nonce in the end
    array.push((0, _buffer2.intToBytes)(this.nonce, 4));
  }

  /*
   * Execute hash of the data to sign
   *
   * @return {Buffer} data to sign hashed
   *
   * @memberof Transaction
   * @inner
   */
  getDataToSignHash() {
    const dataToSign = this.getDataToSign();
    return _bitcoreLib.crypto.Hash.sha256sha256(dataToSign);
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
  calculateWeight() {
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
    const amount = sumOutputs / 10 ** _constants.DECIMAL_PLACES;
    let weight = _constants.TX_WEIGHT_CONSTANTS.txWeightCoefficient * Math.log2(txSize) + 4 / (1 + _constants.TX_WEIGHT_CONSTANTS.txMinWeightK / amount) + 4;

    // Make sure the calculated weight is at least the minimum
    weight = Math.max(weight, _constants.TX_WEIGHT_CONSTANTS.txMinWeight);
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
  getOutputsSum() {
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
  toBytes() {
    const arr = [];
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Weight, timestamp, parents
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);
    return _bitcoreLib.util.buffer.concat(arr);
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
    if (this.inputs.length > _constants.MAX_INPUTS) {
      throw new _errors.MaximumNumberInputsError(`Transaction has ${this.inputs.length} inputs and can have at most ${_constants.MAX_INPUTS}.`);
    }
    if (this.outputs.length > _constants.MAX_OUTPUTS) {
      throw new _errors.MaximumNumberOutputsError(`Transaction has ${this.outputs.length} outputs and can have at most ${_constants.MAX_OUTPUTS}.`);
    }
  }

  /**
   * Get tx data and return it in hexadecimal
   *
   * @return {String} Hexadecimal of a serialized tx
   * @memberof Transaction
   * @inner
   */
  toHex() {
    const txBytes = this.toBytes();
    return _bitcoreLib.util.buffer.bufferToHex(txBytes);
  }

  /**
   * Get object type (Transaction or Block)
   *
   * @return {string} Type of the object
   *
   * @memberof Transaction
   * @inner
   */
  getType() {
    if (this.isBlock()) {
      if (this.version === _constants.BLOCK_VERSION) {
        return txType.BLOCK;
      }
      if (this.version === _constants.MERGED_MINED_BLOCK_VERSION) {
        return txType.MERGED_MINING_BLOCK;
      }
    } else {
      if (this.version === _constants.DEFAULT_TX_VERSION) {
        return txType.TRANSACTION;
      }
      if (this.version === _constants.CREATE_TOKEN_TX_VERSION) {
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
  isBlock() {
    return this.version === _constants.BLOCK_VERSION || this.version === _constants.MERGED_MINED_BLOCK_VERSION;
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
  updateTimestamp(timestamp = null) {
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
  getFundsFieldsFromBytes(srcBuf, network) {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Signal bits
    [this.signalBits, buf] = (0, _buffer2.unpackToInt)(1, false, buf);

    // Tx version
    [this.version, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    let lenTokens;
    let lenInputs;
    let lenOutputs;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // Len tokens
    [lenTokens, buf] = (0, _buffer2.unpackToInt)(1, false, buf);

    // Len inputs
    [lenInputs, buf] = (0, _buffer2.unpackToInt)(1, false, buf);

    // Len outputs
    [lenOutputs, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    /* eslint-enable prefer-const */

    // Tokens array
    for (let i = 0; i < lenTokens; i++) {
      let tokenUid;
      [tokenUid, buf] = (0, _buffer2.unpackToHex)(_constants.TX_HASH_SIZE_BYTES, buf);
      this.tokens.push(tokenUid);
    }

    // Inputs array
    for (let i = 0; i < lenInputs; i++) {
      let input;
      [input, buf] = _input.default.createFromBytes(buf);
      this.inputs.push(input);
    }

    // Outputs array
    for (let i = 0; i < lenOutputs; i++) {
      let output;
      [output, buf] = _output.default.createFromBytes(buf, network);
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
  getGraphFieldsFromBytes(srcBuf) {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Weight
    [this.weight, buf] = (0, _buffer2.unpackToFloat)(buf);

    // Timestamp
    [this.timestamp, buf] = (0, _buffer2.unpackToInt)(4, false, buf);

    // Parents
    let parentsLen;
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [parentsLen, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    for (let i = 0; i < parentsLen; i++) {
      let p;
      [p, buf] = (0, _buffer2.unpackToHex)(_constants.TX_HASH_SIZE_BYTES, buf);
      this.parents.push(p);
    }

    // Nonce
    [this.nonce, buf] = (0, _buffer2.unpackToInt)(4, false, buf);
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
  static createFromBytes(buf, network) {
    const tx = new Transaction([], []);

    // Cloning buffer so we don't mutate anything sent by the user
    // as soon as it's available natively we should use an immutable buffer
    let txBuffer = (0, _lodash.clone)(buf);
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
  calculateHashPart1() {
    const arrFunds = [];
    this.serializeFundsFields(arrFunds, true);
    const fundsHash = _crypto.default.createHash('sha256');
    fundsHash.update(_buffer.default.Buffer.concat(arrFunds));
    const digestedFunds = fundsHash.digest();
    const arrGraph = [];
    this.serializeGraphFields(arrGraph);
    const graphHash = _crypto.default.createHash('sha256');
    graphHash.update(_buffer.default.Buffer.concat(arrGraph));
    const digestedGraph = graphHash.digest();
    const bufferPart1 = _buffer.default.Buffer.concat([digestedFunds, digestedGraph]);
    const part1 = _crypto.default.createHash('sha256');
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
  calculateHashPart2(part1) {
    const arrNonce = [];
    this.serializeNonce(arrNonce);
    const bufferFill = _buffer.default.Buffer.alloc(12);
    const fullNonceBytes = _buffer.default.Buffer.concat([bufferFill, _buffer.default.Buffer.concat(arrNonce)]);
    part1.update(fullNonceBytes);
    const part2 = _crypto.default.createHash('sha256');
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
  calculateHash() {
    const hashPart1 = this.calculateHashPart1();
    const hashPart2 = this.calculateHashPart2(hashPart1);
    return (0, _buffer2.bufferToHex)(hashPart2);
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
var _default = exports.default = Transaction;