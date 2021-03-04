/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { crypto, HDPublicKey, HDPrivateKey, Address } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { HD_WALLET_ENTROPY } from '../constants';
import { XPubError, InvalidWords, UncompressedPubKeyError } from '../errors';
import Network from '../models/network';
import _ from 'lodash';


const wallet = {
  /**
   * Verify if words passed to generate wallet are valid. In case of invalid, returns message
   *
   * @param {string} words Words (separated by space) to generate the HD Wallet seed
   *
   * @return {Object} {'valid': boolean, 'invalidWords': Array[string], 'words': string} where 'words' is a cleaned
   * string with the words separated by a single space and invalidWords is an array of invalid words
   * @throws {InvalidWords} In case the words string is invalid
   *
   * @memberof Wallet
   * @inner
   */
  wordsValid(words: string): {valid: boolean, invalidWords?: string[], words?: string} {
    let newWordsString = '';
    if (_.isString(words)) {
      // 1. Replace all non ascii chars by a single space
      // 2. Remove one or more spaces (or line breaks) before and after the 24 words
      // 3. Set text to lower case
      newWordsString = words.replace(/[^A-Za-z0-9]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const wordsArray = newWordsString.split(' ');
      if (wordsArray.length !== 24) {
        // Must have 24 words
        throw new InvalidWords('Must have 24 words.')
      } else if (!Mnemonic.isValid(newWordsString)) {
        // Check if there is a word that does not belong to the list of possible words
        const wordlist = Mnemonic.Words.ENGLISH;
        const errorList: string[] = [];

        for (const word of wordsArray) {
          if (wordlist.indexOf(word) < 0) {
            errorList.push(word);
          }
        }

        let errorMessage = '';
        if (errorList.length > 0) {
          return {'valid': false, 'invalidWords': errorList};
        } else {
          // Invalid sequence of words
          throw new InvalidWords('Invalid sequence of words.')
        }
      }
    } else {
      // Must be string
      throw new InvalidWords('Words must be a string.')
    }
    return {'valid': true, 'words': newWordsString};
  },

  /**
   * Generate HD wallet words
   *
   * @param {number} entropy Data to generate the HD Wallet seed - entropy (256 - to generate 24 words)
   *
   * @return {string} words generated
   * @memberof Wallet
   * @inner
   */
  generateWalletWords(entropy: number = HD_WALLET_ENTROPY): string {
    const code = new Mnemonic(entropy);
    return code.phrase;
  },

  /**
   * Get xpub from data
   *
   * @param {Buffer} pubkey Compressed public key
   * @param {Buffer} chainCode HDPublic key chaincode
   * @param {Buffer} fingerprint parent fingerprint
   * @param {string} networkName Optional parameter to select the used network (default is mainnet)
   *
   * @return {String} Xpub
   *
   * @memberof Wallet
   * @inner
   */
  xpubFromData(pubkey: Buffer, chainCode: Buffer, fingerprint: Buffer, networkName: string = 'mainnet'): string {
    const network = new Network(networkName);
    const hdpubkey = new HDPublicKey({
      network: network.bitcoreNetwork,
      depth: 4,
      parentFingerPrint: fingerprint,
      childIndex: 0,
      chainCode: chainCode,
      publicKey: pubkey
    });

    return hdpubkey.xpubkey;
  },

  /**
   * Get compressed public key from uncompressed
   *
   * @param {Buffer} pubkey Uncompressed public key
   *
   * @return {Buffer} Compressed public key
   * @throws {UncompressedPubKeyError} In case the given public key is invalid
   *
   * @memberof Wallet
   * @inner
   */
  toPubkeyCompressed(pubkey: Buffer): Buffer {
    if (pubkey.length !== 65) {
      throw new UncompressedPubKeyError('Invalid uncompressed public key size.');
    }
    const x = pubkey.slice(1, 33);
    const y = pubkey.slice(33, 65);
    const point = new crypto.Point(x, y);
    return crypto.Point.pointToCompressed(point);
  },

  /**
   * Get public key for specific key index derivation
   *
   * @param {number} index Index of the key to derive
   *
   * @return {Object} Public key object
   * @throws {XPubError} In case the given xpub key is invalid
   *
   * @memberof Wallet
   * @inner
   */
  getPublicKeyFromXpub(xpubkey: string, index: number): Buffer {
    let xpub;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error) {
      throw new XPubError(error.message);
    }
    const key = xpub.derive(index);
    return key.publicKey;
  },

  /**
   * Get xpubkey from xpriv
   *
   * @param {String} xpriv Private key
   *
   * @return {String} Wallet xpubkey
   * @memberof Wallet
   * @inner
   */
  getXPubKeyFromXPrivKey(xpriv: string): string {
    const privateKey = HDPrivateKey(xpriv)
    return privateKey.xpubkey;
  },

  getXPubKeyFromSeed(seed: string, options: { passphrase?: string, networkName?: string } = {}): string {
    const methodOptions = Object.assign({passphrase: '', networkName: 'mainnet'}, options);
    const { passphrase, networkName } = methodOptions;

    const network = new Network(networkName);
    const code = new Mnemonic(seed);
    const xpriv = code.toHDPrivateKey(passphrase, network.bitcoreNetwork);
    return this.getXPubKeyFromXPrivKey(xpriv);
  },

  /**
   * Validate an xpubkey.
   *
   * @param {string} xpubkey The xpubkey
   *
   * @return {boolean} true if it's a valid xpubkey, false otherwise
   * @memberof Wallet
   * @inner
   */
  isXpubKeyValid(xpubkey: string): boolean {
    try {
      HDPublicKey(xpubkey);
      return true
    } catch (error) {
      return false;
    }
  },

  /**
   * Get Hathor addresses in bulk, passing the start index and quantity of addresses to be generated
   *
   * @example
   * ```
   * getAddresses('myxpub', 2, 3, 'mainnet') => {
   *   'address2': 2,
   *   'address3': 3,
   *   'address4': 4,
   * }
   * ```
   *
   * @param {string} xpubkey The xpubkey
   * @param {number} startIndex Generate addresses starting from this index
   * @param {number} quantity Amount of addresses to generate
   * @param {string} networkName 'mainnet' or 'testnet'
   *
   * @return {Object} An object with the generated addresses and corresponding index (string => number)
   * @throws {XPubError} In case the given xpub key is invalid
   * @memberof Wallet
   * @inner
   */
  getAddresses(xpubkey: string, startIndex: number, quantity: number, networkName: string = 'mainnet'): Object {
    let xpub;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error) {
      throw new XPubError(error.message);
    }

    const network = new Network(networkName);

    const addrMap = {};
    for (let index = startIndex; index < startIndex + quantity; index++) {
      const key = xpub.derive(index);
      const address = Address(key.publicKey, network.bitcoreNetwork);
      addrMap[address.toString()] = index;
    }
    return addrMap;
  }
}

export default wallet;
