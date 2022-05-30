/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { FULLNODE_URL, WALLET_CONSTANTS } from "../configuration/test-constants";
import Connection from "../../../src/new/connection";
import HathorWallet from "../../../src/new/wallet";
import { waitForTxReceived, waitForWalletReady } from "./wallet.helper";

/**
 * @type {GenesisWalletHelper}
 */
let singleton = null;

export class GenesisWalletHelper {
  /**
   * @type HathorWallet
   */
  hWallet;

  /**
   * Starts a genesis wallet. Also serves as a reference for wallet creation boilerplate.
   * Only returns when the wallet is in a _READY_ state.
   * @returns {Promise<void>}
   */
  async start() {
    const words = WALLET_CONSTANTS.genesis.words;
    let pin = '123456';
    const connection = new Connection({
      network: 'privatenet',
      servers: [FULLNODE_URL],
      connectionTimeout: 30000,
    })
    try {
      this.hWallet = new HathorWallet({
        seed: words,
        connection,
        password: 'password',
        pinCode: pin,
        multisig: false,
        preCalculatedAddresses: WALLET_CONSTANTS.genesis.addresses,
      });
      await this.hWallet.start();

      // Only return the positive response after the wallet is ready
      await waitForWalletReady(this.hWallet);
    }
    catch (e) {
      console.error(`GenesisWalletHelper: ${e.message}`);
      throw e;
    }
  }

  /**
   * @typedef SendTxResponse
   * @property {{hash:string,index:number,data:Buffer}[]} inputs
   * @property {{value:number,script:Buffer,tokenData:number,decodedScript:*}[]} outputs
   * @property {number} version
   * @property {number} weight
   * @property {number} nonce
   * @property {number} timestamp
   * @property {string[]} parents
   * @property {*[]} tokens
   * @property {string} hash
   * @property {*} _dataToSignCache
   */

  /**
   * Internal method to send HTR to another wallet's address.
   * @param {string} address
   * @param {number} value
   * @param {boolean} [wait=false] Waits for the websocket confirmation
   * @returns {Promise<SendTxResponse>}
   * @private
   */
  async _injectFunds(address, value, wait = false) {
    try {
      const result = await this.hWallet.sendTransaction(
        address,
        value,
        {
          changeAddress: WALLET_CONSTANTS.genesis.addresses[0]
        });

      if (!wait) {
        return result;
      }

      await waitForTxReceived(this.hWallet, result.hash);
      return result;
    }
    catch (e) {
      console.error(`Failed to inject funds: ${e.message}`);
      throw e;
    }
  }

  /**
   * Preferred way to instantiate the GenesisWalletHelper
   * @returns {Promise<GenesisWalletHelper>}
   */
  static async getSingleton() {
    if (singleton) {
      return singleton;
    }

    const hWallet = new GenesisWalletHelper();
    await hWallet.start();

    singleton = hWallet;
    return singleton;
  }

  /**
   * An easy way to send HTR to another wallet's address for testing.
   * @param {string} address
   * @param {number} value
   * @param {boolean} [wait=false] Waits for the websocket confirmation
   * @returns {Promise<SendTxResponse>}
   */
  static async injectFunds(address, value, wait = false) {
    const instance = await GenesisWalletHelper.getSingleton()
    return instance._injectFunds(address, value, wait);
  }
}
