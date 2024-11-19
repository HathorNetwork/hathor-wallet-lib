"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AtomicSwapServiceConnection = void 0;
var _events = require("events");
var _types = require("../wallet/types");
var _websocket = _interopRequireDefault(require("../websocket"));
var _types2 = require("../types");
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
 * This is a Websocket Connection with the Atomic Swap Service
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - CONNECTED: When it is connected.
 *
 * You can subscribe for the following events:
 * - update-atomic-swap-proposal: Fired when the state of a listened proposal changes
 * - state: Fired when the websocket connection state changes
 * - pong: Internal or debug use only. Fired when the health check is received from the backend
 * */
class AtomicSwapServiceConnection extends _events.EventEmitter {
  constructor(options) {
    super();
    _defineProperty(this, "websocket", void 0);
    _defineProperty(this, "state", void 0);
    _defineProperty(this, "logger", void 0);
    const logger = options.logger || (0, _types2.getDefaultLogger)();

    // Initializing WebSocket
    const wsOptions = {
      logger,
      wsURL: options.wsURL
    };
    if (options.connectionTimeout) {
      wsOptions.connectionTimeout = options.connectionTimeout;
    }
    this.websocket = new _websocket.default(wsOptions);

    // Remaining properties initialization
    this.state = _types.ConnectionState.CLOSED;
    this.logger = logger;
  }

  /**
   * Connect to the server and start emitting events.
   * */
  start() {
    // This should never happen as the websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized');
    }
    this.websocket.on('pong', value => {
      this.emit('pong', value);
    });
    this.websocket.on('is_online', value => {
      return this.onConnectionChange(value);
    });
    this.websocket.on('proposal_updated', data => {
      this.emit('update-atomic-swap-proposal', data);
    });
    this.websocket.on('connection_error', err => {
      this.logger.error(`Atomic Swap Service Websocket error: ${err.message}`);
    });
    this.setState(_types.ConnectionState.CONNECTING);
    this.websocket.setup();
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   * */
  onConnectionChange(value) {
    if (value) {
      this.setState(_types.ConnectionState.CONNECTED);
    } else {
      this.setState(_types.ConnectionState.CONNECTING);
    }
  }

  /**
   * Update class state
   *
   * @param {Number} state New state
   */
  setState(state) {
    this.state = state;
    this.emit('state', state);
  }
  getState() {
    return this.state;
  }
  subscribeProposal(proposalsIds) {
    if (this.websocket) {
      for (const proposalId of proposalsIds) {
        const msg = JSON.stringify({
          type: 'subscribe_proposal',
          proposalId
        });
        this.websocket.sendMessage(msg);
      }
    }
  }
  unsubscribeProposal(proposalId) {
    if (this.websocket) {
      const msg = JSON.stringify({
        type: 'unsubscribe_proposal',
        proposalId
      });
      this.websocket.sendMessage(msg);
    }
  }
}
exports.AtomicSwapServiceConnection = AtomicSwapServiceConnection;