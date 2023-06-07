/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  ConnectionState,
} from '../wallet/types';
import WalletWebSocket from '../websocket/index';
import { EventEmitter } from 'events';


/**
 * This is a Websocket Connection with the Atomic Swap Service
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - CONNECTED: When it is connected.
 *
 * You can subscribe for the following events:
 * - update-atomic-swap-proposal: Fired when the state of a listened proposal changes
 * - state: Fired when the websocket connection state changes
 * - pong: Internal or debug use only. Fired when the health check is received from the backend
 **/
export class AtomicSwapServiceConnection extends EventEmitter {
  websocket: WalletWebSocket;
  protected state: ConnectionState;

  constructor(options: { wsURL: string, connectionTimeout?: number }) {
    super();

    // Initializing WebSocket
    const wsOptions = {
      wsURL: options.wsURL,
    } as { wsURL: string, connectionTimeout?: number };
    if (options.connectionTimeout) {
      wsOptions.connectionTimeout = options.connectionTimeout;
    }
    this.websocket = new WalletWebSocket(wsOptions);

    // Remaining properties initialization
    this.state = ConnectionState.CLOSED;
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    // This should never happen as the websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized');
    }

    this.websocket.on('pong', (value) => {
      this.emit('pong', value);
    })

    this.websocket.on('is_online', (value) => {
      return this.onConnectionChange(value)
    });

    this.websocket.on('proposal_updated', (data) => {
      this.emit('update-atomic-swap-proposal', data);
    });

    this.websocket.on('connection_error', (err) => {
      console.error(`Atomic Swap Service Websocket error: ${err.message}`);
    })

    this.setState(ConnectionState.CONNECTING);
    this.websocket.setup();
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   **/
  onConnectionChange(value: boolean) {
    if (value) {
      this.setState(ConnectionState.CONNECTED);
    } else {
      this.setState(ConnectionState.CONNECTING);
    }
  }

  /**
   * Update class state
   *
   * @param {Number} state New state
   */
  private setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  getState() {
    return this.state;
  }

  subscribeProposal(proposalsIds: string[]) {
    if (this.websocket) {
      for (const proposalId of proposalsIds) {
        const msg = JSON.stringify({ type: 'subscribe_proposal', proposalId });
        this.websocket.sendMessage(msg);
      }
    }
  }

  unsubscribeProposal(proposalId: string) {
    if (this.websocket) {
      const msg = JSON.stringify({type: 'unsubscribe_proposal', proposalId});
      this.websocket.sendMessage(msg);
    }
  }
}
