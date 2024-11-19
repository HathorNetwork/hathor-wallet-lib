"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _constants = require("../constants");
var _transaction = _interopRequireDefault(require("../models/transaction"));
var _buffer = require("../utils/buffer");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class NanoContract extends _transaction.default {
  constructor(inputs, outputs, tokens, id, method, args, pubkey, signature = null) {
    super(inputs, outputs, {
      tokens
    });
    _defineProperty(this, "id", void 0);
    _defineProperty(this, "method", void 0);
    _defineProperty(this, "args", void 0);
    _defineProperty(this, "pubkey", void 0);
    _defineProperty(this, "signature", void 0);
    this.version = _constants.NANO_CONTRACTS_VERSION;
    this.id = id;
    this.method = method;
    this.args = args;
    this.pubkey = pubkey;
    this.signature = signature;
  }

  /**
   * Serialize funds fields
   * Add the serialized fields to the array parameter
   *
   * @param {array} Array of buffer to push the serialized fields
   * @param {addInputData} If should add input data when serializing it
   *
   * @memberof NanoContract
   * @inner
   */
  serializeFundsFields(array, addInputData) {
    super.serializeFundsFields(array, addInputData);

    // Info version
    array.push((0, _buffer.intToBytes)(_constants.NANO_CONTRACTS_INFO_VERSION, 1));

    // nano contract id
    array.push((0, _buffer.hexToBuffer)(this.id));
    const methodBytes = Buffer.from(this.method, 'utf8');
    array.push((0, _buffer.intToBytes)(methodBytes.length, 1));
    array.push(methodBytes);
    const argsArray = [];
    for (const arg of this.args) {
      argsArray.push((0, _buffer.intToBytes)(arg.length, 2));
      argsArray.push(arg);
    }
    const argsConcat = Buffer.concat(argsArray);
    array.push((0, _buffer.intToBytes)(argsConcat.length, 2));
    array.push(argsConcat);
    array.push((0, _buffer.intToBytes)(this.pubkey.length, 1));
    array.push(this.pubkey);
    if (addInputData && this.signature !== null) {
      array.push((0, _buffer.intToBytes)(this.signature.length, 1));
      array.push(this.signature);
    } else {
      array.push((0, _buffer.intToBytes)(0, 1));
    }
  }

  /**
   * Serialize tx to bytes
   *
   * @memberof NanoContract
   * @inner
   */
  toBytes() {
    const arr = [];
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Graph fields
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);
    return Buffer.concat(arr);
  }
}
var _default = exports.default = NanoContract;