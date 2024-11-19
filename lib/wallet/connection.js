"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _websocket = _interopRequireDefault(require("./websocket"));
var _config = _interopRequireDefault(require("../config"));
var _connection = _interopRequireWildcard(require("../connection"));
var _types = require("./types");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
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
 * This is a Connection that may be shared by one or more wallets.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - CONNECTED: When it is connected.
 *
 * You can subscribe for the following events:
 * - state: Fired when the state of the Wallet changes.
 * - wallet-update: Fired when a new wallet message arrive from the websocket.
 * */
class WalletServiceConnection extends _connection.default {
  constructor(options) {
    const {
      network,
      servers,
      logger,
      walletId,
      connectionTimeout
    } = {
      ..._connection.DEFAULT_PARAMS,
      ...options
    };
    super({
      network,
      servers,
      logger,
      connectionTimeout
    });
    _defineProperty(this, "connectionTimeout", void 0);
    _defineProperty(this, "walletId", void 0);
    this.connectionTimeout = connectionTimeout;
    this.walletId = walletId;
  }

  /**
   * Sets the walletId for the current connection instance
   * */
  setWalletId(walletId) {
    this.walletId = walletId;
  }

  /**
   * Connect to the server and start emitting events.
   * */
  start() {
    if (!this.walletId) {
      throw new Error('Wallet id should be set before connection start.');
    }
    const wsOptions = {
      wsURL: _config.default.getWalletServiceBaseWsUrl(),
      walletId: this.walletId,
      connectionTimeout: this.connectionTimeout,
      logger: this.logger
    };
    this.websocket = new _websocket.default(wsOptions);
    this.websocket.on('is_online', online => this.onConnectionChange(online));
    this.websocket.on('new-tx', payload => this.emit('new-tx', payload.data));
    this.websocket.on('update-tx', payload => this.emit('update-tx', payload.data));
    this.setState(_types.ConnectionState.CONNECTING);
    this.websocket.setup();
  }
}
exports.default = WalletServiceConnection;