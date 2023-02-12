/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WalletWebSocket from '../websocket';
import helpers from '../utils/helpers';
import BaseConnection, {
  ConnectionParams,
} from '../connection';
import {
  ConnectionState,
} from '../wallet/types';
import { handleSubscribeAddress, handleWsDashboard } from '../utils/connection';
import { IStorage } from '../types';


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

    this.handleWalletMessage = this.handleWalletMessage.bind(this);

    const wsOptions = { wsURL: helpers.getWSServerURL(this.currentServer) };

    if (options.connectionTimeout) {
      wsOptions['connectionTimeout'] = options.connectionTimeout;
    }

    this.websocket = new WalletWebSocket(wsOptions);
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    // This should never happen as the websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized');
    }

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

  startControlHandlers(storage: IStorage) {
    this.removeMetricsHandlers();
    this.addMetricsHandlers(storage);
  }

  subscribeAddresses(addresses: string[]) {
    if (this.websocket) {
      for (const address of addresses) {
        const msg = JSON.stringify({ type: 'subscribe_address', address });
        this.websocket.sendMessage(msg);
      }
    }
  }

  unsubscribeAddress(address: string) {
    if (this.websocket) {
      const msg = JSON.stringify({type: 'unsubscribe_address', address});
      this.websocket.sendMessage(msg);
    }
  }

  addMetricsHandlers(storage: IStorage) {
    if (this.websocket) {
      this.websocket.on('dashboard', handleWsDashboard(storage));
      this.websocket.on('subscribe_address', handleSubscribeAddress());
    }
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
