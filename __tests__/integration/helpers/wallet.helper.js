/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Connection from '../../../src/new/connection';
import {
  DEBUG_LOGGING,
  FULLNODE_URL,
  NETWORK_NAME,
  TX_TIMEOUT_DEFAULT, WALLET_CONSTANTS
} from '../configuration/test-constants';
import HathorWallet from '../../../src/new/wallet';
import { multisigWalletsData, precalculationHelpers } from './wallet-precalculation.helper';
import { delay } from '../utils/core.util';
import { loggers } from '../utils/logger.util';

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
 * Generates a connection object for starting wallets.
 * @returns {WalletConnection}
 */
export function generateConnection() {
  return new Connection({
    network: NETWORK_NAME,
    servers: [FULLNODE_URL],
    connectionTimeout: 30000,
  });
}

export const DEFAULT_PASSWORD = 'password';
export const DEFAULT_PIN_CODE = '000000';

const startedWallets = [];

/**
 * Generates a Wallet from an available precalculated seed
 *
 * @param [param] Optional object with properties to override the generated wallet
 * @param {string} [param.seed] 24 words separated by space
 * @param {string} [param.passphrase=''] Wallet passphrase
 * @param {string} [param.xpriv]
 * @param {string} [param.xpub]
 * @param {string} [param.tokenUid] UID of the token to handle on this wallet
 * @param {string} [param.password] Password to encrypt the seed
 * @param {string} [param.pinCode] PIN to execute wallet actions
 * @param {boolean} [param.debug] Activates debug mode
 * @param {{pubkeys:string[],numSignatures:number}} [param.multisig]
 * @param {string[]} [param.preCalculatedAddresses] An array of pre-calculated addresses
 *
 * @returns {Promise<HathorWallet>}
 */
export async function generateWalletHelper(param) {
  /** @type PrecalculatedWalletData */
  let walletData = {};

  // Only fetch a precalculated wallet if the input does not offer a specific one
  if (!param) {
    walletData = precalculationHelpers.test.getPrecalculatedWallet();
  } else {
    walletData.words = param.seed;
    walletData.addresses = param.preCalculatedAddresses;
  }

  // Start the wallet
  const walletConfig = {
    seed: walletData.words,
    connection: generateConnection(),
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    preCalculatedAddresses: walletData.addresses,
  };
  if (param) {
    Object.assign(walletConfig, param);
  }
  const hWallet = new HathorWallet(walletConfig);
  await hWallet.start();
  await waitForWalletReady(hWallet);
  startedWallets.push(hWallet);

  return hWallet;
}

/**
 *
 * @param [parameters]
 * @param {number} [parameters.walletIndex] Index of the harcoded wallet that will be used
 * @param {string} [parameters.walletWords] Custom wallet words to be used. If informed, all the
 *                                          other parameters (except walletIndex) become mandatory
 * @param {string[]} [parameters.preCalculatedAddresses] Custom pre-calculated addresses, if
 *                                                       walletWords is used
 * @param {string[]} [parameters.pubkeys] Custom pubkeys if walletWords is used
 * @param {number} [parameters.numSignatures] Custom numSignatures if walletWords is used
 *
 * @example
 * const multisigWallet = await generateMultisigWalletHelper({ walletIndex: 0 });
 *
 * @return {Promise<HathorWallet>}
 */
export async function generateMultisigWalletHelper(parameters) {
  // Start the wallet
  const walletConfig = {
    seed: parameters.walletWords || multisigWalletsData.words[parameters.walletIndex],
    connection: generateConnection(),
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    preCalculatedAddresses: parameters.preCalculatedAddresses || WALLET_CONSTANTS.multisig.addresses,
    multisig: {
      pubkeys: parameters.pubkeys || multisigWalletsData.pubkeys,
      numSignatures: parameters.numSignatures || 3,
    }
  };
  const mhWallet = new HathorWallet(walletConfig);
  await mhWallet.start();
  await waitForWalletReady(mhWallet);
  startedWallets.push(mhWallet);

  return mhWallet;
}

export async function stopAllWallets() {
  let hWallet;
  // Stop all wallets that were started with this helper
  while (hWallet = startedWallets.pop()) {
    try {
      hWallet.stop();
    } catch (e) {
      loggers.test.error(e.stack);
    }
  }
}

