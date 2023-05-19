/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import BaseConnection, {
  ConnectionParams,
} from '../connection';
import {
  ConnectionState,
} from '../wallet/types';
import { handleSubscribeAddress, handleWsDashboard } from '../utils/connection';
import { IStorage } from '../types';
import AtomicSwapWebSocket from '../websocket/atomic-swap';


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
 **/
export class AtomicSwapServiceConnection extends BaseConnection {
  static CLOSED = 0;
  static CONNECTING = 1;
  static CONNECTED = 2;

  websocket: AtomicSwapWebSocket;

  constructor(options: ConnectionParams, wsURL) {
    super(options);

    const wsOptions = { wsURL };

    if (options.connectionTimeout) {
      wsOptions['connectionTimeout'] = options.connectionTimeout;
    }

    this.websocket = new AtomicSwapWebSocket(wsOptions);
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
