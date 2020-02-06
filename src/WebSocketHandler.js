/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WS from './websocket';
import helpers from './helpers';
import wallet from './wallet';

const instance = new WS({ wsURL: helpers.getWSServerURL });
instance.on('is_online', (value) => {
  if (value) {
    wallet.onWebsocketOpened();
    instance.emit('reload_data');
  } else {
    wallet.onWebsocketBeforeClose();
  }
});
export default instance;
