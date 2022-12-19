/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import _WebSocket from 'isomorphic-ws';

const WS_READYSTATE_READY = 1;
export const DEFAULT_WS_OPTIONS = {
  wsURL: 'wss://node1.mainnet.hathor.network/v1a/',
  heartbeatInterval: 3000,
  connectionTimeout: 5000,
  retryConnectionInterval: 1000,
  openConnectionTimeout: 20000,
};

export type WsOptions = {
  wsURL?: string;
  heartbeatInterval?: number;
  connectionTimeout?: number;
  retryConnectionInterval?: number;
  openConnectionTimeout?: number;
};

/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WS
 */
abstract class BaseWebSocket extends EventEmitter {
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
  // Retry connection interval in milliseconds
  private retryConnectionInterval: number;
  // Open connection timeout in milliseconds
  private openConnectionTimeout: number;
  // Date of connection.
  private connectedDate: Date | null;
  // Date of latest setup call. The setup is the way to open a new connection.
  private latestSetupDate: Date | null;
  // Latest round trip time measured by PING/PONG.
  private latestRTT: number | null;
  // Heartbeat interval to send pings
  private heartbeat: ReturnType<typeof setTimeout> | null;
  // Date of latest ping.
  protected latestPingDate: Date | null;
  // Timer used to detected when connection is down.
  protected timeoutTimer: ReturnType<typeof setTimeout> | null;
  // Timer used to retry connection
  protected setupTimer: ReturnType<typeof setTimeout> | null;
  // Connection timeout in milliseconds
  protected connectionTimeout: number;

  constructor(options: WsOptions) {
    super();
    
    const {
      wsURL,
      heartbeatInterval,
      connectionTimeout,
      retryConnectionInterval,
      openConnectionTimeout,
    } = {
      ...DEFAULT_WS_OPTIONS,
      ...options,
    };

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
    this.setupTimer = null;
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

      this.closeWs();
    }

    this.ws = new this.WebSocket(wsURL);
    this.latestSetupDate = new Date();

    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (evt) => this.onMessage(evt);
    this.ws.onerror = (evt) => this.onError(evt);
    this.ws.onclose = () => this.onClose();

    this.started = true;
  }

  /**
   * Sets all event listeners to noops on the WebSocket instance 
   * and close it.
   **/
  closeWs() {
    if (!this.ws) {
      return;
    }

    this.ws.onopen = () => {};
    this.ws.onclose = () => {};
    this.ws.onerror = () => {};
    this.ws.onmessage = () => {};

    if (this.ws.readyState === _WebSocket.OPEN) {
      this.ws.close();
    }

    this.ws = null;
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
   */
  abstract onMessage(evt)

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
   * Method called when websocket connection is closed
   */
  onClose() {
    this.started = false;
    this.connected = false;
    this.connectedDate = null;
    this.setIsOnline(false);
    this.closeWs();

    this.clearSetupTimer();
    this.setupTimer = setTimeout(() => this.setup(), this.retryConnectionInterval);
    // @ts-ignore
    clearInterval(this.heartbeat);
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
  sendMessage(msg: string) {
    if (!this.started || !this.connected) {
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
   * Should return a stringified ping message
   */
  abstract getPingMessage(): string

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
    console.warn('Ping timeout. Connection is down...', {
      uptime: this.uptime(),
      connectionTimeout: this.connectionTimeout,
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

export default BaseWebSocket;
