/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Connection from "../../../src/new/connection";
import { FULLNODE_URL, NETWORK_NAME } from "../configuration/test-constants";
import HathorWallet from "../../../src/new/wallet";

export function generateConnection() {
  return new Connection({
    network: NETWORK_NAME,
    servers: [FULLNODE_URL],
    connectionTimeout: 30000,
  })
}

export function waitForWalletReady(hWallet) {
  // Only return the positive response after the wallet is ready
  return new Promise((resolve, reject) => {
    hWallet.on('state', newState => {
      if (newState === HathorWallet.READY) {
        return resolve();
      } else if (newState === HathorWallet.ERROR) {
        reject(new Error('Genesis wallet failed to start.'))
      }
    })
  })
}

export function waitForTxReceived(hWallet, txId) {
  // TODO: Implement a timeout

  // Only return the positive response after the transaction was received by the websocket
  return new Promise((resolve, reject) => {
    hWallet.on('new-tx', newTx => {
      if (newTx.tx_id !== txId) {
        return; // Ignore if we didn't receive the transaction we expected.
      }

      // Return the successful transaction
      resolve(newTx);
    })
  })
}
