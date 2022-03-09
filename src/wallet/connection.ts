/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Network from '../models/network';
import WalletServiceWebSocket from './websocket';
import config from '../config';
import BaseConnection, {
  DEFAULT_PARAMS,
  ConnectionParams,
} from '../connection';
import {
  WsTransaction,
} from './types';

export enum ConnectionState {
  CLOSED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
}

export interface WalletServiceConnectionParams extends ConnectionParams {
  walletId: string;
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
class WalletServiceConnection extends BaseConnection {
  private connectionTimeout?: number;
  private walletId?: string;

  constructor(options?: WalletServiceConnectionParams) {
    const {
      network,
      servers,
      walletId,
      connectionTimeout,
    } = {
      ...DEFAULT_PARAMS,
      ...options,
    };

    super({
      network,
      servers,
      connectionTimeout,
    });

    this.connectionTimeout = connectionTimeout;
    this.walletId = walletId;
  }

  /**
   * Sets the walletId for the current connection instance
   **/
  setWalletId(walletId: string) {
    this.walletId = walletId;
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    if (!this.walletId) {
      throw new Error('Wallet id should be set before connection start.');
    }

    const wsOptions = {
      wsURL: config.getWalletServiceBaseWsUrl(),
      walletId: this.walletId,
      connectionTimeout: this.connectionTimeout,
    };

    this.websocket = new WalletServiceWebSocket(wsOptions);
    this.websocket.on('is_online', (online) => this.onConnectionChange(online));
    this.websocket.on('new-tx', (payload) => this.emit('new-tx', payload.data as WsTransaction));
    this.websocket.on('update-tx', (payload) => this.emit('update-tx', payload.data));

    this.setState(ConnectionState.CONNECTING);
    this.websocket.setup();
  }
}

export default WalletServiceConnection;
