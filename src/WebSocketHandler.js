/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import wallet from './wallet';
import helpers from './helpers';
import WS from './websocket';
import EventEmitter from 'events';

class WebSocketHandler extends EventEmitter {
  setup() {
    this.ws = new WS({ wsURL: helpers.getWSServerURL });

    this.on('is_online', (value) => {
      if (value) {
        wallet.onWebsocketOpened();
        this.ws.emit('reload_data');
      } else {
        wallet.onWebsocketBeforeClose();
      }
    });

    /*
     * This class still exists for compatibility reasons
     * it is used in some wallets and in our old lib code
     * In the wallets we capture some events from it, so
     * this following code is to emit all events emitted from this.ws
     */
    this.oldEmit = this.ws.emit;
    this.ws.emit = (type, ...args) => {
      this.emit(type, ...args);
      return this.oldEmit(type, ...args);
    }

    // To keep compatibility with methods previously used in this singleton
    return this.ws.setup();
  }

  endConnection() {
    // To keep compatibility with methods previously used in this singleton
    return this.ws.endConnection();
  }
}

const instance = new WebSocketHandler();

export default instance;
