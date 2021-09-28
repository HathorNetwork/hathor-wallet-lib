/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import _WebSocket from 'isomorphic-ws';

const WS_READYSTATE_READY = 1;


/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WS
 */
class WS extends EventEmitter {
  constructor({
    wsURL,
    heartbeatInterval = 3000,
    connectionTimeout = 5000,
    retryConnectionInterval = 1000,
    openConnectionTimeout = 20000,
  } = {}) {
    super();

    // This is the class of the Websocket. It is used to open new WebSocket
    // connections. We don't directly use it from import, so the unittests
    // can replace it by a mock.
    this.WebSocket = _WebSocket;

    // This is the URL of the websocket.
    this.wsURL = wsURL;

    // Boolean to show when there is a websocket started with the server
    this.started = false;

    // Boolean to show when the websocket connection is working
    this.connected = undefined;

    // Store variable that is passed to Redux if ws is online
    this.isOnline = undefined;

    // Heartbeat interval in milliseconds.
    this.heartbeatInterval = heartbeatInterval;

    // Connection timeout.
    this.connectionTimeout = connectionTimeout;

    // Retry connection interval in milliseconds.
    this.retryConnectionInterval = retryConnectionInterval;

    // Open connection timeout.
    this.openConnectionTimeout = openConnectionTimeout;

    // Date of connection.
    this.connectedDate = null;

    // Date of latest setup call. The setup is the way to open a new connection.
    this.latestSetupDate = null;

    // Date of latest ping.
    this.latestPingDate = null;

    // Latest round trip time measured by PING/PONG.
    this.latestRTT = null;

    // Timer used to detected when connection is down.
    this.timeoutTimer = null;
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
    console.log('wsURL: ', wsURL);
    if (wsURL === null) {
      // TODO Throw error?
      return;
    }

    if (this.ws) {
      // This check is just to prevent trying to open
      // a connection more than once within the open timeout
      const dt = (new Date() - this.latestSetupDate) / 1000;
      if (dt < this.openConnectionTimeout) {
        return;
      }
      this.ws.onclose = () => {};
      this.ws.close();
      this.ws = null;
    }
    this.ws = new this.WebSocket(wsURL);
    this.latestSetupDate = new Date();

    this.ws.onopen = () => {
        console.log('onopen');
      this.onOpen();
    }
    this.ws.onmessage = (evt) => {
        console.log('onmessage');
      this.onMessage(evt);
    }
    this.ws.onerror = (evt) => {
        console.log('onerror');
      this.onError(evt);
    }
    this.ws.onclose = () => {
        console.log('onclose');
      this.onClose();
    }
  }

  /**
   * Return connection uptime in seconds (or null if not connected).
   **/
  uptime() {
    if (!this.connectedDate) {
      return null;
    }
    const now = new Date();
    return (now - this.connectedDate) / 1000;
  }

  onPong() {
    if (this.latestPingDate) {
      const dt = (new Date() - this.latestPingDate) / 1000;
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
    const data = JSON.parse(evt.data)
    const _type = data.message;

    console.log('message received: ', data);
    if (_type === 'PONG') {
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
    this.emit(_type, data)
  }

  /**
   * Method called when websocket connection is opened
   */
  onOpen() {
    console.log('Connection is open');
    this.connected = true;
    this.connectedDate = new Date();
    this.started = true;
    this.setIsOnline(true);
    this.heartbeat = setInterval(() => {
      this.sendPing();
    }, this.heartbeatInterval);
  }

  /**
   * Method called when websocket connection is closed
   */
  onClose() {
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
    // console.log('ws error', window.navigator.onLine, evt);
  }

  /**
   * Method called to send a message to the server
   *
   * @param {string} msg Message to be sent to the server (usually JSON stringified)
   */
  sendMessage(msg) {
    if (!this.started) {
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
    this.setIsOnline(undefined);
    this.started = false;
    this.connected = undefined;
    if (this.ws) {
      this.ws.onclose = () => {};
      this.ws.close();
      this.ws = null;
    }
    clearInterval(this.heartbeat);
  }

  /**
   * Set if websocket is online
   *
   * @param {*} value Can be true|false|undefined
   */
  setIsOnline(value) {
    if (this.isOnline !== value) {
      this.isOnline = value;
      // Emits event of online state change
      this.emit('is_online', value);
    }
  }
}

export default WS;
