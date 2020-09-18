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
  constructor() {
    super();

    this.websocket = null;
  }

  setup() {
    if (this.websocket === null) {
      this.websocket = new WS({ wsURL: helpers.getWSServerURL });

      this.on('is_online', this.handleIsOnline);

      /*
       * This class still exists for compatibility reasons
       * it is used in some wallets and in our old lib code
       * In the wallets we capture some events from it, so
       * this following code is to emit all events emitted from this.websocket
       */
      this.oldEmit = this.websocket.emit;
      this.websocket.emit = (type, data) => {
        this.emit(type, data);
        return this.oldEmit(type, data);
      }
    }

    // To keep compatibility with methods previously used in this singleton
    return this.websocket.setup();
  }

  handleIsOnline(value) {
    if (value) {
      wallet.onWebsocketOpened();
      this.websocket.emit('reload_data');
    } else {
      wallet.onWebsocketBeforeClose();
    }
  }

  endConnection() {
    // To keep compatibility with methods previously used in this singleton
    if (this.websocket !== null) {
      this.websocket.endConnection();
      this.websocket.emit = () => {};
      this.websocket = null;
      this.removeListener('is_online', this.handleIsOnline);
    }
  }
}

const instance = new WebSocketHandler();

export default instance;
