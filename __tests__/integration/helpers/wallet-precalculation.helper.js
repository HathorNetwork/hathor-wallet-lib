/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { promises as fs } from 'fs';
import wallet from '../../../src/wallet';
import walletUtils from '../../../src/utils/wallet'
import { Address, Script } from 'bitcore-lib';
import { NETWORK_NAME } from "../configuration/test-constants";

/**
 * @typedef PrecalculatedWalletData
 * @property {boolean} isUsed Indicates if this wallet was already used
 * @property {string} words 24-word seed
 * @property {string[]} addresses List of pre-calculated addresses
 */

export const precalculationHelpers = {
  /**
   * @type WalletPrecalculationHelper
   */
  test: null
};

export const multisigWalletsData = {
  words: [
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind',
    'sample garment fun depart various renew require surge service undo cinnamon squeeze hundred nasty gasp ridge surge defense relax turtle wet antique october occur',
    'intact wool rigid diary mountain issue tiny ugly swing rib alone base fold satoshi drift poverty autumn mansion state globe plug ancient pudding hope',
    'monster opinion bracket aspect mask labor obvious hat matrix exact canoe race shift episode plastic debris dash sort motion juice leg mushroom maximum evidence',
    'tilt lab swear uncle prize favorite river myth assault transfer venue soap lady someone marine reject fork brain swallow notice glad salt sudden pottery',
  ],
  pubkeys: [
    'xpub6CvvCBtHqFfErbcW2Rv28TmZ3MqcFuWQVKGg8xDzLeAwEAHRz9LBTgSFSj7B99scSvZGbq6TxAyyATA9b6cnwsgduNs9NGKQJnEQr3PYtwK',
    'xpub6CA16g2qPwukWAWBMdJKU3p2fQEEi831W3WAs2nesuCzPhbrG29aJsoRDSEDT4Ac3smqSk51uuv6oujU3MAAL3d1Nm87q9GDwE3HRGQLjdP',
    'xpub6BwNT613Vzy7ARVHDEpoX23SMBEZQMJXdqTWYjQKvJZJVDBjEemU38exJEhc6qbFVc4MmarN68gUKHkyZ3NEgXXCbWtoXXGouHpwMEcXJLf',
    'xpub6DCyPHg4AwXsdiMh7QSTHR7afmNVwZKHBBMFUiy5aCYQNaWp68ceQXYXCGQr5fZyLAe5hiJDdXrq6w3AXzvVmjFX9F7EdM87repxJEhsmjL',
    'xpub6CgPUcCCJ9pAK7Rj52hwkxTutSRv91Fq74Hx1SjN62eg6Mp3S3YCJFPChPaDjpp9jCbCZHibBgdKnfNdq6hE9umyjyZKUCySBNF7wkoG4uK',
  ],
  walletConfig: {
    pubkeys: [],
    total: 5,
    minSignatures: 3,
  }
};
multisigWalletsData.walletConfig.pubkeys = multisigWalletsData.pubkeys;

export class WalletPrecalculationHelper {
  WALLETS_FILENAME = '';

  walletsDb = [];

  /**
   * Initializes the helper with a filename to sync the local wallet storage with.
   * @param walletsFilename
   */
  constructor(walletsFilename) {
    this.WALLETS_FILENAME = walletsFilename || './tmp/wallets.txt';
  }

  /**
   * Generates 22 addresses for a wallet 24-word seed.
   * @param [params]
   * @param {string} [params.words] Optional wallet seed words.
   *    If empty on common wallets, generates a random seed of 24 words and derives its addresses.
   * @param {number} [params.addressIntervalStart=0] Optional interval start index ( including )
   * @param {number} [params.addressIntervalEnd=22] Optional interval end index ( excluding )
   * @param {{minSignatures:number,wordsArray:string[]}} [params.multisig] Optional multisig object
   * @returns {{addresses: string[], words: string}}
   */
  static generateAddressesForWordsSeed(params = {}) {
    const timeStart = Date.now().valueOf();
    let wordsInput = params.words;

    // Calculating addresses
    const addressIntervalStart = params.addressIntervalStart || 0;
    const addressIntervalEnd = params.addressIntervalEnd || 22;
    const addressesArray = [];
    let multisigDebugData = null;
    if (params.multisig) {
      // Multisig calculation
      const pubkeys = params.multisig.wordsArray.map(w => walletUtils.getMultiSigXPubFromWords(w));
      for (let i = addressIntervalStart; i < addressIntervalEnd; ++i) {
        const redeemScript = walletUtils.createP2SHRedeemScript(
          pubkeys,
          params.multisig.minSignatures,
          i
        );
        const address = Address.payingTo(Script.fromBuffer(redeemScript), NETWORK_NAME);
        addressesArray.push(address.toString());

        // Informing debug data
        multisigDebugData = {
          total: pubkeys.length,
          minSignatures: params.multisig.minSignatures,
          pubkeys,
        };
      }
    } else {
      // Generating 24-word seed if none was informed
      if (!wordsInput) {
        wordsInput = wallet.generateWalletWords();
      }

      /*
       * Since the objective of this script is to mimic the addresses generated on a simple `/start`
       * request for the Wallet Headless, we use this standard derivation index.
       * Future changes on this walletUtils method may cause this step to produce different results.
       */
      const accountDerivationIndex = '0\'/0';

      // Common address calculation
      const xpubkey = walletUtils.getXPubKeyFromSeed(wordsInput, {
        networkName: NETWORK_NAME,
        accountDerivationIndex,
      });
      const addresses = walletUtils.getAddresses(
        xpubkey,
        addressIntervalStart,
        addressIntervalEnd,
        NETWORK_NAME
      );

      // Formatting addresses to a simple array format
      for (const hash in addresses) {
        addressesArray[addresses[hash]] = hash;
      }
    }

    // Finishing benchmark and returning results
    const timeEnd = Date.now().valueOf();
    const timeDiff = timeEnd - timeStart;

    const returnObject = {
      duration: timeDiff,
      isUsed: false,
      words: wordsInput,
      addresses: addressesArray
    };
    if (params.multisig) {
      returnObject.multisigDebugData = multisigDebugData;
    }
    return returnObject;
  }

