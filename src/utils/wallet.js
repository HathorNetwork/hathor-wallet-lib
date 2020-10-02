/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { HDPublicKey, Address } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { HD_WALLET_ENTROPY } from '../constants';
import { XPubError } from '../errors';

const wallet = {
  /**
   * Verify if words passed to generate wallet are valid. In case of invalid, returns message
   *
   * @param {string} words Words (separated by space) to generate the HD Wallet seed
   *
   * @return {Object} {'valid': boolean, 'message': string, 'words': string} where 'words' is a cleaned
   * string with the words separated by a single space
   *
   * @memberof Wallet
   * @inner
   */
  wordsValid(words) {
    let newWordsString = '';
    if (_.isString(words)) {
      // 1. Replace all non ascii chars by a single space
      // 2. Remove one or more spaces (or line breaks) before and after the 24 words
      // 3. Set text to lower case
      newWordsString = words.replace(/[^A-Za-z0-9]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const wordsArray = newWordsString.split(' ');
      if (wordsArray.length !== 24) {
        // Must have 24 words
        return {'valid': false, 'message': 'Must have 24 words'};
      } else if (!Mnemonic.isValid(newWordsString)) {
        // Check if there is a word that does not belong to the list of possible words
        const wordlist = Mnemonic.Words.ENGLISH;
        const errorList = [];

        for (const word of wordsArray) {
          if (wordlist.indexOf(word) < 0) {
            errorList.push(word);
          }
        }

        let errorMessage = '';
        if (errorList.length > 0) {
          errorMessage = `Invalid words: ${errorList.join(' ')}`;
        } else {
          // Invalid sequence of words
          errorMessage = 'Invalid sequence of words';
        }
        return {'valid': false, 'message': errorMessage};
      }
    } else {
      // Must be string
      return {'valid': false, 'message': 'Must be a string'};
    }
    return {'valid': true, 'message': '', 'words': newWordsString};
  },

  /**
   * Generate HD wallet words
   *
   * @param {string|number} entropy Data to generate the HD Wallet seed - entropy (256 - to generate 24 words)
   *
   * @return {string} words generated
   * @memberof Wallet
   * @inner
   */
  generateWalletWords(entropy = HD_WALLET_ENTROPY) {
    const code = new Mnemonic(entropy);
    return code.phrase;
  },

  /**
   * Get xpub from data
   *
   * @param {Buffer} pubkey Compressed public key
   * @param {Buffer} chainCode HDPublic key chaincode
   * @param {Buffer} fingerprint parent fingerprint
   *
   * @return {String} Xpub
   *
   * @memberof Wallet
   * @inner
   */
  xpubFromData(pubkey, chainCode, fingerprint) {
    const hdpubkey = new HDPublicKey({
      network: network.getNetwork(),
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
   *
   * @memberof Wallet
   * @inner
   */
  toPubkeyCompressed(pubkey) {
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
   * @return {Buffer} Public key
   *
   * @memberof Wallet
   * @inner
   */
  getPublicKeyFromXpub(xpubkey, index) {
    let xpub = null;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error) {
      throw new XPubError(error.message);
    }
    const key = xpub.derive(index);
    return key.publicKey.toBuffer();
  },

  /**
   * Get xpubkey from storage xpriv (assumes PIN is correct)
   *
   * @param {String} xpriv Private key
   *
   * @return {String} Wallet xpubkey
   * @memberof Wallet
   * @inner
   */
  getXPubKeyFromXPrivKey(xpriv) {
    const privateKey = HDPrivateKey(xpriv)
    return privateKey.xpubkey;
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
  isXpubKeyValid(xpubkey) {
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
  getAddresses(xpubkey, startIndex, quantity, networkName) {
    let xpub = null;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error) {
      throw new XPubError(error.message);
    }

    if (networkName) {
      network.setNetwork(networkName);
    }

    const addrMap = {};
    for (let index = startIndex; index < startIndex + quantity; index++) {
      const key = xpub.derive(index);
      const address = Address(key.publicKey, network.getNetwork());
      addrMap[address.toString()] = index;
    }
    return addrMap;
  }
}

export default wallet;
