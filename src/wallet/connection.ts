/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import networkInstance from '../network';
import {
  DEFAULT_SERVERS,
  WALLET_SERVICE_BASE_WS_URL,
  WALLET_SERVICE_TESTNET_BASE_WS_URL,
} from '../constants';
import version from '../version';
import helpers from '../helpers';
import wallet from '../wallet';
import WS from './websocket';

export enum ConnectionState {
  CLOSED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
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
 **/
class Connection extends EventEmitter {
  // the network to connect to, 'testnet' or 'mainnet'
  private network: string;
  private state: ConnectionState;
  private websocket: WS;
  private walletId: string;

  /*
   * network {String} 'testnet' or 'mainnet'
   */
  constructor({
    network = 'mainnet',
    walletId = '',
    connectionTimeout = null,
  } = {}) {
    super();

    if (!network) {
      throw Error('You must explicitly provide the network.');
    }

    if (!walletId || !walletId.length) {
      throw Error('You must explicitly provide the walletId.');
    }

    networkInstance.setNetwork(network);
    this.network = network;

    this.walletId = walletId;

    this.state = ConnectionState.CLOSED;

    this.onConnectionChange = this.onConnectionChange.bind(this);

    const wsOptions = {
      wsURL: this.getWSServerURL(network),
      walletId: this.walletId,
    };

    if (connectionTimeout) {
      wsOptions['connectionTimeout'] = connectionTimeout;
    }
    this.websocket = new WS(wsOptions);
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

  getWSServerURL(network: string) {
    if (network === 'mainnet') {
      return WALLET_SERVICE_BASE_WS_URL;
    }

    return WALLET_SERVICE_TESTNET_BASE_WS_URL;
  }

  /**
   * Update class state
   */
  setState(state: ConnectionState) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    this.websocket.on('is_online', this.onConnectionChange);
    this.websocket.on('new-tx', (payload) => this.emit('new-tx', payload.data));
    this.websocket.on('update-tx', (payload) => this.emit('update-tx', payload.data));

    this.setState(ConnectionState.CONNECTING);
    this.websocket.setup();
  }

  /**
   * Close the connections and stop emitting events.
   **/
  stop() {
    this.websocket.removeAllListeners();
    this.removeAllListeners();
    this.setState(ConnectionState.CLOSED);
  }
}

export default Connection;
