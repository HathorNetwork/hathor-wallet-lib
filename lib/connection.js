"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.DEFAULT_PARAMS = void 0;
var _events = require("events");
var _network = _interopRequireDefault(require("./network"));
var _config = _interopRequireDefault(require("./config"));
var _types = require("./wallet/types");
var _types2 = require("./types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const DEFAULT_PARAMS = exports.DEFAULT_PARAMS = {
  network: 'mainnet',
  servers: [],
  connectionTimeout: 5000,
  logger: (0, _types2.getDefaultLogger)()
};
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
class Connection extends _events.EventEmitter {
  /*
   * servers {Array} List of servers for the wallet to connect to, e.g. http://localhost:8080/v1a/
   */
  constructor(options) {
    super();
    // network: 'testnet' or 'mainnet'
    _defineProperty(this, "network", void 0);
    _defineProperty(this, "websocket", void 0);
    _defineProperty(this, "currentServer", void 0);
    _defineProperty(this, "state", void 0);
    _defineProperty(this, "logger", void 0);
    const {
      network,
      servers
    } = {
      ...DEFAULT_PARAMS,
      ...options
    };
    if (!network) {
      throw Error('You must explicitly provide the network.');
    }
    _network.default.setNetwork(network);
    this.onConnectionChange = this.onConnectionChange.bind(this);
    this.websocket = null;
    this.network = network;
    this.state = _types.ConnectionState.CLOSED;
    this.currentServer = servers[0] || _config.default.getServerUrl();
    this.logger = options.logger || (0, _types2.getDefaultLogger)();
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
   * Called when a new wallet message arrives from websocket.
   *
   * @param {Object} wsData Websocket message data
   * */
  handleWalletMessage(wsData) {
    this.emit('wallet-update', wsData);
  }
  handleStreamMessage(wsData) {
    this.emit('stream', wsData);
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

  /**
   * Connect to the server and start emitting events.
   * */

  /**
   * Close the connections and stop emitting events.
   * */
  stop() {
    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
    this.removeAllListeners();
    if (this.websocket) {
      this.websocket.close();
    }
    this.setState(_types.ConnectionState.CLOSED);
  }

  /**
   * Call websocket endConnection
   * Needed for compatibility with old src/wallet code
   * */
  endConnection() {
    if (this.websocket) {
      this.websocket.endConnection();
    }
  }

  /**
   * Call websocket setup
   * Needed for compatibility with old src/wallet code
   * */
  setup() {
    // This should never happen as this.websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized.');
    }
    this.websocket.setup();
  }

  /**
   * Gets current server
   */
  getCurrentServer() {
    return this.currentServer;
  }

  /**
   * Gets current network
   */
  getCurrentNetwork() {
    return this.network;
  }

  // eslint-disable-next-line class-methods-use-this -- This method is a no-op
  startControlHandlers(options) {}
  removeMetricsHandlers() {
    if (this.websocket) {
      this.websocket.removeAllListeners('dashboard');
      this.websocket.removeAllListeners('subscribe_address');
    }
  }
  sendMessageWS(msg) {
    if (this.websocket) {
      this.websocket.sendMessage(msg);
    }
  }
}
var _default = exports.default = Connection;