"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.handleSubscribeAddress = handleSubscribeAddress;
exports.handleWsDashboard = handleWsDashboard;
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

function handleWsDashboard(storage) {
  return data => {
    // update network height
    const height = data.best_block_height;
    storage.getCurrentHeight().then(currentHeight => {
      if (height !== currentHeight) {
        storage.setCurrentHeight(height);
        storage.unlockUtxos(height);
      }
    });
  };
}
function handleSubscribeAddress() {
  return data => {
    if (data.success === false) {
      // If an address subscription fails we stop the service
      throw new Error(data.message);
    }
  };
}