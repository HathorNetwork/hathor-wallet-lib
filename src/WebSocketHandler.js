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

    this.ws = null;
  }

  setup() {
    if (this.ws === null) {
      this.ws = new WS({ wsURL: helpers.getWSServerURL });

      this.on('is_online', this.handleIsOnline);

      /*
       * This class still exists for compatibility reasons
       * it is used in some wallets and in our old lib code
       * In the wallets we capture some events from it, so
       * this following code is to emit all events emitted from this.ws
       */
      this.oldEmit = this.ws.emit;
      this.ws.emit = (type, data) => {
        this.emit(type, data);
        return this.oldEmit(type, data);
      }
    }

    // To keep compatibility with methods previously used in this singleton
    return this.ws.setup();
  }

  handleIsOnline(value) {
    if (value) {
      wallet.onWebsocketOpened();
      this.ws.emit('reload_data');
    } else {
      wallet.onWebsocketBeforeClose();
    }
  }

  endConnection() {
    // To keep compatibility with methods previously used in this singleton
    if (this.ws !== null) {
      this.ws.endConnection();
      this.ws.emit = () => {};
      this.ws = null;
      this.removeListener('is_online', this.handleIsOnline);
    }
  }
}

const instance = new WebSocketHandler();

export default instance;
