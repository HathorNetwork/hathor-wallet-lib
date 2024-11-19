"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
var _lodash = _interopRequireDefault(require("lodash"));
var _errors = require("../errors");
var _network = _interopRequireDefault(require("./network"));
var _p2pkh = _interopRequireDefault(require("./p2pkh"));
var _p2sh = _interopRequireDefault(require("./p2sh"));
var _helpers = _interopRequireDefault(require("../utils/helpers"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class Address {
  constructor(base58, options = {
    network: new _network.default('testnet')
  }) {
    // String with address as base58
    _defineProperty(this, "base58", void 0);
    // Network to validate the address
    _defineProperty(this, "network", void 0);
    const {
      network
    } = options;
    if (!_lodash.default.isString(base58)) {
      throw Error('Parameter should be a string.');
    }
    this.base58 = base58;
    this.network = network;
  }

  /**
   * Check if address is a valid string
   *
   * @return {boolean} If address is valid
   * @memberof Address
   * @inner
   */
  isValid() {
    try {
      return this.validateAddress();
    } catch (e) {
      if (e instanceof _errors.AddressError) {
        return false;
      }
      throw e;
    }
  }

  /**
   * Decode address in base58 to bytes
   *
   * @return {Buffer} address in bytes
   * @memberof Address
   * @inner
   */
  decode() {
    try {
      return _bitcoreLib.encoding.Base58.decode(this.base58);
    } catch (e) {
      throw new _errors.AddressError('Invalid base58 address');
    }
  }

  /**
   * Validate address
   *
   * 1. Address must have 25 bytes
   * 2. Address checksum must be valid
   * 3. Address first byte must match one of the options for P2PKH or P2SH
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {boolean}
   * @memberof Address
   * @inner
   */
  validateAddress() {
    const addressBytes = this.decode();
    const errorMessage = `Invalid address: ${this.base58}.`;

    // Validate address length
    if (addressBytes.length !== 25) {
      throw new _errors.AddressError(`${errorMessage} Address has ${addressBytes.length} bytes and should have 25.`);
    }

    // Validate address checksum
    const checksum = addressBytes.slice(-4);
    const addressSlice = addressBytes.slice(0, -4);
    const correctChecksum = _helpers.default.getChecksum(addressSlice);
    if (!_bitcoreLib.util.buffer.equals(checksum, correctChecksum)) {
      throw new _errors.AddressError(`${errorMessage} Invalid checksum. Expected: ${correctChecksum} != Received: ${checksum}.`);
    }

    // Validate version byte. Should be the p2pkh or p2sh
    const firstByte = addressBytes[0];
    if (!this.network.isVersionByteValid(firstByte)) {
      throw new _errors.AddressError(`${errorMessage} Invalid network byte. Expected: ${this.network.versionBytes.p2pkh} or ${this.network.versionBytes.p2sh} and received ${firstByte}.`);
    }
    return true;
  }

  /**
   * Get address type
   *
   * Will check the version byte of the address against the network's version bytes.
   * Valid types are p2pkh and p2sh.
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {string}
   * @memberof Address
   * @inner
   */
  getType() {
    this.validateAddress();
    const addressBytes = this.decode();
    const firstByte = addressBytes[0];
    if (firstByte === this.network.versionBytes.p2pkh) {
      return 'p2pkh';
    }
    if (firstByte === this.network.versionBytes.p2sh) {
      return 'p2sh';
    }
    throw new _errors.AddressError('Invalid address type.');
  }

  /**
   * Get address script
   *
   * Will get the type of the address (p2pkh or p2sh)
   * then create the script
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {Buffer}
   * @memberof Address
   * @inner
   */
  getScript() {
    const addressType = this.getType();
    if (addressType === 'p2pkh') {
      const p2pkh = new _p2pkh.default(this);
      return p2pkh.createScript();
    }
    const p2sh = new _p2sh.default(this);
    return p2sh.createScript();
  }
}
var _default = exports.default = Address;