/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Connection from "../../../src/new/connection";
import { FULLNODE_URL, NETWORK_NAME } from "../configuration/test-constants";
import HathorWallet from "../../../src/new/wallet";

/**
 * Generates a connection object for starting wallets.
 * @returns {WalletConnection}
 */
export function generateConnection() {
  return new Connection({
    network: NETWORK_NAME,
    servers: [FULLNODE_URL],
    connectionTimeout: 30000,
  })
}

/**
 * Translates the Wallet Ready event into a promise
 * Waits for the wallet event that indicates this wallet is ready for use.
 * @param hWallet
 * @returns {Promise<unknown>}
 */
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

/**
 * Translates the tx success event into a promise.
 * Waits for the wallet event that indicates this transaction id has been fully integrated
 * into the lib's local caches. Actions that depend on this state can be executed after the
 * successful response from this function.
 * @param {HathorWallet} hWallet
 * @param {string} txId
 * @returns {Promise<SendTxResponse>}
 */
export async function waitForTxReceived(hWallet, txId) {
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
