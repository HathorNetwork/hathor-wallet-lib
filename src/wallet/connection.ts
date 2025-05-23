/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getDefaultLogger } from '../types';
import WalletServiceWebSocket from './websocket';
import config from '../config';
import BaseConnection, { DEFAULT_PARAMS, ConnectionParams } from '../connection';
import { WsTransaction, ConnectionState } from './types';
import { parseSchema } from '../utils/bigint';
import { wsTransactionSchema } from './api/schemas/walletApi';

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
 * */
export default class WalletServiceConnection extends BaseConnection {
  private connectionTimeout?: number;

  private walletId?: string;

  constructor(options?: WalletServiceConnectionParams) {
    const { network, servers, logger, walletId, connectionTimeout } = {
      ...DEFAULT_PARAMS,
      ...options,
    };

    super({
      network,
      servers,
      logger,
      connectionTimeout,
    });

    this.connectionTimeout = connectionTimeout;
    this.walletId = walletId;
  }

  /**
   * Sets the walletId for the current connection instance
   * */
  setWalletId(walletId: string) {
    this.walletId = walletId;
  }

  /**
   * Handle received websocket messages, validating their schemas
   * */
  onWsMessage(type: string, payload) {
    const logger = getDefaultLogger();

    try {
      const validatedTx = parseSchema(payload.data, wsTransactionSchema);
      this.emit(type, validatedTx as WsTransaction);
    } catch (e) {
      // parseSchema already logs the validation error, so no need to log it
      // again here.
      logger.error(`Received a new websocket message (${type}) but schema validation failed.`);
    }
  }

  /**
   * Connect to the server and start emitting events.
   * */
  start() {
    if (!this.walletId) {
      throw new Error('Wallet id should be set before connection start.');
    }

    const wsOptions = {
      wsURL: config.getWalletServiceBaseWsUrl(),
      walletId: this.walletId,
      connectionTimeout: this.connectionTimeout,
      logger: this.logger,
    };

    this.websocket = new WalletServiceWebSocket(wsOptions);
    this.websocket.on('is_online', online => this.onConnectionChange(online));
    this.websocket.on('new-tx', payload => this.onWsMessage('new-tx', payload));
    this.websocket.on('update-tx', payload => this.onWsMessage('update-tx', payload));

    this.setState(ConnectionState.CONNECTING);
    this.websocket.setup();
  }
}
