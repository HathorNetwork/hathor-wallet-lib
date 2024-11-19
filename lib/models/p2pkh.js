"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
var _opcodes = require("../opcodes");
var _buffer = require("../utils/buffer");
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
class P2PKH {
  constructor(address, options = {}) {
    // Address object of the value destination
    _defineProperty(this, "address", void 0);
    // Timestamp of the timelock of the output
    _defineProperty(this, "timelock", void 0);
    const defaultOptions = {
      timelock: null
    };
    const newOptions = Object.assign(defaultOptions, options);
    const {
      timelock
    } = newOptions;
    if (!address) {
      throw Error('You must provide an address.');
    }
    this.address = address;
    this.timelock = timelock;
  }

  /**
   * Get script type
   *
   * @return {string}
   * @memberof P2PKH
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this -- This method returns a hardcoded constant
  getType() {
    return 'p2pkh';
  }

  /**
   * Create a P2PKH script
   *
   * @return {Buffer}
   * @memberof P2PKH
   * @inner
   */
  createScript() {
    const arr = [];
    const addressBytes = this.address.decode();
    const addressHash = addressBytes.slice(1, -4);
    if (this.timelock) {
      const timelockBytes = (0, _buffer.intToBytes)(this.timelock, 4);
      _helpers.default.pushDataToStack(arr, timelockBytes);
      arr.push(_opcodes.OP_GREATERTHAN_TIMESTAMP);
    }
    arr.push(_opcodes.OP_DUP);
    arr.push(_opcodes.OP_HASH160);
    // addressHash has a fixed size of 20 bytes, so no need to push OP_PUSHDATA1
    arr.push((0, _buffer.intToBytes)(addressHash.length, 1));
    arr.push(addressHash);
    arr.push(_opcodes.OP_EQUALVERIFY);
    arr.push(_opcodes.OP_CHECKSIG);
    return _bitcoreLib.util.buffer.concat(arr);
  }

  /**
   * Identify a script as P2PKH or not.
   *
   * @param {Buffer} buf Script as buffer.
   *
   * @return {Boolean}
   * @memberof P2PKH
   * @inner
   */
  static identify(buf) {
    const op_greaterthan_timestamp = _opcodes.OP_GREATERTHAN_TIMESTAMP.readUInt8(0);
    const op_dup = _opcodes.OP_DUP.readUInt8(0);
    const op_hash160 = _opcodes.OP_HASH160.readUInt8(0);
    const op_equalverify = _opcodes.OP_EQUALVERIFY.readUInt8(0);
    const op_checksig = _opcodes.OP_CHECKSIG.readUInt8(0);
    if (buf.length !== 31 && buf.length !== 25) {
      // this is not a P2PKH script
      return false;
    }
    let ptr = 0;
    if (buf.length === 31) {
      // with timelock, we begin with timestamp
      if (buf.readUInt8(ptr++) !== 4) {
        return false;
      }
      ptr += 4;
      // next byte is OP_GREATERTHAN_TIMESTAMP
      if (buf.readUInt8(ptr++) !== op_greaterthan_timestamp) {
        return false;
      }
    }

    // OP_DUP OP_HASH160
    if (buf.readUInt8(ptr++) !== op_dup || buf.readUInt8(ptr++) !== op_hash160) {
      return false;
    }
    // address hash
    if (buf.readUInt8(ptr++) !== 20) {
      return false;
    }
    ptr += 20;
    // OP_EQUALVERIFY OP_CHECKSIG
    if (buf.readUInt8(ptr++) !== op_equalverify || buf.readUInt8(ptr++) !== op_checksig) {
      return false;
    }
    return true;
  }
}
var _default = exports.default = P2PKH;