"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _base = _interopRequireWildcard(require("../websocket/base"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const DEFAULT_JOIN_TIMEOUT = 5000;

/**
 * Handles websocket connections and message transmission.
 *
 * This class extends the base websocket class and is meant to be used
 * exclusively when connecting to the Hathor Wallet Service.
 *
 * @class
 * @name WalletServiceWebSocket
 */
class WalletServiceWebSocket extends _base.default {
  constructor(options) {
    const {
      wsURL,
      heartbeatInterval,
      connectionTimeout,
      retryConnectionInterval,
      openConnectionTimeout,
      logger,
      walletId,
      joinTimeout
    } = {
      ..._base.DEFAULT_WS_OPTIONS,
      joinTimeout: DEFAULT_JOIN_TIMEOUT,
      ...options
    };
    super({
      wsURL,
      heartbeatInterval,
      connectionTimeout,
      retryConnectionInterval,
      openConnectionTimeout,
      logger
    });
    // The walletId to subscribe to new events
    _defineProperty(this, "walletId", void 0);
    // Timer used to detected when join wallet failed
    _defineProperty(this, "joinTimeoutTimer", void 0);
    // The default timeout for the join wallet action
    _defineProperty(this, "joinTimeout", void 0);
    this.walletId = walletId;
    this.joinTimeout = joinTimeout;
    this.joinTimeoutTimer = null;
  }

  /**
   * Handle message receiving from websocket
   *
   * @param {Object} evt Event that has data (evt.data) sent in the websocket
   */
  onMessage(evt) {
    const payload = JSON.parse(evt.data);
    if (payload.type === 'pong') {
      this.onPong();
    } else if (payload.type === 'join-success') {
      this.onJoinSuccess();
    } else if (this.timeoutTimer) {
      // The websoket might be exchanging many messages and end up getting the pong from the full node too late
      // in that case the websocket would be closed but we know the connection is not down because we are receiving
      // other messages. Because of that we just reset the timeoutTimer when we receive a message that is not a pong
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    }
    this.emit(payload.type, payload);
  }

  /**
   * Method called when websocket connection is opened
   */
  onOpen() {
    super.onOpen();
    this.joinWallet();
  }

  /**
   * Clears the join timeout timer
   */
  clearJoinTimeout() {
    if (!this.joinTimeoutTimer) {
      return;
    }
    clearTimeout(this.joinTimeoutTimer);
  }

  /**
   * Called when the `join-success` event is received on the websocket connection
   */
  onJoinSuccess() {
    this.clearJoinTimeout();
    this.setIsOnline(true);
  }

  /**
   * Handler for timeouts on the `join` wallet action
   */
  onJoinTimeout() {
    this.clearJoinTimeout();
    this.joinWallet();
    this.setIsOnline(false);
  }

  /**
   * Sends the join action to the websocket connection to start receiving updates
   * from our wallet
   */
  joinWallet() {
    // Subscribe to the current wallet id
    const msg = JSON.stringify({
      action: 'join',
      id: this.walletId
    });
    this.sendMessage(msg);
    this.joinTimeoutTimer = setTimeout(() => this.onJoinTimeout(), this.joinTimeout);
  }

  /**
   * Returns a JSON stringified ping message
   */
  // eslint-disable-next-line class-methods-use-this -- The method returns a hardcoded value
  getPingMessage() {
    return JSON.stringify({
      action: 'ping'
    });
  }
}
var _default = exports.default = WalletServiceWebSocket;