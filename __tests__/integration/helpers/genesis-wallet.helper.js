/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { FULLNODE_URL, WALLET_CONSTANTS } from "../configuration/test-constants";
import Connection from "../../../src/new/connection";
import HathorWallet from "../../../src/new/wallet";
import { waitForWalletReady } from "./wallet.helper";

/**
 * @type {GenesisWalletHelper}
 */
let singleton = null;

export class GenesisWalletHelper {
  /**
   * @type HathorWallet
   */
  hWallet;

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

  async _injectFunds(address, value) {
    try {
      const result = await this.hWallet.sendTransaction(
        address,
        value,
        {
          changeAddress: 'WPhehTyNHTPz954CskfuSgLEfuKXbXeK3f'
        });

      return result;
    }
    catch (e) {
      console.error(`Failed to inject funds: ${e.message}`);
      throw e;
    }
  }

  static async getSingleton() {
    if (singleton) {
      return singleton;
    }

    const hWallet = new GenesisWalletHelper();
    await hWallet.start();

    singleton = hWallet;
    return singleton;
  }

  static async injectFunds(address, value) {
    const instance = await GenesisWalletHelper.getSingleton()
    return instance._injectFunds(address, value);
  }
}
