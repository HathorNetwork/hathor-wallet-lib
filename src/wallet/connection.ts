/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WalletServiceWebSocket from './websocket';
import config from '../config';
import BaseConnection, {
  DEFAULT_PARAMS,
  ConnectionParams,
  IConnection,
} from '../connection';
import {
  WsTransaction,
  ConnectionState,
} from './types';
import { EventEmitter } from 'events';

export interface WalletServiceConnectionParams extends ConnectionParams {
  network?: string;
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
export default class WalletServiceConnection extends BaseConnection {
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

/**
 * This connection is used when the wallet has websocket disabled.
 */
export class DummyWalletServiceConnection implements IConnection {
  public readonly isDummyConnection = true;
  public walletId?: string;

  protected state: ConnectionState;

  constructor(options: WalletServiceConnectionParams = { walletId: 'dummy-wallet' }) {
    this.walletId = options.walletId;
    this.state = ConnectionState.CLOSED;
  }

  /**
   * Dummy method to simulate the EventEmitter.on method to avoid errors
   * when in the wallet initialization it set listeners to the connection.
   * @param _event dummy event
   * @param _listener dummy listener
   * @returns dummy emitter
   */
  on(_event: string, _listener: (...args: any[]) => void): EventEmitter {
    // return a singleton dummy emitter that does nothing
    return new EventEmitter();
  }

  start(): void {
    // There is nothing to start
  }

  stop(): void {
    // There is nothing to stop
  }

  endConnection(): void {
    // There is no connection to end
  }

  setup(): void {
    // There is nothing to setup
  }

  handleWalletMessage(_wsData: any): void {
    // There is nothing to handle
  }

  onConnectionChange(_value: boolean): void {
    // There is nothing to change
  }

  setState(_state: ConnectionState): void {
    // There is nothing to set
  }

  getCurrentServer(): string {
    return 'dummy-server';
  }

  getCurrentNetwork(): string {
    return 'dummy-network';
  }

  setWalletId(_walletId: string) {
    // There is nothing to set
  }
}
