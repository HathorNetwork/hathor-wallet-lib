"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _lodash = require("lodash");
var _deserializer = _interopRequireDefault(require("./deserializer"));
var _nano = _interopRequireDefault(require("../api/nano"));
var _buffer = require("../utils/buffer");
var _address = require("../utils/address");
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
class NanoContractTransactionParser {
  constructor(blueprintId, method, publicKey, network, args) {
    _defineProperty(this, "blueprintId", void 0);
    _defineProperty(this, "method", void 0);
    _defineProperty(this, "publicKey", void 0);
    _defineProperty(this, "network", void 0);
    _defineProperty(this, "address", void 0);
    _defineProperty(this, "args", void 0);
    _defineProperty(this, "parsedArgs", void 0);
    this.blueprintId = blueprintId;
    this.method = method;
    this.publicKey = publicKey;
    this.args = args;
    this.network = network;
    this.address = null;
    this.parsedArgs = null;
  }

  /**
   * Parse the nano public key to an address object
   *
   * @memberof NanoContractTransactionParser
   * @inner
   */
  parseAddress() {
    this.address = (0, _address.getAddressFromPubkey)(this.publicKey, this.network);
  }

  /**
   * Parse the arguments in hex into a list of parsed arguments
   *
   * @memberof NanoContractTransactionParser
   * @inner
   */
  async parseArguments() {
    const parsedArgs = [];
    if (!this.args) {
      return;
    }
    const deserializer = new _deserializer.default(this.network);
    // Get the blueprint data from full node
    const blueprintInformation = await _nano.default.getBlueprintInformation(this.blueprintId);
    if (!(0, _lodash.has)(blueprintInformation, `public_methods.${this.method}`)) {
      // If this.method is not in the blueprint information public methods, then there's an error
      throw new _errors.NanoContractTransactionParseError('Failed to parse nano contract transaction. Method not found.');
    }
    const methodArgs = (0, _lodash.get)(blueprintInformation, `public_methods.${this.method}.args`, []);
    let argsBuffer = Buffer.from(this.args, 'hex');
    let size;
    for (const arg of methodArgs) {
      [size, argsBuffer] = (0, _buffer.unpackToInt)(2, false, argsBuffer);
      let parsed;
      try {
        parsed = deserializer.deserializeFromType(argsBuffer.slice(0, size), arg.type);
      } catch {
        throw new _errors.NanoContractTransactionParseError(`Failed to deserialize argument ${arg.type} .`);
      }
      parsedArgs.push({
        ...arg,
        parsed
      });
      argsBuffer = argsBuffer.slice(size);
    }
    this.parsedArgs = parsedArgs;
  }
}
var _default = exports.default = NanoContractTransactionParser;