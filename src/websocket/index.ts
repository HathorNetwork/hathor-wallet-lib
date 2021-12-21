/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import BaseWebSocket, { WsOptions } from './base';

/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WS
 */
class WalletWebSocket extends BaseWebSocket {
  constructor(options: WsOptions) {
    super(options);
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
    } else {
      // The websoket might be exchanging many messages and end up getting the pong from the full node too late
      // in that case the websocket would be closed but we know the connection is not down because we are receiving
      // other messages. Because of that we just reset the timeoutTimer when we receive a message that is not a pong
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
      }
    }
    this.emit(_type, message)
  }

  /**
   * Ping method to check if server is still alive
   */
  sendPing() {
    if (this.latestPingDate) {
      // Skipping sendPing. Still waiting for pong...
      return;
    }
    const msg = JSON.stringify({'type': 'ping'});
    this.latestPingDate = new Date();
    this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    this.sendMessage(msg);
  }

  /**
   * Extend onOpen to consider online as soon as the websocket connection is open
   */
  onOpen() {
    super.onOpen();
    this.setIsOnline(true);
  }
}

export default WalletWebSocket;
