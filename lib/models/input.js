"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _lodash = _interopRequireDefault(require("lodash"));
var _buffer = require("../utils/buffer");
var _constants = require("../constants");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class Input {
  constructor(hash, index, options = {}) {
    // Hash of the transaction is being spent
    _defineProperty(this, "hash", void 0);
    // Index of the outputs array from the output being spent
    _defineProperty(this, "index", void 0);
    // Input signed data for P2PKH and redeemScript for P2SH
    _defineProperty(this, "data", void 0);
    const defaultOptions = {
      data: null
    };
    const newOptions = Object.assign(defaultOptions, options);
    const {
      data
    } = newOptions;
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
  serialize(addData = true) {
    const arr = [];
    arr.push((0, _buffer.hexToBuffer)(this.hash));
    arr.push((0, _buffer.intToBytes)(this.index, 1));
    if (this.data && addData) {
      arr.push((0, _buffer.intToBytes)(this.data.length, 2));
      arr.push(this.data);
    } else {
      arr.push((0, _buffer.intToBytes)(0, 2));
    }
    return arr;
  }
  setData(data) {
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
  static createFromBytes(buf) {
    // Cloning buffer so we don't mutate anything sent by the user
    let inputBuffer = _lodash.default.clone(buf);
    let hash;
    let index;
    let dataLen;
    let data;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // Hash
    [hash, inputBuffer] = (0, _buffer.unpackToHex)(_constants.TX_HASH_SIZE_BYTES, inputBuffer);

    // Index
    [index, inputBuffer] = (0, _buffer.unpackToInt)(1, false, inputBuffer);

    // Data
    [dataLen, inputBuffer] = (0, _buffer.unpackToInt)(2, false, inputBuffer);
    if (dataLen) {
      [data, inputBuffer] = (0, _buffer.unpackLen)(dataLen, inputBuffer);
    }
    /* eslint-enable prefer-const */

    const input = new Input(hash, index, {
      data
    });
    return [input, inputBuffer];
  }
}
var _default = exports.default = Input;