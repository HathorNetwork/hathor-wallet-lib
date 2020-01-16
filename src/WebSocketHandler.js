/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import helpers from './helpers';
import wallet from './wallet';

const HEARTBEAT_TMO = 3000;     // 3s
const WS_READYSTATE_READY = 1;


/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WebSocketHandler
 */
class WS extends EventEmitter {
  constructor(){
    super();

    // Boolean to show when there is a websocket started with the server
    this.started = false;

    // Boolean to show when the websocket connection is working
    this.connected = undefined;

    // Store variable that is passed to Redux if ws is online
    this.isOnline = undefined;

    // Heartbeat interval in milliseconds.
    this.heartbeatInterval = HEARTBEAT_TMO;

    // Connection timeout.
    this.connectionTimeout = 5000;

    // Retry connection interval in milliseconds.
    this.retryConnectionInterval = 1000;

    // Open connection timeout.
    this.openConnectionTimeout = 20000;

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
   * Start websocket object and its methods
   */
  setup() {
    if (this.started) {
      return;
    }
    let wsURL = helpers.getWSServerURL();
    if (wsURL === null) {
      return;
    }

    if (this.ws) {
      const dt = (new Date() - this.latestSetupDate) / 1000;
      if (dt < this.openConnectionTimeout) {
        return;
      }
      this.ws.close();
    }
    this.ws = new WebSocket(wsURL);
    this.latestSetupDate = new Date();

    this.ws.onopen = () => {
      this.onOpen();
    }
    this.ws.onmessage = (evt) => {
      this.onMessage(evt);
    }
    this.ws.onerror = (evt) => {
      this.onError(evt);
    }
    this.ws.onclose = () => {
      this.onClose();
    }
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
    const message = JSON.parse(evt.data)
    const _type = message.type.split(':')[0]
    if (_type === 'pong') {
      this.onPong();
    }
    this.emit(_type, message)
  }

  /**
   * Method called when websocket connection is opened
   */
  onOpen() {
    if (this.connected === false) {
      // If was not connected  we need to reload data
      // Emits event to reload data
      this.emit('reload_data');
    }
    this.connected = true;
    this.started = true;
    this.setIsOnline(true);
    this.heartbeat = setInterval(() => {
      this.sendPing();
    }, this.heartbeatInterval);
    wallet.websocketOpened();
  }

  /**
   * Method called when websocket connection is closed
   */
  onClose() {
    this.started = false;
    this.connected = false;
    this.setIsOnline(false);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    setTimeout(() => {
      this.setup()
    }, this.retryConnectionInterval);
    clearInterval(this.heartbeat);
    wallet.websocketClosed();
  }

  /**
   * Method called when an error happend on websocket
   *
   * @param {Object} evt Event that contains the error
   */
  onError(evt) {
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
    const msg = JSON.stringify({'type': 'ping'})
    this.latestPingDate = new Date();
    this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    this.sendMessage(msg)
  }

  onConnectionDown() {
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
   * Set in redux if websocket is online
   *
   * @param {*} value Can be true|false|undefined
   */
  setIsOnline(value) {
    // Save in redux
    // Need also to keep the value in 'this' because I was accessing redux store
    // from inside a reducer and was getting error
    if (this.isOnline !== value) {
      this.isOnline = value;
      // Emits event of online state change
      this.emit('is_online', value);
    }
  }
}

const instance = new WS();

export default instance;
