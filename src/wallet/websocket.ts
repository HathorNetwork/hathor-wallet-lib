/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import BaseWebSocket, { WsOptions, DEFAULT_WS_OPTIONS } from '../websocket/base';

export interface WalletServiceWebSocketOptions extends WsOptions {
  walletId: string;
  joinTimeout?: number;
}

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
class WalletServiceWebSocket extends BaseWebSocket {
  // The walletId to subscribe to new events
  private walletId: string;

  // Timer used to detected when join wallet failed
  private joinTimeoutTimer: ReturnType<typeof setTimeout> | null;

  // The default timeout for the join wallet action
  private joinTimeout: number;

  constructor(options: WalletServiceWebSocketOptions) {
    const {
      wsURL,
      heartbeatInterval,
      connectionTimeout,
      retryConnectionInterval,
      openConnectionTimeout,
      walletId,
      joinTimeout,
    } = {
      ...DEFAULT_WS_OPTIONS,
      joinTimeout: DEFAULT_JOIN_TIMEOUT,
      ...options,
    };

    super({
      wsURL,
      heartbeatInterval,
      connectionTimeout,
      retryConnectionInterval,
      openConnectionTimeout,
    });

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
    } else {
      // The websoket might be exchanging many messages and end up getting the pong from the full node too late
      // in that case the websocket would be closed but we know the connection is not down because we are receiving
      // other messages. Because of that we just reset the timeoutTimer when we receive a message that is not a pong
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
      }
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
      id: this.walletId,
    });

    this.sendMessage(msg);
    this.joinTimeoutTimer = setTimeout(() => this.onJoinTimeout(), this.joinTimeout);
  }

  /**
   * Returns a JSON stringified ping message
   */
  // eslint-disable-next-line class-methods-use-this -- The method returns a hardcoded value
  getPingMessage() {
    return JSON.stringify({ action: 'ping' });
  }
}

export default WalletServiceWebSocket;
