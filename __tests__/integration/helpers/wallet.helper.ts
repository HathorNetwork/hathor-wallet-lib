/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get, includes } from 'lodash';
import Connection from '../../../src/new/connection';
import {
  DEBUG_LOGGING,
  FULLNODE_URL,
  NETWORK_NAME,
  TX_TIMEOUT_DEFAULT,
  WALLET_CONSTANTS,
} from '../configuration/test-constants';
import HathorWallet from '../../../src/new/wallet';
import walletUtils from '../../../src/utils/wallet';
import type { PrecalculatedWalletData } from './wallet-precalculation.helper';
import { multisigWalletsData, precalculationHelpers } from './wallet-precalculation.helper';
import { delay } from '../utils/core.util';
import { loggers } from '../utils/logger.util';
import { MemoryStore, Storage } from '../../../src';
import { IHistoryTx, IMultisigData, TxHistoryProcessingStatus } from '../../../src/types';

interface CreateNewTokenResponse {
  hash: string;
  nonce: number;
  timestamp: number;
  version: number;
  weight: number;
  parents: string[];
  inputs: unknown[];
  outputs: unknown[];
  tokens: unknown[];
}

/**
 * Generates a connection object for starting wallets.
 * @returns {Connection}
 */
export function generateConnection(): Connection {
  return new Connection({
    network: NETWORK_NAME,
    servers: [FULLNODE_URL],
    connectionTimeout: 30000,
    logger: console,
  });
}

export const DEFAULT_PASSWORD = 'password';
export const DEFAULT_PIN_CODE = '000000';

const startedWallets: HathorWallet[] = [];

/**
 * Simplifies the generation of a Wallet for the integration tests.
 * When called without parameters, consumes one of the available pre-calculated wallets and returns
 * it initialized.
 *
 * When calling this method with any parameter, please refer to the `walletConfig` object inside to
 * understand what values are being informed to the `HathorWallet` class by default.
 *
 * @param [param] Optional object with properties to override the generated wallet
 * @param {string} [param.seed] 24 words separated by space
 * @param {string} [param.passphrase=''] Wallet passphrase
 * @param {string} [param.xpriv]
 * @param {string} [param.xpub]
 * @param {string} [param.tokenUid] UID of the token to handle on this wallet
 * @param {string|null} [param.password] Password to encrypt the seed
 * @param {string|null} [param.pinCode] PIN to execute wallet actions
 * @param {boolean} [param.debug] Activates debug mode
 * @param {{pubkeys:string[],numSignatures:number}} [param.multisig]
 * @param {string[]} [param.preCalculatedAddresses] An array of pre-calculated addresses
 *
 * @returns {Promise<HathorWallet>}
 *
 * @example
 * const hWalletAuto = await generateWalletHelper();
 * const hWalletManual = await generateWalletHelper({
 *   seed: 'sample words test',
 *   addresses: ['addr0','addr1'],
 * })
 */
