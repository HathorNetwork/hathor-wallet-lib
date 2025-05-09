/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import BaseWebSocket, { WsOptions } from './base';
import { JSONBigInt } from '../utils/bigint';

/**
 * Handles websocket connections and message transmission
 *
 * This class extends the base websocket class and is currently used by:
 * - the default wallet (using the "old" facade) for wallets that haven't migrated to the Wallet Service yet.
 * - the Atomic Swap Service event listeners
 *
 * @class
 * @name GenericWebSocket
 */
class GenericWebSocket extends BaseWebSocket {
  private readonly splitMessageType: boolean;

  constructor(options: WsOptions & { splitMessageType?: boolean }) {
    super(options);

    this.splitMessageType = options.splitMessageType ?? true;
  }

  /**
   * Handle message receiving from websocket
   *
   * @param {Object} evt Event that has data (evt.data) sent in the websocket
   */
  onMessage(evt) {
    const message = JSONBigInt.parse(evt.data);
    const _type = this.splitMessageType ? message.type.split(':')[0] : message.type;
    if (_type === 'pong') {
      this.onPong();
    } else if (this.timeoutTimer) {
      // The websocket might be exchanging many messages and end up getting the pong from the full node too late
      // in that case the websocket would be closed, but we know the connection is not down because we are receiving
      // other messages. Because of that we just reset the timeoutTimer when we receive a message that is not a pong
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = setTimeout(() => this.onConnectionDown(), this.connectionTimeout);
    }
    this.emit(_type, message);
  }

  /**
   * Returns a JSON stringified ping message
   */
  // eslint-disable-next-line class-methods-use-this -- The method returns a hardcoded value
  getPingMessage() {
    return JSON.stringify({ type: 'ping' });
  }

  /**
   * Extend onOpen to consider online as soon as the websocket connection is open
   */
  onOpen() {
    super.onOpen();
    this.setIsOnline(true);
  }
}

export default GenericWebSocket;
