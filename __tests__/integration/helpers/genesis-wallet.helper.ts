/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint max-classes-per-file: ["error", 2] */
import { FULLNODE_URL, WALLET_CONSTANTS } from '../configuration/test-constants';
import Connection from '../../../src/new/connection';
import HathorWallet from '../../../src/new/wallet';
import { waitForTxReceived, waitForWalletReady, waitUntilNextTimestamp } from './wallet.helper';
import { loggers } from '../utils/logger.util';
import { delay } from '../utils/core.util';
import { OutputValueType } from '../../../src/types';
import Transaction from '../../../src/models/transaction';
import { HathorWalletServiceWallet } from '../../../src';
import { buildWalletInstance, poolForTx } from './service-facade.helper';

interface InjectFundsOptions {
  waitTimeout?: number;
}

let singleton: GenesisWalletHelper | null = null;
let singletonService: HathorWalletServiceWallet | null = null;

export class GenesisWalletHelper {
  /**
   * @type HathorWallet
   */
  hWallet!: HathorWallet;

  /**
   * Starts a genesis wallet. Also serves as a reference for wallet creation boilerplate.
   * Only returns when the wallet is in a _READY_ state.
   * @returns {Promise<void>}
   */
  async start(): Promise<void> {
    const { words } = WALLET_CONSTANTS.genesis;
    const pin = '123456';
    const connection = new Connection({
      network: 'testnet',
      servers: [FULLNODE_URL],
      connectionTimeout: 30000,
      logger: console, // Add required logger parameter
    });
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
    } catch (e) {
      loggers.test!.error(`GenesisWalletHelper: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * Internal method to send HTR to another wallet's address.
   * @param {HathorWallet} destinationWallet Wallet object that we are sending the funds to
   * @param {string} address
   * @param {OutputValueType} value
   * @param [options]
   * @param {number} [options.waitTimeout] Optional timeout for the websocket confirmation.
   *                                       Passing 0 here skips this waiting.
   * @returns {Promise<Transaction>}
   * @private
   */
  async _injectFunds(
    destinationWallet: HathorWallet,
    address: string,
    value: OutputValueType,
    options: InjectFundsOptions = {}
  ): Promise<Transaction> {
    try {
      const result = await this.hWallet.sendTransaction(address, value, {
        changeAddress: WALLET_CONSTANTS.genesis.addresses[0],
      });

      if (options.waitTimeout === 0) {
        return result;
      }

      await waitForTxReceived(this.hWallet, result.hash, options.waitTimeout);
      await waitForTxReceived(destinationWallet, result.hash, options.waitTimeout);
      await waitUntilNextTimestamp(this.hWallet, result.hash);
      return result;
    } catch (e) {
      loggers.test!.error(`Failed to inject funds: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * Preferred way to instantiate the GenesisWalletHelper
   */
  static async getSingleton(): Promise<GenesisWalletHelper> {
    if (singleton) {
      return singleton;
    }

    const hWallet = new GenesisWalletHelper();
    await hWallet.start();
    await delay(500);

    singleton = hWallet;
    return singleton;
  }

  /**
   * An easy way to send HTR to another wallet's address for testing.
   * @param {HathorWallet} destinationWallet Wallet object that we are sending the funds to
   * @param {string} address
   * @param {OutputValueType} value
   * @param [options]
   * @param {number} [options.waitTimeout] Optional timeout for the websocket confirmation.
   *                                       Passing 0 here skips this waiting.
   * @returns {Promise<Transaction>}
   */
  static async injectFunds(
    destinationWallet: HathorWallet,
    address: string,
    value: OutputValueType,
    options: InjectFundsOptions = {}
  ): Promise<Transaction> {
    const instance = await GenesisWalletHelper.getSingleton();
    return instance._injectFunds(destinationWallet, address, value, options);
  }

  /**
   * Clears all transaction listeners from the genesis wallet.
   * Useful when a test run finishes, to ensure there are no leaks.
   * @return {Promise<void>}
   */
  static async clearListeners(): Promise<void> {
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    gWallet.removeAllListeners('new-tx');
  }
}

export class GenesisWalletServiceHelper {
  static pinCode: string = '123456';

  static password: string = 'genesispass';

  static async poolForServerlessAvailable() {
    let isServerlessReady = false;
    const startTime = Date.now();

    // Pool for the serverless app to be ready.
    const delayBetweenRequests = 3000;
    const lambdaTimeout = 30000;
    while (isServerlessReady) {
      try {
        // Executing a method that does not depend on the wallet being started,
        // but that ensures the Wallet Service Lambdas are receiving requests
        await GenesisWalletServiceHelper.getSingleton().getVersionData();
        isServerlessReady = true;
      } catch (e) {
        // Ignore errors, serverless app is probably not ready yet
        loggers.test!.log('Ws-Serverless not ready yet, retrying in 3 seconds...');
      }

      // Timeout after 2 minutes
      if (Date.now() - startTime > lambdaTimeout) {
        throw new Error('Ws-Serverless did not become ready in time');
      }
      await delay(delayBetweenRequests);
    }
    loggers.test!.log(`Ws-Serverless became ready in ${(Date.now() - startTime) / 1000} seconds`);
  }

  static getSingleton(): HathorWalletServiceWallet {
    if (singletonService) {
      return singletonService;
    }

    const { wallet } = buildWalletInstance({
      words: WALLET_CONSTANTS.genesis.words,
    });

    singletonService = wallet;
    return singletonService;
  }

  static async start({ enableWs = false } = {}): Promise<void> {
    if (enableWs) {
      throw new Error(`Not implemented!`);
    }
    const gWallet = GenesisWalletServiceHelper.getSingleton();
    await gWallet.start({
      pinCode: GenesisWalletServiceHelper.pinCode,
      password: GenesisWalletServiceHelper.password,
    });
  }

  static async injectFunds(
    address: string,
    amount: bigint,
    destinationWallet?: HathorWalletServiceWallet
  ) {
    const gWallet = GenesisWalletServiceHelper.getSingleton();
    const fundTx = await gWallet.sendTransaction(address, amount, {
      pinCode: GenesisWalletServiceHelper.pinCode,
    });

    // Ensure the transaction was sent from the Genesis perspective
    await poolForTx(gWallet, fundTx.hash!);

    // Ensure the destination wallet is also aware of the transaction
    if (destinationWallet) {
      await poolForTx(destinationWallet, fundTx.hash!);
    }

    return fundTx;
  }

  static async stop() {
    await GenesisWalletServiceHelper.getSingleton().stop({ cleanStorage: true });
  }
}
