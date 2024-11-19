"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _websocket = _interopRequireDefault(require("../websocket"));
var _helpers = _interopRequireDefault(require("../utils/helpers"));
var _connection = _interopRequireDefault(require("../connection"));
var _types = require("../wallet/types");
var _connection2 = require("../utils/connection");
var _types2 = require("../types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ /* eslint max-classes-per-file: ["error", 2] */
const STREAM_ABORT_TIMEOUT = 10000; // 10s
const CAPABILITIES_WAIT_TIMEOUT = 2000; // 2s

/**
 * Event names for requesting stream from fullnode
 */
var StreamRequestEvent = /*#__PURE__*/function (StreamRequestEvent) {
  StreamRequestEvent["REQUEST_HISTORY_XPUB"] = "request:history:xpub";
  StreamRequestEvent["REQUEST_HISTORY_MANUAL"] = "request:history:manual";
  return StreamRequestEvent;
}(StreamRequestEvent || {});
const STREAM_HISTORY_ACK_EVENT = 'request:history:ack';
/**
 * Stream abort controller that carries the streamId it is managing.
 */
class StreamController extends AbortController {
  constructor(streamId) {
    super();
    _defineProperty(this, "streamId", void 0);
    this.streamId = streamId;
  }
}

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
class WalletConnection extends _connection.default {
  constructor(options) {
    super(options);
    _defineProperty(this, "streamController", null);
    _defineProperty(this, "streamWindowSize", void 0);
    _defineProperty(this, "capabilities", void 0);
    this.handleWalletMessage = this.handleWalletMessage.bind(this);
    this.on('stream-end', this.streamEndHandler.bind(this));
    const wsOptions = {
      wsURL: _helpers.default.getWSServerURL(this.currentServer),
      logger: options.logger || (0, _types2.getDefaultLogger)()
    };
    if (options.connectionTimeout) {
      wsOptions.connectionTimeout = options.connectionTimeout;
    }
    this.streamWindowSize = options.streamWindowSize;
    this.websocket = new _websocket.default(wsOptions);
  }

  /**
   * Connect to the server and start emitting events.
   * */
  start() {
    // This should never happen as the websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized');
    }
    this.websocket.on('is_online', this.onConnectionChange);
    this.websocket.on('wallet', this.handleWalletMessage.bind(this));
    this.websocket.on('stream', this.handleStreamMessage.bind(this));
    this.websocket.on('capabilities', this.handleCapabilities.bind(this));
    this.websocket.on('height_updated', height => {
      this.emit('best-block-update', height);
    });
    this.websocket.on('addresses_loaded', data => {
      this.emit('wallet-load-partial-update', data);
    });
    this.setState(_types.ConnectionState.CONNECTING);
    this.websocket.setup();
  }

  /**
   * Handle the capabilities event from the websocket.
   */
  handleCapabilities(data) {
    this.logger.debug(`Fullnode has capabilities: ${JSON.stringify(data.capabilities)}`);
    const {
      capabilities
    } = data;
    if (!capabilities) {
      return;
    }
    this.capabilities = capabilities;
  }

  /**
   * If the fullnode has not sent the capabilities yet wait a while.
   */
  async waitCapabilities() {
    if (this.capabilities === undefined) {
      // Wait 2s so the fullnode has some time to send the capabilities envent
      await new Promise(resolve => {
        setTimeout(resolve, CAPABILITIES_WAIT_TIMEOUT);
      });
    }
  }

  /**
   * Check if the connected fullnode has the desired capability.
   * Will return false if the fullnode has not yet sent the capability list.
   */
  async hasCapability(flag) {
    await this.waitCapabilities();
    if (!this.capabilities) {
      return false;
    }
    return this.capabilities?.includes(flag) || false;
  }
  startControlHandlers(storage) {
    this.removeMetricsHandlers();
    this.addMetricsHandlers(storage);
  }
  subscribeAddresses(addresses) {
    if (this.websocket) {
      for (const address of addresses) {
        const msg = JSON.stringify({
          type: 'subscribe_address',
          address
        });
        this.websocket.sendMessage(msg);
      }
    }
  }
  unsubscribeAddress(address) {
    if (this.websocket) {
      const msg = JSON.stringify({
        type: 'unsubscribe_address',
        address
      });
      this.websocket.sendMessage(msg);
    }
  }
  addMetricsHandlers(storage) {
    if (this.websocket) {
      this.websocket.on('dashboard', (0, _connection2.handleWsDashboard)(storage));
      this.websocket.on('subscribe_address', (0, _connection2.handleSubscribeAddress)());
    }
  }
  streamEndHandler() {
    this.streamController?.abort();
    this.streamController = null;
  }
  lockStream(streamId) {
    if (this.streamController === null) {
      this.streamController = new StreamController(streamId);
      return true;
    }
    return false;
  }
  sendStartXPubStreamingHistory(id, firstIndex, xpubkey, gapLimit = -1) {
    if (this.streamController?.streamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (!this.websocket) {
      throw new Error('No websocket connection to send message.');
    }
    const data = {
      id,
      xpub: xpubkey,
      type: StreamRequestEvent.REQUEST_HISTORY_XPUB,
      'first-index': firstIndex,
      'gap-limit': gapLimit
    };
    if (this.streamWindowSize) {
      data['window-size'] = this.streamWindowSize;
    }
    this.websocket.sendMessage(JSON.stringify(data));
  }
  sendManualStreamingHistory(id, firstIndex, addresses, first, gapLimit = -1) {
    if (this.streamController?.streamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (!this.websocket) {
      throw new Error('No websocket connection to send message.');
    }
    const data = {
      id,
      first,
      addresses,
      type: StreamRequestEvent.REQUEST_HISTORY_MANUAL,
      'first-index': firstIndex,
      'gap-limit': gapLimit
    };
    if (this.streamWindowSize) {
      data['window-size'] = this.streamWindowSize;
    }
    this.websocket.sendMessage(JSON.stringify(data));
  }

  /**
   * Send an ACK message to the fullnode to confirm we received all events up to
   * the event of sequence number `ack`.
   */
  sendStreamHistoryAck(id, ack) {
    if (this.streamController?.streamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (!this.websocket) {
      throw new Error('No websocket connection to send message.');
    }
    const data = JSON.stringify({
      id,
      ack,
      type: STREAM_HISTORY_ACK_EVENT
    });
    this.websocket.sendMessage(data);
  }
  async stopStream() {
    await new Promise((resolve, reject) => {
      if (this.streamController === null) {
        // There is no active stream.
        resolve();
        return;
      }
      // Create a timeout so we do not wait indefinetely
      // If it reaches here we should reject since something went wrong.
      const timer = setTimeout(() => {
        reject();
      }, STREAM_ABORT_TIMEOUT);

      // We have an active stream.
      // We will wait for the stream to end then resolve.
      this.once('stream-end', () => {
        clearTimeout(timer);
        resolve();
      });
      // Send the abort signal
      this.streamController.abort();
    });
  }

  /**
   * Handle cleanup in cases of wallet reloads.
   */
  async onReload() {
    await this.stopStream();
  }
}
_defineProperty(WalletConnection, "CLOSED", 0);
_defineProperty(WalletConnection, "CONNECTING", 1);
_defineProperty(WalletConnection, "CONNECTED", 2);
var _default = exports.default = WalletConnection;