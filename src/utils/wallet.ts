/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { crypto, HDPublicKey, HDPrivateKey, Address } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { HD_WALLET_ENTROPY, HATHOR_BIP44_CODE } from '../constants';
import { XPubError, InvalidWords, UncompressedPubKeyError } from '../errors';
import Network from '../models/network';
import _ from 'lodash';


const wallet = {
  /**
   * Verify if words passed to generate wallet are valid. In case of invalid, returns message
   *
   * @param {string} words Words (separated by space) to generate the HD Wallet seed
   *
   * @return {Object} {'valid': boolean, 'words': string} where 'words' is a cleaned
   * string with the words separated by a single space
   * @throws {InvalidWords} In case the words string is invalid. The error object will have
   * an invalidWords attribute with an array of words that are not valid.
   *
   * @memberof Wallet
   * @inner
   */
  wordsValid(words: string): {valid: boolean, words: string} {
    if (!_.isString(words)) {
      // Must be string
      throw new InvalidWords('Words must be a string.')
    }

    let newWordsString = '';
    // 1. Replace all non ascii chars by a single space
    // 2. Remove one or more spaces (or line breaks) before and after the 24 words
    // 3. Set text to lower case
    newWordsString = words.replace(/[^A-Za-z0-9]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const wordsArray = newWordsString.split(' ');

    const getInvalidWords = (words: string[]): string[] => {
      const wordlist = Mnemonic.Words.ENGLISH;
      const errorList: string[] = [];

      for (const word of words) {
        if (wordlist.indexOf(word) < 0) {
          errorList.push(word);
        }
      }
      return errorList;
    }

    if (wordsArray.length !== 24) {
      // Must have 24 words
      const err = new InvalidWords('Must have 24 words.')
      err.invalidWords = getInvalidWords(wordsArray);
      throw err;
    } else if (!Mnemonic.isValid(newWordsString)) {
      // Check if there is a word that does not belong to the list of possible words
      const errorList = getInvalidWords(wordsArray);
      let errorMessage = '';
      if (errorList.length > 0) {
        const err = new InvalidWords('Invalid words.');
        err.invalidWords = errorList;
        throw err
      } else {
        // Invalid sequence of words
        throw new InvalidWords('Invalid sequence of words.')
      }
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
   * Get public key for specific key index derivation.
   * We expect to receive the xpub after the derivation and the index to get the public key
   * Example: to get the public key of the path m/44'/280/0'/0/{index}
   * you must send in this method the xpubkey from m/44'/280/0'/0 and the index you want to derive
   *
   * @param {String} xpubkey Xpub of the path before the last derivation
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
    const key = xpub.deriveChild(index);
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

  /**
   * Get xpubkey in account derivation path from seed
   *
   * @param {String} seed 24 words
   * @param {Object} options Options with passphrase, networkName and accountDerivationIndex
   *
   * @return {String} Wallet xpubkey
   * @memberof Wallet
   * @inner
   */
  getXPubKeyFromSeed(seed: string, options: { passphrase?: string, networkName?: string, accountDerivationIndex?: string } = {}): string {
    const methodOptions = Object.assign({passphrase: '', networkName: 'mainnet', accountDerivationIndex: '0\''}, options);
    const { accountDerivationIndex } = methodOptions;

    const xpriv = this.getXPrivKeyFromSeed(seed, methodOptions);
    // We have a fixed derivation until the coin index
    // after that we can receive a different account index, which the default is 0'
    const privkey = this.deriveXpriv(xpriv, accountDerivationIndex);
    return privkey.xpubkey;
  },

  /**
   * Get auth xpubkey in the 280' purpose path from seed
   *
   * @param {String} seed 24 words
   * @param {Object} options Options with passphrase and networkName
   *
   * @return {String} Wallet xpubkey
   * @memberof Wallet
   * @inner
   */
  getAuthXPubKeyFromSeed(seed: string, options: { passphrase?: string, networkName?: string } = {}): string {
    const methodOptions = Object.assign({passphrase: '', networkName: 'mainnet', accountDerivationIndex: '0\''}, options);
    const { accountDerivationIndex } = methodOptions;

    const xpriv = this.getXPrivKeyFromSeed(seed, methodOptions);
    const privkey = this.deriveAuthXpriv(xpriv);

    return privkey.xpubkey;
  },

  /**
   * Derive xpriv from root to the auth specific purpose derivation path
   *
   * @param {string} accountDerivationIndex String with derivation index of account (can be hardened)
   *
   * @return {HDPrivateKey} Derived private key
   * @memberof Wallet
   * @inner
   */
  deriveAuthXpriv(xpriv: HDPrivateKey): HDPrivateKey {
    return xpriv.deriveNonCompliantChild(`m/${HATHOR_BIP44_CODE}'/${HATHOR_BIP44_CODE}'`);
  },

  /**
   * Get root xpriv from seed
   *
   * @param {String} seed 24 words
   * @param {Object} options Options with passphrase, networkName
   *
   * @return {HDPrivateKey} Root HDPrivateKey
   * @memberof Wallet
   * @inner
   */
  getXPrivKeyFromSeed(seed: string, options: { passphrase?: string, networkName?: string} = {}): HDPrivateKey {
    const methodOptions = Object.assign({passphrase: '', networkName: 'mainnet'}, options);
    const { passphrase, networkName } = methodOptions;

    const network = new Network(networkName);
    const code = new Mnemonic(seed);
    return code.toHDPrivateKey(passphrase, network.bitcoreNetwork);
  },

  /**
   * Derive xpriv from root to account derivation path
   *
   * @param {string} accountDerivationIndex String with derivation index of account (can be hardened)
   *
   * @return {HDPrivateKey} Derived private key
   * @memberof Wallet
   * @inner
   */
  deriveXpriv(xpriv: HDPrivateKey, accountDerivationIndex: string): HDPrivateKey {
    return xpriv.deriveNonCompliantChild(`m/44'/${HATHOR_BIP44_CODE}'/${accountDerivationIndex}`);
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
    return HDPublicKey.isValidSerialized(xpubkey);
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
      const key = xpub.deriveChild(index);
      const address = Address(key.publicKey, network.bitcoreNetwork);
      addrMap[address.toString()] = index;
    }
    return addrMap;
  },

  /**
   * Get Hathor address at specific index
   *
   * @param {string} xpubkey The xpubkey in the last derivation path (change level according to BIP0044)
   * @param {number} addressIndex Index of address to generate
   * @param {string} networkName 'mainnet' or 'testnet'
   *
   * @return {string} Address at the requested index
   * @throws {XPubError} In case the given xpub key is invalid
   * @memberof Wallet
   * @inner
   */
  getAddressAtIndex(xpubkey: string, addressIndex: number, networkName: string = 'mainnet'): string {
    let xpub;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error) {
      throw new XPubError(error.message);
    }

    const network = new Network(networkName);

    const key = xpub.deriveChild(addressIndex);
    const address = Address(key.publicKey, network.bitcoreNetwork);

    return address.toString();
  },

  /**
   * Derive next step of child from xpub
   *
   * @param {string} xpubkey The xpubkey
   * @param {number} derivationIndex Index to derive the xpub
   *
   * @return {string} Derived xpub
   * @throws {XPubError} In case the given xpub key is invalid
   * @memberof Wallet
   * @inner
   */
  xpubDeriveChild(xpubkey: string, derivationIndex: number): string {
    let xpub;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error) {
      throw new XPubError(error.message);
    }

    const derivedXpub = xpub.deriveChild(derivationIndex);
    return derivedXpub.xpubkey;
  }
}

export default wallet;
