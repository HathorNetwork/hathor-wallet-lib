"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.DEFAULT_WS_OPTIONS = void 0;
var _events = require("events");
var _isomorphicWs = _interopRequireDefault(require("isomorphic-ws"));
var _types = require("../types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const DEFAULT_WS_OPTIONS = exports.DEFAULT_WS_OPTIONS = {
  wsURL: 'wss://node1.mainnet.hathor.network/v1a/',
  heartbeatInterval: 3000,
  connectionTimeout: 5000,
  retryConnectionInterval: 1000,
  openConnectionTimeout: 20000,
  logger: (0, _types.getDefaultLogger)()
};
/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WS
 */
class BaseWebSocket extends _events.EventEmitter {
  constructor(options) {
    super();
    // This is the class of the Websocket. It is used to open new WebSocket
    // connections. We don't directly use it from import, so the unittests
    // can replace it by a mock.
    _defineProperty(this, "WebSocket", void 0);
    // This is the websocket instance
    _defineProperty(this, "ws", void 0);
    // This is the URL of the websocket.
    _defineProperty(this, "wsURL", void 0);
    // Boolean that indicates that the websocket was instantiated. It's important to
    // notice that it does not indicate that the connection has been established with
    // the server, which is what the `connected` flag indicates
    _defineProperty(this, "started", void 0);
    // Boolean to show when the websocket connection was established with the
    // server. This gets set to true on the onOpen event listener.
    _defineProperty(this, "connected", void 0);
    // Boolean to show when the websocket is online
    _defineProperty(this, "isOnline", void 0);
    // Heartbeat interval in milliseconds
    _defineProperty(this, "heartbeatInterval", void 0);
    // Retry connection interval in milliseconds
    _defineProperty(this, "retryConnectionInterval", void 0);
    // Open connection timeout in milliseconds
    _defineProperty(this, "openConnectionTimeout", void 0);
    // Date of connection.
    _defineProperty(this, "connectedDate", void 0);
    // Date of latest setup call. The setup is the way to open a new connection.
    _defineProperty(this, "latestSetupDate", void 0);
    // Latest round trip time measured by PING/PONG.
    _defineProperty(this, "latestRTT", void 0);
    // Heartbeat interval to send pings
    _defineProperty(this, "heartbeat", void 0);
    // Date of latest ping.
    _defineProperty(this, "latestPingDate", void 0);
    // Timer used to detected when connection is down.
    _defineProperty(this, "timeoutTimer", void 0);
    // Timer used to retry connection
    _defineProperty(this, "setupTimer", void 0);
    // Connection timeout in milliseconds
    _defineProperty(this, "connectionTimeout", void 0);
    _defineProperty(this, "logger", void 0);
    const {
      wsURL,
      heartbeatInterval,
      connectionTimeout,
      retryConnectionInterval,
      openConnectionTimeout,
      logger
    } = {
      ...DEFAULT_WS_OPTIONS,
      ...options
    };
    this.WebSocket = _isomorphicWs.default;
    this.wsURL = wsURL;
    this.started = false;
    this.connected = false;
    this.isOnline = false;
    this.heartbeatInterval = heartbeatInterval;
    this.connectionTimeout = connectionTimeout;
    this.retryConnectionInterval = retryConnectionInterval;
    this.openConnectionTimeout = openConnectionTimeout;
    this.connectedDate = null;
    this.latestSetupDate = null;
    this.latestPingDate = null;
    this.latestRTT = null;
    this.timeoutTimer = null;
    this.setupTimer = null;
    this.heartbeat = null;
    this.logger = logger;
  }

  /**
   * Return websocket url to connect to.
   * */
  getWSServerURL() {
    if (typeof this.wsURL === 'function') {
      return this.wsURL();
    }
    return this.wsURL;
  }

  /**
   * Start websocket object and its methods
   */
  setup() {
    if (this.started) {
      return;
    }
    const wsURL = this.getWSServerURL();
    if (wsURL === null) {
      throw new Error('No server URL specified.');
    }
    if (this.ws) {
      if (this.latestSetupDate) {
        // This check is just to prevent trying to open
        // a connection more than once within the open timeout
        const dt = (new Date().getTime() - this.latestSetupDate.getTime()) / 1000;
        if (dt < this.openConnectionTimeout) {
          return;
        }
      }
      this.closeWs();
    }
    this.ws = new this.WebSocket(wsURL);
    this.latestSetupDate = new Date();
    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = evt => this.onMessage(evt);
    this.ws.onerror = evt => this.onError(evt);
    this.ws.onclose = () => this.onClose();
    this.started = true;
  }

