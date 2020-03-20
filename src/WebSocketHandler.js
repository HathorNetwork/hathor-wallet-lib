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
    /* Right after importing the modules helpers and wallet, they are
     * not available and are still undefined.
     * This is probably caused by a cyclic import (wallet -> helpers -> tokens -> wallet)
     * but still need more study.
     * For now the setTimeout is used, so we can use the helpers module properly.
     */
    setTimeout(() => {
      this.ws = new WS({ wsURL: helpers.getWSServerURL });

      this.ws.on('is_online', (value) => {
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

    }, 0);
  }
}

const instance = new WebSocketHandler();

export default instance;