/**
 * Creates a token and awaits for it to be processed by the wallet.
 * @param {HathorWallet} hWallet
 * @param {string} name Name of the token
 * @param {string} symbol Symbol of the token
 * @param {number} amount Quantity of the token to be minted
 * @param [options] Options parameters
 * @param {string} [options.address] address of the minted token
 * @param {string} [options.changeAddress] address of the change output
 * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
 * @param {string} [options.pinCode] pin to decrypt xpriv information.
 *                                   Optional but required if not set in this
 *
 * @return {Promise<CreateNewTokenResponse>}
 */
export async function createTokenHelper(hWallet, name, symbol, amount, options) {
  const newTokenResponse = await hWallet.createNewToken(
    name,
    symbol,
    amount,
    options,
  );
  const tokenUid = newTokenResponse.hash;
  await waitForTxReceived(hWallet, tokenUid);
  await waitUntilNextTimestamp(hWallet, tokenUid);
  return newTokenResponse;
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
        resolve();
      } else if (newState === HathorWallet.ERROR) {
        reject(new Error('Genesis wallet failed to start.'));
      }
    });
  });
}

/**
 * Translates the tx success event into a promise.
 * Waits for the wallet event that indicates this transaction id has been fully integrated
 * into the lib's local caches. Actions that depend on this state can be executed after the
 * successful response from this function.
 * @param {HathorWallet} hWallet
 * @param {string} txId
 * @param {number} [timeout] Timeout in milisseconds. Default value defined on test-constants.
 * @returns {Promise<SendTxResponse>}
 */
export async function waitForTxReceived(hWallet, txId, timeout) {
  const startTime = Date.now().valueOf();
  let alreadyResponded = false;
  const existingTx = hWallet.getTx(txId);

  // If the transaction was already received, return it immediately
  if (existingTx) {
    return existingTx;
  }

  // Only return the positive response after the transaction was received by the websocket
  return new Promise(async (resolve, reject) => {
    // Event listener
    const handleNewTx = newTx => {
      // Ignore this event if we didn't receive the transaction we expected.
      if (newTx.tx_id !== txId) {
        return;
      }

      // This is the correct transaction: resolving the promise.
      resolveWithSuccess(newTx);
    };
    hWallet.on('new-tx', handleNewTx);

    // Timeout handler
    const timeoutPeriod = timeout || TX_TIMEOUT_DEFAULT;
    setTimeout(async () => {
      hWallet.removeListener('new-tx', handleNewTx);

      // No need to respond if the event listener worked.
      if (alreadyResponded) {
        return;
      }

      // Event listener did not receive the tx and it is not on local cache.
      alreadyResponded = true;
      reject(new Error(`Timeout of ${timeoutPeriod}ms without receiving tx ${txId}`));
    }, timeoutPeriod);

    async function resolveWithSuccess(newTx) {
      const timeDiff = Date.now().valueOf() - startTime;
      if (DEBUG_LOGGING) {
        loggers.test.log(`Wait for ${txId} took ${timeDiff}ms.`);
      }

      if (alreadyResponded) {
        return;
      }
      alreadyResponded = true;

      /*
       * Sometimes even after receiving the `new-tx` event, the transaction is not available on
       * memory. The code below tries to eliminate these short time-senstive issues with a minimum
       * of delays.
       */
      await delay(50);
      let txObj = hWallet.getTx(txId);
      while (!txObj) {
        if (DEBUG_LOGGING) {
          loggers.test.warn(`Tx was not available on history. Waiting for 50ms and retrying.`);
        }
        await delay(50);
        txObj = hWallet.getTx(txId);
      }
      resolve(newTx);
    }
  });
}

/**
 * This method helps a tester to ensure the current timestamp of the next transaction will be at
 * least one unit greater than the specified transaction.
 *
 * Hathor's timestamp has a granularity of seconds, and it does not allow one transaction to have a
 * parent with a timestamp equal to its own.
 *
 * It does not return any content, only delivers the code processing back to the caller at the
 * desired time.
 *
 * @param {HathorWallet} hWallet
 * @param {string} txId
 * @returns {void}
 */
export async function waitUntilNextTimestamp(hWallet, txId) {
  const { timestamp } = hWallet.getTx(txId);
  const nowMilliseconds = Date.now().valueOf();
  const nextValidMilliseconds = (timestamp + 1) * 1000;

  // We are already past the last valid milissecond
  if (nowMilliseconds > nextValidMilliseconds) {
    return;
  }

  // We are still within an invalid time to generate a new timestamp. Waiting for some time...
  const timeToWait = nextValidMilliseconds - nowMilliseconds + 10;
  loggers.test.log(`Waiting for ${timeToWait}ms for the next timestamp.`);
  await delay(timeToWait);
}
