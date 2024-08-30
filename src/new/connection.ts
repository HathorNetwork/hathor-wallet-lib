/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint max-classes-per-file: ["error", 2] */

import GenericWebSocket from '../websocket';
import helpers from '../utils/helpers';
import BaseConnection, { ConnectionParams } from '../connection';
import { ConnectionState } from '../wallet/types';
import { handleSubscribeAddress, handleWsDashboard } from '../utils/connection';
import { IStorage, ILogger, getDefaultLogger } from '../types';

const STREAM_ABORT_TIMEOUT = 10000; // 10s
const STREAM_WINDOW_SIZE: number | string = 'inf';

/**
 * Event names for requesting stream from fullnode
 */
enum StreamRequestEvent {
  REQUEST_HISTORY_XPUB = 'request:history:xpub',
  REQUEST_HISTORY_MANUAL = 'request:history:manual',
}

const STREAM_HISTORY_ACK_EVENT = 'request:history:ack';

/**
 * Stream abort controller that carries the streamId it is managing.
 */
class StreamController extends AbortController {
  streamId: string;

  constructor(streamId: string) {
    super();
    this.streamId = streamId;
  }
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
class WalletConnection extends BaseConnection {
  static CLOSED: number = 0;

  static CONNECTING: number = 1;

  static CONNECTED: number = 2;

  streamController: StreamController | null = null;

  streamWindowSize: number | string;

  constructor(options: ConnectionParams & { streamWindowSize?: number }) {
    super(options);

    this.handleWalletMessage = this.handleWalletMessage.bind(this);
    this.on('stream-end', this.streamEndHandler.bind(this));

    const wsOptions: {
      connectionTimeout?: number;
      wsURL: string;
      logger: ILogger;
    } = {
      wsURL: helpers.getWSServerURL(this.currentServer),
      logger: options.logger || getDefaultLogger(),
    };

    if (options.connectionTimeout) {
      wsOptions.connectionTimeout = options.connectionTimeout;
    }

    this.streamWindowSize = options.streamWindowSize || STREAM_WINDOW_SIZE;

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
    this.streamController?.abort();
    this.streamController = null;
  }

  lockStream(streamId: string): boolean {
    if (this.streamController === null) {
      this.streamController = new StreamController(streamId);
      return true;
    }
    return false;
  }

  sendStartXPubStreamingHistory(
    id: string,
    firstIndex: number,
    xpubkey: string,
    gapLimit: number = -1
  ) {
    if (this.streamController?.streamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (!this.websocket) {
      throw new Error('No websocket connection to send message.');
    }

    const data = JSON.stringify({
      id,
      xpub: xpubkey,
      type: StreamRequestEvent.REQUEST_HISTORY_XPUB,
      'first-index': firstIndex,
      'gap-limit': gapLimit,
      window_size: this.streamWindowSize,
    });
    this.websocket.sendMessage(data);
  }

  sendManualStreamingHistory(
    id: string,
    firstIndex: number,
    addresses: [number, string][],
    first: boolean,
    gapLimit: number = -1
  ) {
    if (this.streamController?.streamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (!this.websocket) {
      throw new Error('No websocket connection to send message.');
    }

    const data = JSON.stringify({
      id,
      first,
      addresses,
      type: StreamRequestEvent.REQUEST_HISTORY_MANUAL,
      'first-index': firstIndex,
      'gap-limit': gapLimit,
      window_size: this.streamWindowSize,
    });
    this.websocket.sendMessage(data);
  }

  /**
   * Send an ACK message to the fullnode to confirm we received all events up to
   * the event of sequence number `ack`.
   */
  sendStreamHistoryAck(id: string, ack: number) {
    if (this.streamController?.streamId !== id) {
      throw new Error('There is an on-going stream, cannot start a second one');
    }
    if (!this.websocket) {
      throw new Error('No websocket connection to send message.');
    }

    const data = JSON.stringify({ id, ack, type: STREAM_HISTORY_ACK_EVENT });
    this.websocket.sendMessage(data);
  }

  async stopStream() {
    await new Promise<void>((resolve, reject) => {
      if (this.streamController === null) {
        // There is no active stream.
        resolve();
        return;
      }
      // Create a timeout so we do not wait indefinetely
      // If it reaches here we should reject since something went wrong.
      const timer = setTimeout(() => {
        reject();
      }, STREAM_ABORT_TIMEOUT);

      // We have an active stream.
      // We will wait for the stream to end then resolve.
      this.once('stream-end', () => {
        clearTimeout(timer);
        resolve();
      });
      // Send the abort signal
      this.streamController.abort();
    });
  }

  /**
   * Handle cleanup in cases of wallet reloads.
   */
  async onReload() {
    await this.stopStream();
  }
}

export default WalletConnection;
