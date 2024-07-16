/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import GenericWebSocket from '../websocket';
import helpers from '../utils/helpers';
import BaseConnection, { ConnectionParams } from '../connection';
import { ConnectionState } from '../wallet/types';
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
 * */
class WalletConnection extends BaseConnection {
  static CLOSED: number = 0;

  static CONNECTING: number = 1;

  static CONNECTED: number = 2;

  currentStreamId: string | null = null;

  streamAbortController: AbortController | null = null;

  constructor(options: ConnectionParams) {
    super(options);

    this.handleWalletMessage = this.handleWalletMessage.bind(this);
    this.on('stream-end', this.streamEndHandler.bind(this));

    const wsOptions: {
      connectionTimeout?: number;
      wsURL: string;
    } = { wsURL: helpers.getWSServerURL(this.currentServer) };

    if (options.connectionTimeout) {
      wsOptions.connectionTimeout = options.connectionTimeout;
    }

    this.websocket = new GenericWebSocket(wsOptions);
  }

  /**
   * Connect to the server and start emitting events.
   * */
  start() {
    // This should never happen as the websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized');
    }

    this.websocket.on('is_online', this.onConnectionChange);
    this.websocket.on('wallet', this.handleWalletMessage.bind(this));
    this.websocket.on('stream', this.handleStreamMessage.bind(this));

    this.websocket.on('height_updated', height => {
      this.emit('best-block-update', height);
    });

    this.websocket.on('addresses_loaded', data => {
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
      const msg = JSON.stringify({ type: 'unsubscribe_address', address });
      this.websocket.sendMessage(msg);
    }
  }

  addMetricsHandlers(storage: IStorage) {
    if (this.websocket) {
      this.websocket.on('dashboard', handleWsDashboard(storage));
      this.websocket.on('subscribe_address', handleSubscribeAddress());
    }
  }

  streamEndHandler() {
    this.currentStreamId = null;
    this.streamAbortController?.abort();
    this.streamAbortController = null;
  }

  lockStream(streamId: string): boolean {
    if (this.currentStreamId === null) {
      this.currentStreamId = streamId;
      this.streamAbortController = new AbortController();
      return true;
    }
    return false;
  }

  startStreamingHistory(id: string, firstIndex: number, xpubkey: string, gapLimit: number = -1) {
    if (this.currentStreamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (this.websocket) {
      const data = JSON.stringify({
        id,
        xpub: xpubkey,
        type: 'request:history:xpub',
        'first-index': firstIndex,
        'gap-limit': gapLimit,
      });
      this.websocket.sendMessage(data);
    }
  }

  sendManualStreamingHistory(id: string, firstIndex: number, addresses: [number, string][], first: boolean, gapLimit: number = -1) {
    if (this.currentStreamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (this.websocket) {
      const data = JSON.stringify({
        id,
        first,
        addresses,
        type: 'request:history:manual',
        'first-index': firstIndex,
        'gap-limit': gapLimit,
      });
      this.websocket.sendMessage(data);
    }
  }

  async stopStream() {
    if (this.currentStreamId === null) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      if (this.streamAbortController === null) {
        // We cannot have an active stream an a null abort controller
        reject();
        return;
      }
      // Create a timeout so we do not wait indefinetely
      // It it reaches here we should reject since something went wrong.
      const timer = setTimeout(() => {
        reject();
      }, 10000);

      // We have an active stream.
      // We will wait for the stream to end then resolve.
      this.once('stream-end', () => {
        clearTimeout(timer);
        resolve();
      });
      // Send the abort signal
      this.streamAbortController.abort();
    });
  }
}

export default WalletConnection;
