/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { WALLET_SERVICE_TESTNET_BASE_URL } from '../constants.js';
import _WebSocket from 'isomorphic-ws';

const WS_READYSTATE_READY = 1;


/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WS
 */
class WS extends EventEmitter {
  // The walletId to subscribe to new events
  private walletId: string;
  // This is the class of the Websocket. It is used to open new WebSocket
  // connections. We don't directly use it from import, so the unittests
  // can replace it by a mock.
  private WebSocket: _WebSocket;
  // This is the websocket instance
  private ws: _WebSocket;
  // This is the URL of the websocket.
  private wsURL: string | Function;
  // Boolean to show when there is a websocket started with the server
  private started: boolean;
  // Boolean to show when the websocket connection is working
  private connected: boolean | null;
  // Boolean to show when the websocket is online
  private isOnline: boolean;
  // Heartbeat interval in milliseconds
  private heartbeatInterval: number;
  // Connection timeout in milliseconds
  private connectionTimeout: number;
  // Retry connection interval in milliseconds
  private retryConnectionInterval: number;
  // Open connection timeout in milliseconds
  private openConnectionTimeout: number;
  // Date of connection.
  private connectedDate: Date | null;
  // Date of latest setup call. The setup is the way to open a new connection.
  private latestSetupDate: Date | null;
  // Date of latest ping.
  private latestPingDate: Date | null;
  // Latest round trip time measured by PING/PONG.
  private latestRTT: number | null;
  // Timer used to detected when connection is down.
  private timeoutTimer: ReturnType<typeof setTimeout> | null;
  // Heartbeat interval to send pings
  private heartbeat: ReturnType<typeof setTimeout> | null;

  constructor({
    wsURL = WALLET_SERVICE_TESTNET_BASE_URL,
    heartbeatInterval = 3000,
    connectionTimeout = 5000,
    retryConnectionInterval = 1000,
    openConnectionTimeout = 20000,
    walletId = '',
  } = {}) {
    super();

    this.walletId = walletId;
    this.WebSocket = _WebSocket;
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
    this.heartbeat = null;
  }

  /**
   * Return websocket url to connect to.
   **/
  getWSServerURL() {
    if (typeof this.wsURL === 'function') {
      return this.wsURL();
    } else {
      return this.wsURL;
    }
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
      this.ws.onclose = () => {};
      this.ws.close();
      this.ws = null;
    }

    this.ws = new this.WebSocket(wsURL);
    this.latestSetupDate = new Date();

    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (evt) => this.onMessage(evt);
    this.ws.onerror = (evt) => this.onError(evt);
    this.ws.onclose = () => this.onClose();
  }

  /**
   * Return connection uptime in seconds (or null if not connected).
   **/
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
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Handle message receiving from websocket
   *
   * @param {Object} evt Event that has data (evt.data) sent in the websocket
   */
  onMessage(evt) {
    const payload = JSON.parse(evt.data)

    if (payload.type === 'pong') {
      this.onPong();
    } else {
      // The websoket might be exchanging many messages and end up getting the pong from the full node too late
      // in that case the websocket would be closed but we know the connection is not down because we are receiving
      // other messages. Because of that we just reset the timeoutTimer when we receive a message that is not a pong
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
      }
    }

    if (payload.type === 'join-success') {
      this.setIsOnline(true);
    }

    this.emit(payload.type, payload);
  }

  /**
   * Method called when websocket connection is opened
   */
  onOpen() {
    this.connected = true;
    this.connectedDate = new Date();
    this.started = true;
    this.heartbeat = setInterval(() => {
      this.sendPing();
    }, this.heartbeatInterval);

    // Subscribe to the current wallet id
    // Note that we will only call setIsOnline when we receive the join-success message
    const msg = JSON.stringify({
      'action': 'join',
      'id': this.walletId,
    });

    this.sendMessage(msg);
  }

  /**
   * Method called when websocket connection is closed
   */
  onClose() {
    console.log('ON CLOSE');
    this.started = false;
    this.connected = false;
    this.connectedDate = null;
    this.setIsOnline(false);
    if (this.ws) {
      this.ws.onclose = () => {};
      this.ws.close();
      this.ws = null;
    }
    setTimeout(() => {
      this.setup()
    }, this.retryConnectionInterval);
    // @ts-ignore
    clearInterval(this.heartbeat);
  }

  /**
   * Method called when an error happend on websocket
   *
   * @param {Object} evt Event that contains the error
   */
  onError(evt) {
    this.emit('connection_error', evt);
    this.onClose();
  }

  /**
   * Method called to send a message to the server
   *
   * @param {string} msg Message to be sent to the server (usually JSON stringified)
   */
  sendMessage(msg) {
    if (!this.started) {
      console.log('Sending message but not started');
      this.setIsOnline(false);
      return;
    }

    if (this.ws.readyState === WS_READYSTATE_READY) {
      this.ws.send(msg);
    } else {
      // If it is still connecting, we wait a little and try again
      setTimeout(() => {
        this.sendMessage(msg);
      }, 1000);
    }
  }

  /**
   * Ping method to check if server is still alive
   *
   */
  sendPing() {
    if (this.latestPingDate) {
      // Skipping sendPing. Still waiting for pong...
      return;
    }
    const msg = JSON.stringify({'action': 'ping'})
    this.latestPingDate = new Date();
    this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    this.sendMessage(msg)
  }

  onConnectionDown() {
    console.warn('Ping timeout. Connection is down...', {
      uptime: this.uptime(),
      connectionTimeout: this.connectionTimeout,
    });

    this.onClose();
  };

  /**
   * Method called to end a websocket connection
   *
   */
  endConnection() {
    console.log('End connection called');
    this.setIsOnline(false);
    this.started = false;
    this.connected = null;
    if (this.ws) {
      this.ws.onclose = () => {};
      this.ws.close();
      this.ws = null;
    }
    // @ts-ignore
    clearInterval(this.heartbeat);
  }

  /**
   * Set if websocket is online
   */
  setIsOnline(value: boolean) {
    if (this.isOnline !== value) {
      this.isOnline = value;
      // Emits event of online state change
      this.emit('is_online', value);
    }
  }
}

export default WS;
