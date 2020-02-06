/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import networkInstance from '../network';
import { DEFAULT_SERVERS } from '../constants';
import version from '../version';
import WS from '../websocket';

/**
 * This is a Connection that may be shared by one or more wallets.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - CONNECTED: When it is connected.
 *
 * You can subscribe for the following events:
 * - update-state: Fired when the state of the Wallet changes.
 * - websocket-msg: Fired when a new message arrive from the websocket.
 **/
class Connection extends EventEmitter {
  /*
   * network {String} 'testnet' or 'mainnet'
   * servers {Array} List of servers for the wallet to connect to, e.g. http://localhost:8080/v1a/
   */
  constructor({
    network,
    servers = [],
  } = {}) {
    super();

    if (!network) {
      throw Error('You must explicitly provide the network.');
    }

    networkInstance.setNetwork(network);
    this.network = network;

    this.state = Connection.CLOSED;
    this.serverInfo = null;

    this.onConnectionChange = this.onConnectionChange.bind(this);
    this.handleWebsocketMsg = this.handleWebsocketMsg.bind(this);

    this.servers = servers || [...DEFAULT_SERVERS];
    this.currentServer = this.servers[0];

    this.websocket = WS({ wsURL: this.currentServer });
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   **/
  onConnectionChange(value) {
    if (value) {
      this.setState(Connection.CONNECTED);
    } else {
      this.serverInfo = null;
      this.setState(HathorWallet.CONNECTING);
    }
  }

  /**
   * Called when a new message arrives from websocket.
   **/
  handleWebsocketMsg(wsData) {
    this.emit('websocket-msg', wsData);
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    this.websocket.on('is_online', this.onConnectionChange);
    this.websocket.on('wallet', this.handleWebsocketMsg);

    this.serverInfo = null;
    this.setState(HathorWallet.CONNECTING);

    const promise = new Promise((resolve, reject) => {
      version.checkApiVersion().then((info) => {
        // Check network version to avoid blunders.
        if (info.network.indexOf(this.network) >= 0) {
          this.websocket.setup();
          this.serverInfo = info;
          resolve(info);
        } else {
          this.setState(HathorWallet.CLOSED);
          reject(`Wrong network. server=${info.network} expected=${this.network}`);
        }
      }, (error) => {
        console.log('Version error:', error);
        this.setState(HathorWallet.CLOSED);
        reject(error);
      });
    });
    return promise;
  }

  /**
   * Close the connections and stop emitting events.
   **/
  stop() {
    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
    this.websocket.stop()
    this.websocket.removeListener('is_online', this.onConnectionChange);
    this.websocket.removeListener('wallet', this.handleWebsocketMsg);
    this.serverInfo = null;
    this.setState(HathorWallet.CLOSED);
  }
}

// State constants.
Connection.CLOSED =  0;
Connection.CONNECTING = 1;
Connection.CONNECTED = 2;

export default Connection;
