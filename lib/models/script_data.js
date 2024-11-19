"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
var _buffer = _interopRequireDefault(require("buffer"));
var _opcodes = require("../opcodes");
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
class ScriptData {
  constructor(data) {
    // String of data to store on the script
    _defineProperty(this, "data", void 0);
    if (!data) {
      throw Error('You must provide data.');
    }
    this.data = data;
  }

  /**
   * Get script type
   *
   * @return {String}
   * @memberof ScriptData
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this -- This method returns a hardcoded constant
  getType() {
    return 'data';
  }

  /**
   * Create an output script from data
   *
   * @return {Buffer}
   * @memberof ScriptData
   * @inner
   */
  createScript() {
    const arr = [];
    const dataBytes = _buffer.default.Buffer.from(this.data, 'utf8');
    _helpers.default.pushDataToStack(arr, dataBytes);
    arr.push(_opcodes.OP_CHECKSIG);
    return _bitcoreLib.util.buffer.concat(arr);
  }
}
var _default = exports.default = ScriptData;