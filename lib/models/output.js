"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.MAXIMUM_SCRIPT_LENGTH = void 0;
var _lodash = _interopRequireDefault(require("lodash"));
var _constants = require("../constants");
var _errors = require("../errors");
var _buffer = require("../utils/buffer");
var _scripts = require("../utils/scripts");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Maximum length of an output script
 * @type {number}
 */
const MAXIMUM_SCRIPT_LENGTH = exports.MAXIMUM_SCRIPT_LENGTH = 256;
class Output {
  constructor(value, script, options = {}) {
    // Output value as an integer
    _defineProperty(this, "value", void 0);
    // tokenData of the output
    _defineProperty(this, "tokenData", void 0);
    // Output script
    _defineProperty(this, "script", void 0);
    // Decoded output script
    _defineProperty(this, "decodedScript", void 0);
    const defaultOptions = {
      tokenData: 0
    };
    const newOptions = Object.assign(defaultOptions, options);
    const {
      tokenData
    } = newOptions;
    if (!value) {
      throw new _errors.OutputValueError('Value must be a positive number.');
    }
    if (!script) {
      throw Error('You must provide a script.');
    }
    this.value = value;
    this.script = script;
    this.tokenData = tokenData;
    this.decodedScript = null;
  }

  /**
   * Get the bytes from the output value
   * If value is above the maximum for 32 bits we get from 8 bytes, otherwise only 4 bytes
   *
   * @throws {OutputValueError} Will throw an error if output value is invalid
   *
   * @return {Buffer}
   *
   * @memberof Transaction
   * @inner
   */
  valueToBytes() {
    if (this.value <= 0) {
      throw new _errors.OutputValueError('Output value must be positive');
    }
    if (this.value > _constants.MAX_OUTPUT_VALUE) {
      throw new _errors.OutputValueError(`Maximum value is ${_constants.MAX_OUTPUT_VALUE}`);
    }
    if (this.value > _constants.MAX_OUTPUT_VALUE_32) {
      return (0, _buffer.bigIntToBytes)(-this.value, 8);
    }
    return (0, _buffer.bigIntToBytes)(this.value, 4);
  }

  /**
   * Returns if output is authority
   *
   * @return {boolean} If it's an authority output or not
   *
   * @memberof Output
   * @inner
   */
  isAuthority() {
    return (this.tokenData & _constants.TOKEN_AUTHORITY_MASK) > 0;
  }

  /**
   * Verifies if output is of mint
   *
   * @return {boolean} if output is mint
   *
   * @memberof Output
   * @inner
   */
  isMint() {
    return this.isAuthority() && (this.value & _constants.TOKEN_MINT_MASK) > 0;
  }

  /**
   * Verifies if output is of melt
   *
   * @return {boolean} if output is melt
   *
   * @memberof Output
   * @inner
   */
  isMelt() {
    return this.isAuthority() && (this.value & _constants.TOKEN_MELT_MASK) > 0;
  }

  /**
   * Get index of token list of the output.
   * It already subtracts 1 from the final result,
   * so if this returns 0, it's the first token, i.e.
   * tokenData = 1, then getTokenIndex = 0.
   * For HTR output (tokenData = 0) it will return -1.
   *
   * @return {number} Index of the token of this output
   *
   * @memberof Output
   * @inner
   */
  getTokenIndex() {
    return (this.tokenData & _constants.TOKEN_INDEX_MASK) - 1;
  }

  /**
   * Checks if this output refers to the HTR token
   *
   * @return {boolean} True if it is HTR
   * @memberOf Output
   * @inner
   */
  isTokenHTR() {
    return this.getTokenIndex() === -1;
  }

  /**
   * Serialize an output to bytes
   *
   * @return {Buffer[]}
   * @memberof Output
   * @inner
   */
  serialize() {
    const arr = [];
    arr.push(this.valueToBytes());
    // Token data
    arr.push((0, _buffer.intToBytes)(this.tokenData, 1));
    arr.push((0, _buffer.intToBytes)(this.script.length, 2));
    arr.push(this.script);
    return arr;
  }
  parseScript(network) {
    this.decodedScript = (0, _scripts.parseScript)(this.script, network);
    return this.decodedScript;
  }

  /**
   * Create output object from bytes
   *
   * @param {Buffer} buf Buffer with bytes to get output fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {[Output, Buffer]} Created output and rest of buffer bytes
   * @memberof Output
   * @static
   * @inner
   */
  static createFromBytes(buf, network) {
    // Cloning buffer so we don't mutate anything sent by the user
    let outputBuffer = _lodash.default.clone(buf);
    let value;
    let tokenData;
    let scriptLen;
    let script;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // Value
    [value, outputBuffer] = (0, _buffer.bytesToOutputValue)(outputBuffer);

    // Token data
    [tokenData, outputBuffer] = (0, _buffer.unpackToInt)(1, false, outputBuffer);

    // Script
    [scriptLen, outputBuffer] = (0, _buffer.unpackToInt)(2, false, outputBuffer);
    [script, outputBuffer] = (0, _buffer.unpackLen)(scriptLen, outputBuffer);
    /* eslint-enable prefer-const */

    const output = new Output(value, script, {
      tokenData
    });
    output.parseScript(network);
    return [output, outputBuffer];
  }

  /**
   * Checks if the script length is within the valid limits
   *
   * @returns {boolean} True if the script is within valid limits
   *
   * @memberof Output
   * @inner
   */
  hasValidLength() {
    // No script can have more than the maximum length
    return this.script.length <= MAXIMUM_SCRIPT_LENGTH;
  }

  /**
   * Returns the type of the output, according to the specified network
   *
   * @param {Network} network Network to get output addresses first byte
   * @returns {string} Output type
   *
   * @memberof Output
   * @inner
   */
  getType(network) {
    const decodedScript = this.decodedScript || this.parseScript(network);
    return decodedScript?.getType() || '';
  }
}
var _default = exports.default = Output;