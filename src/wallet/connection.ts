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
export class DummyWalletServiceConnection extends EventEmitter implements IConnection {
  public readonly isDummyConnection = true;
  public walletId?: string;

  private currentNetwork: string;
  private currentServer: string;
  protected state: ConnectionState;

  constructor(options: WalletServiceConnectionParams = { walletId: 'dummy-wallet' }) {
    super();

    const {
      walletId,
      network,
      servers,
    } = {
      ...DEFAULT_PARAMS,
      ...options,
    };

    if (!network) {
      throw Error('You must explicitly provide the network.');
    }

    this.walletId = walletId;
    this.currentNetwork = network || 'dummynet';
    this.state = ConnectionState.CLOSED;
    this.currentServer = servers[0] || config.getServerUrl();
  }

  start(): void {
    if (!this.walletId) {
      throw new Error('Wallet id should be set before connection start.');
    }
  }

  stop(): void {
    this.removeAllListeners();
    this.setState(ConnectionState.CLOSED);
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

  onConnectionChange(value: boolean): void {
    if (value) {
      this.setState(ConnectionState.CONNECTED);
    } else {
      this.setState(ConnectionState.CONNECTING);
    }
  }

  setState(state: ConnectionState): void {
    this.state = state;
  }

  getCurrentServer(): string {
    return this.currentServer;
  }

  getCurrentNetwork(): string {
    return this.currentNetwork;
  }

  setWalletId(walletId: string) {
    this.walletId = walletId;
  }

  isStateClosed(): boolean {
    return this.state === ConnectionState.CLOSED;
  }

  isStateConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  isStateConnecting(): boolean {
    return this.state === ConnectionState.CONNECTING;
  }
}