  /**
   * Sets all event listeners to noops on the WebSocket instance
   * and close it.
   * */
  closeWs() {
    if (!this.ws) {
      return;
    }
    this.ws.onopen = () => {};
    this.ws.onclose = () => {};
    this.ws.onerror = () => {};
    this.ws.onmessage = () => {};
    if (this.ws.readyState === _isomorphicWs.default.OPEN) {
      this.ws.close();
    }
    this.ws = null;
    this.started = false;
    this.connected = false;
  }

  /**
   * Return connection uptime in seconds (or null if not connected).
   * */
  uptime() {
    if (!this.connectedDate) {
      return null;
    }
    const now = new Date().getTime();
    return (now - this.connectedDate.getTime()) / 1000;
  }
  onPong() {
    if (this.latestPingDate) {
      const dt = (new Date().getTime() - this.latestPingDate.getTime()) / 1000;
      this.latestRTT = dt;
      this.latestPingDate = null;
    }
    this.clearPongTimeoutTimer();
  }

  /**
   * Handle message receiving from websocket
   */

  /**
   * Method called when websocket connection is opened
   */
  onOpen() {
    if (!this.started) {
      return;
    }
    this.connected = true;
    this.connectedDate = new Date();
    this.heartbeat = setInterval(() => {
      this.sendPing();
    }, this.heartbeatInterval);
  }

  /**
   * Removes all listeners, ends the connection and removes the setup reconnection timer
   */
  close() {
    this.removeAllListeners();
    this.endConnection();
    this.clearSetupTimer();
    this.clearPongTimeoutTimer();
  }

  /**
   * Clears the reconnection timer if it exists
   */
  clearSetupTimer() {
    if (this.setupTimer) {
      clearTimeout(this.setupTimer);
      this.setupTimer = null;
    }
  }

  /**
   * Clears the pong timeout timer if it exists
   */
  clearPongTimeoutTimer() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Method called when websocket connection is closed
   */
  onClose() {
    this.started = false;
    this.connected = false;
    this.connectedDate = null;
    this.latestPingDate = null;
    this.setIsOnline(false);
    this.closeWs();
    this.clearSetupTimer();
    this.clearPongTimeoutTimer();
    this.setupTimer = setTimeout(() => this.setup(), this.retryConnectionInterval);
    clearInterval(this.heartbeat || undefined); // XXX: We should probably handle a missing heartbeat
  }

  /**
   * Method called when an error happend on websocket
   */
  onError(evt) {
    this.emit('connection_error', evt);
    this.onClose();
  }

  /**
   * Method called to send a message to the server
   */
  sendMessage(msg) {
    // The started flag means that the websocket instance has been
    // instantiated, but it does not mean that the connection was
    // successful yet, which is what the connected flags indicates.
    if (!this.started || !this.connected) {
      this.setIsOnline(false);
      return;
    }
    if (this.ws.readyState === _isomorphicWs.default.OPEN) {
      this.ws.send(msg);
    } else {
      // If it is still connecting, we wait a little and try again
      setTimeout(() => {
        this.sendMessage(msg);
      }, 1000);
    }
  }

  /**
   * Should return a stringified ping message
   */

  /**
   * Ping method to check if server is still alive
   */
  sendPing() {
    if (this.latestPingDate) {
      // Skipping sendPing. Still waiting for pong...
      return;
    }
    const msg = this.getPingMessage();
    this.latestPingDate = new Date();
    this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    this.sendMessage(msg);
  }

  /**
   * Event received when the websocket connection is down.
   */
  onConnectionDown() {
    this.logger.warn('Ping timeout. Connection is down...', {
      uptime: this.uptime(),
      connectionTimeout: this.connectionTimeout
    });
    this.onClose();
  }

  /**
   * Method called to end a websocket connection
   */
  endConnection() {
    this.setIsOnline(false);
    this.started = false;
    this.connected = null;
    this.closeWs();
    clearInterval(this.heartbeat || undefined); // XXX: We should probably handle a missing heartbeat
  }

  /**
   * Set if websocket is online
   */
  setIsOnline(value) {
    if (this.isOnline !== value) {
      this.isOnline = value;
      // Emits event of online state change
      this.emit('is_online', value);
    }
  }
}
var _default = exports.default = BaseWebSocket;