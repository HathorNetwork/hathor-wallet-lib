"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _base = _interopRequireDefault(require("./base"));
var _bigint = require("../utils/bigint");
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
 * Handles websocket connections and message transmission
 *
 * This class extends the base websocket class and is currently used by:
 * - the default wallet (using the "old" facade) for wallets that haven't migrated to the Wallet Service yet.
 * - the Atomic Swap Service event listeners
 *
 * @class
 * @name GenericWebSocket
 */
class GenericWebSocket extends _base.default {
  constructor(options) {
    super(options);
    _defineProperty(this, "splitMessageType", void 0);
    this.splitMessageType = options.splitMessageType ?? true;
  }

  /**
   * Handle message receiving from websocket
   *
   * @param {Object} evt Event that has data (evt.data) sent in the websocket
   */
  onMessage(evt) {
    const message = _bigint.JSONBigInt.parse(evt.data);
    const _type = this.splitMessageType ? message.type.split(':')[0] : message.type;
    if (_type === 'pong') {
      this.onPong();
    } else if (this.timeoutTimer) {
      // The websocket might be exchanging many messages and end up getting the pong from the full node too late
      // in that case the websocket would be closed, but we know the connection is not down because we are receiving
      // other messages. Because of that we just reset the timeoutTimer when we receive a message that is not a pong
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    }
    this.emit(_type, message);
  }

  /**
   * Returns a JSON stringified ping message
   */
  // eslint-disable-next-line class-methods-use-this -- The method returns a hardcoded value
  getPingMessage() {
    return JSON.stringify({
      type: 'ping'
    });
  }

  /**
   * Extend onOpen to consider online as soon as the websocket connection is open
   */
  onOpen() {
    super.onOpen();
    this.setIsOnline(true);
  }
}
var _default = exports.default = GenericWebSocket;