  /**
   * Reads a JSON file containing wallets and parses it
   * @returns {Promise<any>}
   * @throws SyntaxError
   * @private
   */
  async _deserializeWalletsFile() {
    const dataBuffer = await fs.readFile(this.WALLETS_FILENAME);
    const strData = dataBuffer.toString();

    try {
      const jsonData = JSON.parse(strData);
      return jsonData;
    } catch (err) {
      console.error('Corrupt wallets file');
      throw err;
    }
  }

  /**
   * Writes the contents of a wallet array in a human-readable way, but with one wallet per line
   * @param {unknown[]} wallets
   * @returns {Promise<void>}
   * @private
   */
  async _serializeWalletsFile(wallets) {
    /*
     * The main aim of this file structure is human readability for debugging.
     * The result must be a valid JSON, but with only one line per wallet.
     */
    let strWalletsData = wallets
      .map(w => `${JSON.stringify(w)}`)
      .join(',\n');
    strWalletsData = `[\n${strWalletsData}\n]`;

    await fs.writeFile(
      this.WALLETS_FILENAME,
      strWalletsData
    );
  }

  /**
   * Generates multiple new wallets and return them on an array
   * @param [params]
   * @param {number} [params.commonWallets=100] Amount of common wallets to be generated
   * @param {boolean} [params.verbose] Optional logging of each wallet
   * @returns {{words:string,addresses:string[]}[]}
   */
  static generateMultipleWallets(params = {}) {
    const amountOfCommonWallets = params.commonWallets || 100;

    const wallets = [];
    for (let i = 0; i < amountOfCommonWallets; ++i) {
      wallets.push(WalletPrecalculationHelper.generateAddressesForWordsSeed());
      if (params.verbose) console.log(`Generated ${i}`);
    }

    return wallets;
  }

  /**
   * Generates wallets for each of the seed words on a same multisig wallet
   * @param params
   * @param {string[]} params.wordsArray An array with each element containing 24 words
   * @param {number} params.minSignatures Minimum of signatures for this multisig wallet
   * @returns {unknown[]}
   */
  static generateMultisigWalletsForWords(params = {}) {
    const resultingWallets = [];
    for (const walletWords of params.wordsArray) {
      const multisigWallet = WalletPrecalculationHelper.generateAddressesForWordsSeed({
        words: walletWords,
        multisig: {
          wordsArray: params.wordsArray,
          minSignatures: params.minSignatures
        }
      });
      resultingWallets.push(multisigWallet);
    }
    return resultingWallets;
  }

  /**
   * Loads a file containing precalculated wallets into the in-memory storage
   * @returns {Promise<void>}
   */
  async initWithWalletsFile() {
    const fileData = await this._deserializeWalletsFile();
    this.walletsDb = fileData;
  }

  /**
   * Writes the in-memory storage of precalculated wallets into the filesystem
   * @returns {Promise<void>}
   */
  async storeDbIntoWalletsFile() {
    return this._serializeWalletsFile(this.walletsDb);
  }

  /**
   * Fetches the first unused precalculated wallet from the in-memory storage and marks it as used.
   * @returns {PrecalculatedWalletData}
   */
  getPrecalculatedWallet() {
    const unusedWallet = this.walletsDb.find(w => !w.isUsed);
    unusedWallet.isUsed = true; // We are using it right now. Marking it.
    return unusedWallet;
  }
}
