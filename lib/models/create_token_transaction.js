"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _buffer = _interopRequireDefault(require("buffer"));
var _lodash = require("lodash");
var _constants = require("../constants");
var _buffer2 = require("../utils/buffer");
var _input = _interopRequireDefault(require("./input"));
var _output = _interopRequireDefault(require("./output"));
var _transaction = _interopRequireDefault(require("./transaction"));
var _errors = require("../errors");
var _script_data = _interopRequireDefault(require("./script_data"));
var _types = require("../wallet/types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class CreateTokenTransaction extends _transaction.default {
  constructor(name, symbol, inputs, outputs, options = {}) {
    const defaultOptions = {
      signalBits: _constants.DEFAULT_SIGNAL_BITS,
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null
    };
    const newOptions = Object.assign(defaultOptions, options);
    super(inputs, outputs, newOptions);
    _defineProperty(this, "name", void 0);
    _defineProperty(this, "symbol", void 0);
    this.version = _constants.CREATE_TOKEN_TX_VERSION;
    this.name = name;
    this.symbol = symbol;
  }

  /**
   * Serialize funds fields
   * signal bits, version, len inputs, len outputs, inputs, outputs and token info
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

    // Funds len and fields
    this.serializeFundsFieldsLen(array);
    this.serializeInputsOutputs(array, addInputData);

    // Create token tx need to add extra information
    this.serializeTokenInfo(array);
  }

  /**
   * Serialize create token tx info to bytes
   *
   * @param {Buffer[]} array of bytes
   * @memberof Transaction
   * @inner
   */
  serializeTokenInfo(array) {
    if (!this.name || !this.symbol) {
      throw new _errors.CreateTokenTxInvalid('Token name and symbol are required when creating a new token');
    }
    if (this.name.length > _constants.MAX_TOKEN_NAME_SIZE) {
      throw new _errors.CreateTokenTxInvalid(`Token name size is ${this.name.length} but maximum size is ${_constants.MAX_TOKEN_NAME_SIZE}`);
    }
    if (this.symbol.length > _constants.MAX_TOKEN_SYMBOL_SIZE) {
      throw new _errors.CreateTokenTxInvalid(`Token symbol size is ${this.symbol.length} but maximum size is ${_constants.MAX_TOKEN_SYMBOL_SIZE}`);
    }
    const nameBytes = _buffer.default.Buffer.from(this.name, 'utf8');
    const symbolBytes = _buffer.default.Buffer.from(this.symbol, 'utf8');
    // Token info version
    array.push((0, _buffer2.intToBytes)(_constants.TOKEN_INFO_VERSION, 1));
    // Token name size
    array.push((0, _buffer2.intToBytes)(nameBytes.length, 1));
    // Token name
    array.push(nameBytes);
    // Token symbol size
    array.push((0, _buffer2.intToBytes)(symbolBytes.length, 1));
    // Token symbol
    array.push(symbolBytes);
  }
  getTokenInfoFromBytes(srcBuf) {
    let tokenInfoVersion;
    let lenName;
    let lenSymbol;
    let bufName;
    let bufSymbol;
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    /* eslint-disable prefer-const -- To split these declarations into const + let would be confusing */
    [tokenInfoVersion, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    if (tokenInfoVersion !== _constants.TOKEN_INFO_VERSION) {
      throw new _errors.CreateTokenTxInvalid(`Unknown token info version: ${tokenInfoVersion}`);
    }
    [lenName, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    if (lenName > _constants.MAX_TOKEN_NAME_SIZE) {
      throw new _errors.CreateTokenTxInvalid(`Token name size is ${lenName} but maximum size is ${_constants.MAX_TOKEN_NAME_SIZE}`);
    }
    [bufName, buf] = (0, _buffer2.unpackLen)(lenName, buf);
    this.name = bufName.toString('utf-8');
    [lenSymbol, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    if (lenSymbol > _constants.MAX_TOKEN_SYMBOL_SIZE) {
      throw new _errors.CreateTokenTxInvalid(`Token symbol size is ${lenSymbol} but maximum size is ${_constants.MAX_TOKEN_SYMBOL_SIZE}`);
    }
    [bufSymbol, buf] = (0, _buffer2.unpackLen)(lenSymbol, buf);
    this.symbol = bufSymbol.toString('utf-8');
    /* eslint-enable prefer-const */

    return buf;
  }

  /**
   * Gets funds fields (signalBits, version, inputs, outputs) from bytes
   * and saves them in `this`
   *
   * @param srcBuf Buffer with bytes to get fields
   * @param network Network to get output addresses first byte
   *
   * @return Rest of buffer after getting the fields
   * @memberof CreateTokenTransaction
   * @inner
   */
  getFundsFieldsFromBytes(srcBuf, network) {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Signal bits
    [this.signalBits, buf] = (0, _buffer2.unpackToInt)(1, false, buf);

    // Tx version
    [this.version, buf] = (0, _buffer2.unpackToInt)(1, false, buf);
    let lenInputs;
    let lenOutputs;

    // Len inputs
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [lenInputs, buf] = (0, _buffer2.unpackToInt)(1, false, buf);

    // Len outputs
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [lenOutputs, buf] = (0, _buffer2.unpackToInt)(1, false, buf);

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
  static createFromBytes(buf, network) {
    const tx = new CreateTokenTransaction('', '', [], []);

    // Cloning buffer so we don't mutate anything sent by the user
    // as soon as it's available natively we should use an immutable buffer
    let txBuffer = (0, _lodash.clone)(buf);
    txBuffer = tx.getFundsFieldsFromBytes(txBuffer, network);
    txBuffer = tx.getTokenInfoFromBytes(txBuffer);
    tx.getGraphFieldsFromBytes(txBuffer);
    tx.updateHash();
    return tx;
  }

  /**
   * Checks if this transaction is the creation of an NFT following the NFT Standard Creation.
   * @see https://github.com/HathorNetwork/rfcs/blob/master/text/0032-nft-standard.md#transaction-standard
   * @throws {NftValidationError} Will throw an error if the NFT is not valid
   *
   * @param {Network} network Network to get output addresses first byte
   * @returns {void} If this function does not throw, the NFT is valid
   */
  validateNft(network) {
    // An invalid transaction will fail here too
    this.validate();

    // No need to check the tx version, it is enforced by the class constructor

    /*
     * NFT creation must have at least a DataScript output (the first one) and a Token P2PKH output.
     * Also validating maximum outputs of transactions in general
     */
    if (this.outputs.length < 2) {
      throw new _errors.NftValidationError(`Tx has less than the minimum required amount of outputs`);
    }

    // Validating the first output
    const firstOutput = this.outputs[0];

    // NFT creation DataScript output must have value 1 and must be of HTR
    if (firstOutput.value !== 1n || !firstOutput.isTokenHTR()) {
      throw new _errors.NftValidationError(`First output is not a valid NFT data output`);
    }
    // NFT creation Datascript must be of type data
    if (!(firstOutput.parseScript(network) instanceof _script_data.default)) {
      throw new _errors.NftValidationError(`First output is not a DataScript`);
    }

    // Iterating on all but the first output for validation and counting authorities
    let mintOutputs = 0;
    let meltOutputs = 0;
    for (let index = 1; index < this.outputs.length; ++index) {
      const output = this.outputs[index];

      // Must have a valid length
      if (!output.hasValidLength()) {
        throw new _errors.InvalidOutputsError(`Output at index ${index} script is too long.`);
      }

      // Ensuring the type of the output is valid
      const validTypes = [_types.OutputType.P2PKH.toString(), _types.OutputType.P2SH.toString()];
      const outputType = output.getType(network)?.toLowerCase() || '';
      if (!validTypes.includes(outputType)) {
        throw new _errors.NftValidationError(`Output at index ${index} is not of a valid type`);
      }

      // Counting authority outputs
      mintOutputs += output.isMint() ? 1 : 0;
      meltOutputs += output.isMelt() ? 1 : 0;
    }

    // Validating maximum of 1 mint and/or melt outputs
    if (mintOutputs > 1 || meltOutputs > 1) {
      throw new _errors.NftValidationError('A maximum of 1 of each mint and melt is allowed');
    }
  }
}
var _default = exports.default = CreateTokenTransaction;