/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import { Address, Script } from 'bitcore-lib';
import walletUtils from '../../../src/utils/wallet';
import { NETWORK_NAME } from '../configuration/test-constants';
import testConfig from '../configuration/test.config';
import { deriveAddressFromXPubP2PKH } from '../../../src/utils/address';
import { loggers } from '../utils/logger.util';

/**
 * Precalculated wallet data containing addresses and related information
 */
export interface PrecalculatedWalletData {
  /** Indicates if this wallet was already used */
  isUsed: boolean;
  /** 24-word seed */
  words: string;
  /** List of pre-calculated addresses */
  addresses: string[];
  /** Optional multisig debug information */
  multisigDebugData?: {
    /** Amount of pubkeys composing this multisig wallet */
    total: number;
    /** Minimum amount of signatures */
    minSignatures: number;
    /** Public keys for this multisig wallet */
    pubkeys: string[];
  };
}

export const precalculationHelpers: {
  test: WalletPrecalculationHelper | null;
} = {
  test: null,
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
    pubkeys: [] as string[],
    total: 5,
    minSignatures: 3,
  },
};
multisigWalletsData.walletConfig.pubkeys = multisigWalletsData.pubkeys;

export class WalletPrecalculationHelper {
  /**
   * Generates 22 addresses for a wallet 24-word seed.
   * @param [params]
   * @param {string} [params.words] Optional wallet seed words.
   *    If empty on common wallets, generates a random seed of 24 words and derives its addresses.
   * @param {number} [params.addressIntervalStart=0] Optional interval start index ( including )
   * @param {number} [params.addressIntervalEnd=22] Optional interval end index ( excluding )
   * @param {{minSignatures:number, wordsArray:string[]}} [params.multisig] Optional multisig object
   * @returns {PrecalculatedWalletData}
   */
  static generateAddressesFromWords(
    params: {
      words?: string;
      addressIntervalStart?: number;
      addressIntervalEnd?: number;
      multisig?: { minSignatures: number; wordsArray: string[] };
    } = {}
  ): PrecalculatedWalletData {
    const timeStart = Date.now().valueOf();
    let wordsInput = params.words;

    // Calculating addresses
    const addressIntervalStart = params.addressIntervalStart || 0;
    const addressIntervalEnd = params.addressIntervalEnd || 22;
    const addressesArray: string[] = [];
    let multisigDebugData: PrecalculatedWalletData['multisigDebugData'];
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
        wordsInput = walletUtils.generateWalletWords();
      }

      /*
       * Since the objective of this script is to mimic the addresses generated on a simple `/start`
       * request for the Wallet Headless, we use this standard derivation index.
       * Future changes on this walletUtils method may cause this step to produce different results.
       */
      const accountDerivationIndex = "0'/0";

      // Common address calculation
      const xpubkey = walletUtils.getXPubKeyFromSeed(wordsInput, {
        networkName: NETWORK_NAME,
        accountDerivationIndex,
      });
      for (let i = addressIntervalStart; i < addressIntervalEnd; i++) {
        const addrInfo = deriveAddressFromXPubP2PKH(xpubkey, i, NETWORK_NAME);
        addressesArray.push(addrInfo.base58);
      }
    }

    // Finishing benchmark and returning results
    const timeEnd = Date.now().valueOf();
    const timeDiff = timeEnd - timeStart;
    loggers.test!.log(`Wallet calculation made in ${timeDiff}ms`);

    const returnObject: PrecalculatedWalletData = {
      isUsed: false,
      words: wordsInput || '',
      addresses: addressesArray,
    };
    if (params.multisig && multisigDebugData) {
      returnObject.multisigDebugData = multisigDebugData;
    }
    return returnObject;
  }

  /**
   * Generates multiple new wallets and return them on an array
   * @param [params]
   * @param {number} [params.commonWallets=100] Amount of common wallets to be generated
   * @param {boolean} [params.verbose] Optional logging of each wallet
   * @returns {{words:string, addresses:string[]}[]}
   */
  static generateMultipleWallets(
    params: {
      commonWallets?: number;
      verbose?: boolean;
    } = {}
  ): PrecalculatedWalletData[] {
    const amountOfCommonWallets = params.commonWallets || 100;

    const wallets: PrecalculatedWalletData[] = [];
    for (let i = 0; i < amountOfCommonWallets; ++i) {
      wallets.push(WalletPrecalculationHelper.generateAddressesFromWords());
      if (params.verbose) loggers.test!.log(`Generated ${i}`);
    }

    return wallets;
  }

  /**
   * Generates wallets for each of the seed words on a same multisig wallet
   * @param params
   * @param {string[]} params.wordsArray An array with each element containing 24 words
   * @param {number} params.minSignatures Minimum of signatures for this multisig wallet
   * @returns {PrecalculatedWalletData[]}
   */
  static generateMultisigWalletsForWords(
    params: {
      wordsArray: string[];
      minSignatures: number;
    } = { wordsArray: [], minSignatures: 0 }
  ): PrecalculatedWalletData[] {
    const resultingWallets: PrecalculatedWalletData[] = [];
    for (const walletWords of params.wordsArray) {
      const multisigWallet = WalletPrecalculationHelper.generateAddressesFromWords({
        words: walletWords,
        multisig: {
          wordsArray: params.wordsArray,
          minSignatures: params.minSignatures,
        },
      });
      resultingWallets.push(multisigWallet);
    }
    return resultingWallets;
  }

  /**
   * Fetches a fresh precalculated wallet from the wallet provider service.
   * Each call returns a newly generated wallet, so callers never need to worry
   * about a pool running out.
   * @returns {Promise<PrecalculatedWalletData>}
   */
  // eslint-disable-next-line class-methods-use-this -- kept as an instance method to preserve the precalculationHelpers.test call sites
  async getPrecalculatedWallet(): Promise<PrecalculatedWalletData> {
    const { data } = await axios.get(`${testConfig.walletProviderUrl}/simpleWallet`);
    // Fail loudly with the raw payload if it ever returns an unexpected shape — otherwise a malformed
    // response surfaces as a confusing error deep inside wallet construction.
    if (!data?.words || !Array.isArray(data?.addresses)) {
      throw new Error(`Wallet provider returned an unexpected response: ${JSON.stringify(data)}`);
    }
    return { isUsed: true, words: data.words, addresses: data.addresses };
  }
}