export async function generateWalletHelper(param?: {
  seed?: string;
  passphrase?: string;
  xpriv?: string;
  xpub?: string;
  tokenUid?: string;
  password?: string | null;
  pinCode?: string | null;
  debug?: boolean;
  multisig?: { pubkeys: string[]; numSignatures: number };
  preCalculatedAddresses?: string[];
}): Promise<HathorWallet> {
  let walletData: PrecalculatedWalletData = {
    isUsed: false,
    words: '',
    addresses: [],
  };

  // Only fetch a precalculated wallet if the input does not offer a specific one
  if (!param) {
    if (!precalculationHelpers.test) {
      throw new Error('Precalculation helper not initialized');
    }
    walletData = precalculationHelpers.test.getPrecalculatedWallet();
  } else {
    walletData.words = param.seed || '';
    walletData.addresses = param.preCalculatedAddresses || [];
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
 * Simplifies the generation of a readonly wallet for the integration tests.
 *
 * @param {Object} [options] Options to change the wallet configuration
 * @param {string} [options.xpub=undefined] Xpub to use instead of using a pre-calculated one
 * @param {string|null} [options.pinCode] PIN to execute wallet actions
 * @param {string[]} [options.preCalculatedAddresses] An array of pre-calculated addresses
 * @param {boolean} [options.hardware=false] If the wallet is a hardware wallet
 * @param {IMultisigData} [options.multisig] multisig configuration of the wallet
 *
 * @returns {Promise<HathorWallet>}
 *
 * @example
 * const hWalletAuto = await generateWalletHelperRO();
 */
export async function generateWalletHelperRO(
  options: {
    xpub?: string;
    pinCode?: string | null;
    preCalculatedAddresses?: string[];
    hardware?: boolean;
    multisig?: IMultisigData;
  } = {}
): Promise<HathorWallet> {
  let walletData: PrecalculatedWalletData = {
    isUsed: false,
    words: '',
    addresses: [],
  };
  let xpub: string;
  // Only fetch a precalculated wallet if the input does not offer a specific one
  if (!options.xpub) {
    if (!precalculationHelpers.test) {
      throw new Error('Precalculation helper not initialized');
    }
    walletData = precalculationHelpers.test.getPrecalculatedWallet();
    xpub = walletUtils.getXPubKeyFromSeed(walletData.words, { networkName: 'testnet' });
  } else {
    walletData.addresses = options.preCalculatedAddresses || [];
    xpub = options.xpub;
  }

  const accessData = walletUtils.generateAccessDataFromXpub(xpub, {
    multisig: options.multisig,
    hardware: options.hardware,
  });
  const store = new MemoryStore();
  await store.saveAccessData(accessData);
  const storage = new Storage(store);

  // Start the wallet
  const walletConfig = {
    xpub,
    connection: generateConnection(),
    storage,
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    preCalculatedAddresses: walletData.addresses,
  };
  const hWallet = new HathorWallet(walletConfig);
  await hWallet.start();
  await waitForWalletReady(hWallet);
  startedWallets.push(hWallet);

  return hWallet;
}

/**
 *
 * @param [parameters]
 * @param {number} [parameters.walletIndex] Index of the hardcoded wallet that will be used
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
export async function generateMultisigWalletHelper(
  parameters: {
    walletIndex?: number;
    walletWords?: string;
    preCalculatedAddresses?: string[];
    pubkeys?: string[];
    numSignatures?: number;
  } = {}
): Promise<HathorWallet> {
  // Start the wallet
  const walletConfig = {
    seed: parameters.walletWords || multisigWalletsData.words[parameters.walletIndex || 0],
    connection: generateConnection(),
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    preCalculatedAddresses:
      parameters.preCalculatedAddresses || WALLET_CONSTANTS.multisig.addresses,
    multisig: {
      pubkeys: parameters.pubkeys || multisigWalletsData.pubkeys,
      numSignatures: parameters.numSignatures || 3,
    },
  };
  const mhWallet = new HathorWallet(walletConfig);
  await mhWallet.start();
  await waitForWalletReady(mhWallet);
  startedWallets.push(mhWallet);

  return mhWallet;
}

export async function stopAllWallets(): Promise<void> {
  let hWallet = startedWallets.pop();

  // Stop all wallets that were started with this helper
  while (hWallet) {
    try {
      await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
    } catch (e) {
      loggers.test!.error((e as Error).stack);
    }
    hWallet = startedWallets.pop();
  }
}

/**
 * Creates a token and awaits for it to be processed by the wallet.
 * @param {HathorWallet} hWallet
 * @param {string} name Name of the token
 * @param {string} symbol Symbol of the token
 * @param {OutputValueType} amount Quantity of the token to be minted
 * @param [options] Options parameters
 * @param {string} [options.address] address of the minted token
 * @param {string} [options.changeAddress] address of the change output
 * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
 * @param {string} [options.pinCode] pin to decrypt xpriv information.
 *                                   Optional but required if not set in this
 *
 * @return {Promise<CreateNewTokenResponse>}
 */
export async function createTokenHelper(
  hWallet: HathorWallet,
  name: string,
  symbol: string,
  amount: bigint,
  options: {
    address?: string;
    changeAddress?: string;
    startMiningTx?: boolean;
    pinCode?: string;
  } = {}
): Promise<CreateNewTokenResponse> {
  const newTokenResponse = await hWallet.createNewToken(name, symbol, amount, options);
  const tokenUid = newTokenResponse.hash;
  await waitForTxReceived(hWallet, tokenUid);
  await waitUntilNextTimestamp(hWallet, tokenUid);
  return newTokenResponse;
}

/**
 * Translates the Wallet Ready event into a promise
 * Waits for the wallet event that indicates this wallet is ready for use.
 * @param hWallet
 * @returns {Promise<void>}
 */
export function waitForWalletReady(hWallet: HathorWallet): Promise<void> {
  // Only return the positive response after the wallet is ready
  return new Promise<void>((resolve, reject) => {
    const handleState = (newState: string) => {
      if (newState === HathorWallet.READY) {
        resolve();
      } else if (newState === HathorWallet.ERROR) {
        reject(new Error('Wallet failed to start.'));
      }
    };
    hWallet.on('state', handleState);
    // No wallet on tests should take more than 15s to be ready
    setTimeout(() => {
      hWallet.removeListener('state', handleState);
      reject(new Error('Wallet could not be ready.'));
    }, 120000);
  });
}

/**
 * Waits for the wallet to receive the transaction from a websocket message
 * and process the history
 *
 * @param hWallet
 * @param txId
 * @param [timeout] Timeout in milliseconds. Default value defined on test-constants.
 */
export async function waitForTxReceived(
  hWallet: HathorWallet,
  txId: string,
  timeout: number = 0
): Promise<IHistoryTx> {
  const startTime = Date.now().valueOf();
  let timeoutReached = false;
  const timeoutPeriod = timeout || TX_TIMEOUT_DEFAULT;
  // Timeout handler
  const timeoutHandler = setTimeout(() => {
    timeoutReached = true;
  }, timeoutPeriod);

  let storageTx = (await hWallet.getTx(txId)) as IHistoryTx;

  // We consider that the tx was received after it's in the storage
  // and the history processing is finished
  while (!storageTx || storageTx.processingStatus !== TxHistoryProcessingStatus.FINISHED) {
    if (timeoutReached) {
      break;
    }

    // Tx not found, wait 1s before trying again
    await delay(1000);
    storageTx = (await hWallet.getTx(txId)) as IHistoryTx;
  }

  // Clean timeout handler
  if (timeoutHandler) {
    clearTimeout(timeoutHandler);
  }

  if (timeoutReached) {
    // Throw error in case of timeout
    throw new Error(`Timeout of ${timeoutPeriod}ms without receiving the tx with id ${txId}`);
  }

  if (!storageTx) {
    throw new Error('Unexpected error waiting for tx, we found it but it is null');
  }

  const timeDiff = Date.now().valueOf() - startTime;
  if (DEBUG_LOGGING) {
    loggers.test!.log(`Wait for ${txId} took ${timeDiff}ms.`);
  }

  if (storageTx.is_voided === false) {
    // We can't consider the metadata only of the transaction, it affects
    // also the metadata of the transactions that were spent on it.
    // We could await for the update-tx event of the transactions of the inputs to arrive
    // before considering the transaction metadata fully updated, however it's complicated
    // to handle these events, since they might arrive even before we call this method
    // To simplify everything, here we manually set the utxos as spent and process the history
    // so after the transaction arrives, all the metadata involved on it is updated, and we can
    // continue running the tests to correctly check balances, addresses, and everything else
    await updateInputsSpentBy(hWallet, storageTx);
    await hWallet.storage.processHistory();
  }

  return storageTx;
}

/**
 * Loop through all inputs of a tx, get the corresponding transaction in the storage and
 * update the spent_by attribute
 *
 * @param {HathorWallet} hWallet
 * @param {IHistoryTx} tx
 * @returns {Promise<void>}
 */
async function updateInputsSpentBy(hWallet: HathorWallet, tx: IHistoryTx): Promise<void> {
  for (const input of tx.inputs) {
    const inputTx = await hWallet.getTx(input.tx_id);
    if (!inputTx) {
      // This input is not spending an output from this wallet
      continue;
    }

    if (input.index > inputTx.outputs.length - 1) {
      // Invalid output index
      throw new Error("Try to get output in an index that doesn't exist.");
    }

    const output = inputTx.outputs[input.index];
    output.spent_by = tx.tx_id;
    await hWallet.storage.addTx(inputTx);
  }
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
 * @returns {Promise<void>}
 */
export async function waitUntilNextTimestamp(hWallet: HathorWallet, txId: string): Promise<void> {
  const tx = await hWallet.getTx(txId);
  if (!tx) {
    throw new Error('Transaction not found');
  }
  const { timestamp } = tx;
  const nowMilliseconds = Date.now().valueOf();
  const nextValidMilliseconds = (timestamp + 1) * 1000;

  // We are already past the last valid millisecond
  if (nowMilliseconds > nextValidMilliseconds) {
    return;
  }

  // We are still within an invalid time to generate a new timestamp. Waiting for some time...
  const timeToWait = nextValidMilliseconds - nowMilliseconds + 10;
  loggers.test!.log(`Waiting for ${timeToWait}ms for the next timestamp.`);
  await delay(timeToWait);
}

/**
 * This method gets the current height of the network
 * and waits until the height changes
 *
 * We are ignoring the possibility of reorgs here, we
 * assume that if the height changes, a new block has arrived
 *
 * @param {Storage} storage
 * @returns {Promise<void>}
 */
export async function waitNextBlock(storage: Storage): Promise<void> {
  const currentHeight = await storage.getCurrentHeight();
  let height = currentHeight;

  // This timeout is a protection, so the integration tests
  // don't keep running in case of a problem
  // After using the timeout as 120s, we had some timeouts
  // because the CI runs in a free GitHub runner
  // so we decided to increase this timeout to 600s, so
  // we don't have this error anymore
  const timeout = 600000;
  let timeoutReached = false;
  // Timeout handler
  const timeoutHandler = setTimeout(() => {
    timeoutReached = true;
  }, timeout);

  while (height === currentHeight) {
    if (timeoutReached) {
      break;
    }

    await delay(1000);
    height = await storage.getCurrentHeight();
  }

  // Clear timeout handler
  clearTimeout(timeoutHandler);

  if (timeoutReached) {
    throw new Error('Timeout reached when waiting for the next block.');
  }
}

/**
 * This method awaits a tx to be confirmed by a block and then resolves the promise.
 *
 * It does not return any content, only delivers the code processing back to the caller at the
 * desired time.
 *
 * @param hWallet
 * @param txId
 * @param timeout
 * @returns {Promise<void>}
 */
export async function waitTxConfirmed(
  hWallet: HathorWallet,
  txId: string,
  timeout: number | null | undefined
): Promise<void> {
  let timeoutHandler: ReturnType<typeof setTimeout> | undefined;
  let timeoutErrorFlag = false;

  // Initializing timeout handler, if requested
  if (timeout) {
    timeoutHandler = setTimeout(async () => {
      timeoutErrorFlag = true;
    }, timeout);
  }

  try {
    // Only return the positive response after the tx has a first block
    // the nano contract txs are executing the method as soon as they arrive in the node
    // and adding the first_block as mempool so we shouldn't consider this as a valid first block for confirmation
    while (includes([null, 'mempool'], await getTxFirstBlock(hWallet, txId))) {
      await delay(1000);

      // If we've reached the requested timeout, break the while loop
      if (timeoutErrorFlag) {
        break;
      }
    }
  } catch {
    // Get API request might fail, so we reject the promise
    throw new Error('Error getting transaction first block.');
  }

  // Throw the timeout error if the loop aborted because of it
  if (timeoutErrorFlag) {
    throw new Error(`Timeout of ${timeout}ms without confirming the transaction`);
  }

  // If no errors happened it means the first block was found: clearing the timeout and returning void.
  if (timeoutHandler) {
    clearTimeout(timeoutHandler);
  }
}

/**
 * This method returns the first block of a transaction
 *
 * @param {HathorWallet} hWallet
 * @param {String} txId
 * @returns {Promise<String>}
 */
export async function getTxFirstBlock(hWallet: HathorWallet, txId: string): Promise<string> {
  const txData = await hWallet.getFullTxById(txId);
  return get(txData, 'meta.first_block');
}
