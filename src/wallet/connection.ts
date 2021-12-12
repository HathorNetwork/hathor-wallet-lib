/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import networkInstance from '../network';
import { DEFAULT_SERVERS } from '../constants';
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
  private network: string;
  private servers: string[];
  private state: ConnectionState;
  private currentServer: string;
  private websocket: WS;

  /*
   * network {String} 'testnet' or 'mainnet'
   * servers {Array} List of servers for the wallet to connect to, e.g. http://localhost:8080/v1a/
   */
  constructor({
    network = 'mainnet',
    servers = [],
    connectionTimeout = null,
  } = {}) {
    super();

    if (!network) {
      throw Error('You must explicitly provide the network.');
    }

    networkInstance.setNetwork(network);
    this.network = network;

    this.state = ConnectionState.CLOSED;

    this.onConnectionChange = this.onConnectionChange.bind(this);
    this.handleWalletMessage = this.handleWalletMessage.bind(this);
    this.servers = servers || [...DEFAULT_SERVERS];
    this.currentServer = this.servers[0];

    const wsOptions = { wsURL: 'wss://y4lxi17rej.execute-api.eu-central-1.amazonaws.com/mainnet' };
    if (connectionTimeout) {
      wsOptions['connectionTimeout'] = connectionTimeout;
    }
    this.websocket = new WS(wsOptions);
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   **/
  onConnectionChange(value) {
    if (value) {
      this.setState(ConnectionState.CONNECTED);
    } else {
      this.setState(ConnectionState.CONNECTING);
    }
  }

  /**
   * Called when a new wallet message arrives from websocket.
   *
   * @param {Object} wsData Websocket message data
   **/
  handleWalletMessage(wsData) {
    console.log('Received message from wallet:', wsData);
    // this.emit('wallet-update', wsData);
  }

  /**
   * Update class state
   *
   * @param {Number} state New state
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
    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
    this.websocket.removeAllListeners();
    this.removeAllListeners();
    this.websocket.endConnection()
    this.setState(ConnectionState.CLOSED);
  }

  /**
   * Call websocket endConnection
   * Needed for compatibility with old src/wallet code
   **/
  endConnection() {
    this.websocket.endConnection();
  }
}

export default Connection;
