/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import networkInstance from './network';
import config from './config';
import GenericWebSocket from './websocket';
import WalletServiceWebSocket from './wallet/websocket';
import { ConnectionState } from './wallet/types';

export const DEFAULT_PARAMS = {
  network: 'mainnet',
  servers: [],
  connectionTimeout: 5000,
};

export type ConnectionParams = {
  network?: string;
  servers?: string[];
  connectionTimeout?: number;
};

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
abstract class Connection extends EventEmitter {
  // network: 'testnet' or 'mainnet'
  protected network: string;
  protected websocket: GenericWebSocket | WalletServiceWebSocket | null;
  protected currentServer: string;
  protected state: ConnectionState;

  /*
   * servers {Array} List of servers for the wallet to connect to, e.g. http://localhost:8080/v1a/
   */
  constructor(options: ConnectionParams) {
    super();

    const {
      network,
      servers,
    } = {
      ...DEFAULT_PARAMS,
      ...options,
    };

    if (!network) {
      throw Error('You must explicitly provide the network.');
    }

    networkInstance.setNetwork(network);

    this.onConnectionChange = this.onConnectionChange.bind(this);

    this.websocket = null;
    this.network = network;
    this.state = ConnectionState.CLOSED;
    this.currentServer = servers[0] || config.getServerUrl();
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
   * Called when a new wallet message arrives from websocket.
   *
   * @param {Object} wsData Websocket message data
   **/
  handleWalletMessage(wsData) {
    this.emit('wallet-update', wsData);
  }

  /**
   * Update class state
   *
   * @param {Number} state New state
   */
  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Connect to the server and start emitting events.
   **/
  abstract start(): void

  /**
   * Close the connections and stop emitting events.
   **/
  stop() {
    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
    this.removeAllListeners();
    if (this.websocket) {
      this.websocket.close();
    }

    this.setState(ConnectionState.CLOSED);
  }

  /**
   * Call websocket endConnection
   * Needed for compatibility with old src/wallet code
   **/
  endConnection() {
    if (this.websocket) {
      this.websocket.endConnection();
    }
  }

  /**
   * Call websocket setup
   * Needed for compatibility with old src/wallet code
   **/
  setup() {
    // This should never happen as this.websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized.');
    }

    this.websocket.setup();
  }

  /**
   * Gets current server
   */
  getCurrentServer(): string {
    return this.currentServer;
  }

  /**
   * Gets current network
   */
  getCurrentNetwork(): string {
    return this.network;
  }

  startControlHandlers(options?: any) {
    return;
  }

  removeMetricsHandlers() {
    if (this.websocket) {
      this.websocket.removeAllListeners('dashboard');
      this.websocket.removeAllListeners('subscribe_address');
    }
  }

  sendMessageWS(msg: any) {
    if (this.websocket) {
      this.websocket.sendMessage(msg);
    }
  }
}

export default Connection;
