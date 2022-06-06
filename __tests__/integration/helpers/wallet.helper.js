/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Connection from "../../../src/new/connection";
import {
  DEBUG_LOGGING,
  FULLNODE_URL,
  NETWORK_NAME,
  TX_TIMEOUT_DEFAULT
} from "../configuration/test-constants";
import HathorWallet from "../../../src/new/wallet";
import { precalculationHelpers } from "./wallet-precalculation.helper";
import { GenesisWalletHelper } from "./genesis-wallet.helper";

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

const startedWallets = [];

/**
 * Generates a Wallet from an available precalculated seed
 * @returns {Promise<HathorWallet>}
 */
export async function generateWalletHelper() {
  // Send a transaction to one of the wallet's addresses
  const walletData = precalculationHelpers.test.getPrecalculatedWallet();

  // Start the wallet
  const walletConfig = {
    seed: walletData.words,
    connection: generateConnection(),
    password: 'password',
    pinCode: '000000',
    preCalculatedAddresses: walletData.addresses,
  };
  const hWallet = new HathorWallet(walletConfig);
  await hWallet.start();
  await waitForWalletReady(hWallet);
  startedWallets.push(hWallet);

  return hWallet;
}

export async function stopAllWallets() {
  // Stop all wallets that were started with this helper
  while (true) {
    try {
      const hWallet = startedWallets.pop();
      hWallet.stop();
    } catch (e) {
      console.error(e.stack)
    }

    if (startedWallets.length === 0) {
      break;
    }
  }

  // Also clean any genesis tx listeners that may be open
  const {hWallet: gWallet} = await GenesisWalletHelper.getSingleton();
  gWallet.removeAllListeners('new-tx');
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
 * @param {number} [timeout] Timeout in milisseconds. Default value defined on test-constants.
 * @returns {Promise<SendTxResponse>}
 */
export async function waitForTxReceived(hWallet, txId, timeout) {
  const startTime = Date.now().valueOf();
  let alreadyResponded = false;

  // Only return the positive response after the transaction was received by the websocket
  return new Promise(async (resolve, reject) => {

    // Event listener
    const handleNewTx = newTx => {
      if (newTx.tx_id !== txId) {
        return; // Ignore if we didn't receive the transaction we expected.
      }
      returnSuccess(newTx);
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

      /*
       * If the timeout period passed and did not receive the new-tx event, probably the event
       * was triggered even before this `waitForTxReceived` method was called.
       * We'll try a last time to get the transaction data before rejectingt this promise.
       */
      const existingTx = hWallet.getTx(txId);
      if (existingTx) {
        return returnSuccess(existingTx);
      }

      // Event listener did not receive the tx and it is not on local cache.
      alreadyResponded = true;
      reject(new Error(`Timeout of ${timeoutPeriod}ms without receiving tx ${txId}`))
    }, timeoutPeriod)

    function returnSuccess(newTx) {
      if (DEBUG_LOGGING) {
        const timeDiff = Date.now().valueOf() - startTime;
        console.log(`Wait for ${txId} took ${timeDiff}ms.`)
      }
      if (alreadyResponded) {
        return;
      }

      /*
       * Return the successful transaction, but only after a few milisseconds.
       * If we did not insert this delay here, synchronous operations could fetch memory state
       * from before the transaction.
       */
      setTimeout(() => {
        alreadyResponded = true;
        resolve(newTx);
      }, 10);
    }
  })
}
