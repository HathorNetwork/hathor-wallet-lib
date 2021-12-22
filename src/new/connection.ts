/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Network from '../models/network';
import WalletWebSocket from '../websocket';
import config from '../config';
import helpers from '../helpers';
import BaseConnection, {
  ConnectionParams,
  ConnectionState,
} from '../connection';

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
class WalletConnection extends BaseConnection {
  constructor(options: ConnectionParams) {
    super(options);
  }

  setupWebSocket(connectionTimeout: number) {
    this.handleWalletMessage = this.handleWalletMessage.bind(this);

    const wsOptions = { wsURL: helpers.getWSServerURL(this.currentServer) };

    if (connectionTimeout) {
      wsOptions['connectionTimeout'] = connectionTimeout;
    }
    return new WalletWebSocket(wsOptions);
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    this.websocket.on('is_online', this.onConnectionChange);
    this.websocket.on('wallet', this.handleWalletMessage);

    this.websocket.on('height_updated', (height) => {
      this.emit('best-block-update', height);
    });

    this.websocket.on('addresses_loaded', (data) => {
      this.emit('wallet-load-partial-update', data);
    });

    this.setState(ConnectionState.CONNECTING);
    this.websocket.setup();
  }
}

// TODO: This is to maintain compatibility until we migrate to typescript
// @ts-ignore
WalletConnection.CLOSED = 0;
// @ts-ignore
WalletConnection.CONNECTING = 1;
// @ts-ignore
WalletConnection.CONNECTED = 2;

export default WalletConnection;
