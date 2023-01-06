/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { crypto, util, HDPublicKey, HDPrivateKey, Script } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { HD_WALLET_ENTROPY, HATHOR_BIP44_CODE, P2SH_ACCT_PATH, P2PKH_ACCT_PATH, WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../constants';
import { OP_0 } from '../opcodes';
import { XPubError, InvalidWords, UncompressedPubKeyError } from '../errors';
import Network from '../models/network';
import _ from 'lodash';
import helpers from './helpers';

import { IMultisigData, IWalletAccessData, WalletType, WALLET_FLAGS } from '../types';
import { encryptData } from './crypto';


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
   * @param {number?} index Index of the key to derive, if not present no derivation will be made.
   *
   * @return {Object} Public key object
   * @throws {XPubError} In case the given xpub key is invalid
   *
   * @memberof Wallet
   * @inner
   */
  getPublicKeyFromXpub(xpubkey: string, index?: number): Buffer {
    let xpub: HDPublicKey;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new XPubError(error.message);
      } else {
        throw new XPubError(error);
      }
    }
    if (index === undefined) {
      return xpub.publicKey;
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
   * Get root privateKey from seed
   *
   * TODO: Change method name as we are not returning a xpriv
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
   * TODO: Method name is misleading as we are returning a HDPrivateKey and not a xpriv, we should change it
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
    let xpub: HDPublicKey;
    try {
      xpub = HDPublicKey(xpubkey);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new XPubError(error.message);
      } else {
        throw new XPubError(error);
      }
    }

    const derivedXpub = xpub.deriveChild(derivationIndex);
    return derivedXpub.xpubkey;
  },

  /**
   * Create a P2SH MultiSig redeem script
   *
   * @param {string[]} xpubs The list of xpubkeys involved in this MultiSig
   * @param {number} numSignatures Minimum number of signatures to send a
   * transaction with this MultiSig
   * @param {number} index Index to derive the xpubs
   *
   * @return {Buffer} A buffer with the redeemScript
   * @throws {XPubError} In case any of the given xpubs are invalid
   * @memberof Wallet
   * @inner
   */
  createP2SHRedeemScript(xpubs: string[], numSignatures: number, index: number): Buffer {
    const sortedXpubs = _.sortBy(xpubs.map(xp => new HDPublicKey(xp)), (xpub: HDPublicKey) => {
      return xpub.publicKey.toString('hex');
    });

    // xpub comes derived to m/45'/280'/0'
    // Derive to m/45'/280'/0'/0/index
    const pubkeys = sortedXpubs.map((xpub: HDPublicKey) => xpub.deriveChild(0).deriveChild(index).publicKey);

    // bitcore-lib sorts the public keys by default before building the script
    // noSorting prevents that and keeps our order
    const redeemScript = Script.buildMultisigOut(pubkeys, numSignatures, {noSorting: true});
    return redeemScript.toBuffer();
  },

  /**
   * Create a P2SH MultiSig input data from the signatures and redeemScript
   *
   * @param {Buffer[]} signatures The list of signatures collected from participants.
   * @param {Buffer} redeemScript The redeemScript as a Buffer
   *
   * @return {Buffer} A buffer with the input data to send.
   * @memberof Wallet
   * @inner
   */
  getP2SHInputData(signatures: Buffer[], redeemScript: Buffer): Buffer {
    // numSignatures is the first opcode
    const numSignatures = redeemScript.readUInt8() - OP_0.readUInt8();
    if (signatures.length !== numSignatures) {
      throw new Error('Signatures are incompatible with redeemScript');
    }
    const arr: Buffer[] = [];
    let sigCount = 0;
    for (const sig of signatures) {
      helpers.pushDataToStack(arr, sig);
    }
    helpers.pushDataToStack(arr, redeemScript);
    return util.buffer.concat(arr);
  },

  /**
   * Create an HDPublicKey on P2SH MultiSig account path from the root xpriv
   *
   * @param {HDPrivateKey} xpriv HD private key used to derive the multisig xpub.
   *
   * @return {string} xpubkey at MultiSig account path
   * @memberof Wallet
   * @inner
   */
  getMultiSigXPubFromXPriv(xpriv: HDPrivateKey): string {
    const derived = xpriv.deriveNonCompliantChild(P2SH_ACCT_PATH);
    return derived.xpubkey;
  },

  /**
   * Create an HDPublicKey on P2SH MultiSig account path from the seed
   *
   * @param {string} seed space separated list of words to use as seed.
   * @param {Object} options Optionally inform passphrase and network (defaults to no passphrase and mainnet).
   *
   * @return {string} xpubkey at MultiSig account path
   * @memberof Wallet
   * @inner
   */
  getMultiSigXPubFromWords(seed: string, options: { passphrase?: string, networkName?: string } = {}): string {
    const methodOptions = Object.assign({passphrase: '', networkName: 'mainnet'}, options);
    const xpriv = this.getXPrivKeyFromSeed(seed, methodOptions);
    return this.getMultiSigXPubFromXPriv(xpriv);
  },

  generateAccessDataFromXpub(xpubkey: string, {multisig}: {multisig?: IMultisigData}): IWalletAccessData {
    let walletType: WalletType;
    if (multisig === undefined) {
      walletType = WalletType.P2PKH;
    } else {
      walletType = WalletType.MULTISIG;
    }
    let xpub: HDPublicKey;
    let accXPub: HDPublicKey;
    const argXPub = HDPublicKey(xpubkey);
    if (argXPub.depth === 0) {
      if (walletType === WalletType.MULTISIG) {
        accXPub = argXPub.deriveNonCompliantChild(P2SH_ACCT_PATH);
        xpub = accXPub.deriveNonCompliantChild(0);
      } else {
        accXPub = argXPub.deriveNonCompliantChild(P2PKH_ACCT_PATH);
        xpub = accXPub.deriveNonCompliantChild(0);
      }
    } else {
      if (walletType === WalletType.MULTISIG) {
        throw new Error('Cannot start a multisig wallet with a derived xpub');
      }
      xpub = argXPub;
    }

    let multisigData: IMultisigData|undefined;
    if (multisig) {
      multisigData = {
        ...multisig,
        pubkey: accXPub.publicKey.toString('hex'),
      }
    } else {
      multisigData = undefined;
    }

    return {
      xpubkey: xpub.xpubkey,
      walletType,
      multisigData,
      walletFlags: 0 | WALLET_FLAGS.READONLY,
    };
  },

  generateAccessDataFromXpriv(
    xprivkey: string,
    {multisig, pin}: {multisig?: IMultisigData, pin: string},
  ): IWalletAccessData {
    let walletType: WalletType;
    if (multisig === undefined) {
      walletType = WalletType.P2PKH;
    } else {
      walletType = WalletType.MULTISIG;
    }

    const argXpriv = new HDPrivateKey(xprivkey);
    let xpriv: HDPrivateKey;
    if (argXpriv.depth === 0) {
      if (walletType === WalletType.MULTISIG) {
        xpriv = argXpriv.deriveNonCompliantChild(`${P2SH_ACCT_PATH}/0`);
      } else {
        xpriv = argXpriv.deriveNonCompliantChild(`${P2PKH_ACCT_PATH}/0`);
      }
    } else {
      if (walletType === WalletType.MULTISIG) {
        throw new Error('Cannot start a multisig wallet with a derived xpriv');
      }
      xpriv = argXpriv;
    }

    const encryptedMainKey = encryptData(xpriv.xprivkey, pin);

    let multisigData: IMultisigData|undefined;
    if (multisig === undefined) {
      multisigData = undefined;
    } else {
      // For multisig wallets we need to save the pubkey of the account path
      const derivedXpriv = argXpriv.deriveNonCompliantChild(P2SH_ACCT_PATH);
      multisigData = {
        pubkey: derivedXpriv.publicKey.toString('hex'),
        ...multisig,
      };
    }

    return {
      walletType,
      multisigData,
      mainKey: encryptedMainKey,
      xpubkey: xpriv.xpubkey,
      walletFlags: 0,
    };
  },

  generateAccessDataFromSeed(
    words: string,
    {
      multisig,
      passphrase='',
      pin,
      password,
      networkName,
    }: {multisig?: IMultisigData, pin: string, password: string, passphrase?: string, networkName: string},
  ): IWalletAccessData {
    let walletType: WalletType;
    if (multisig === undefined) {
      walletType = WalletType.P2PKH;
    } else {
      walletType = WalletType.MULTISIG;
    }

    const code = new Mnemonic(words);
    const rootXpriv = code.toHDPrivateKey(passphrase, new Network(networkName));
    const authXpriv = rootXpriv.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH);

    let accXpriv: HDPrivateKey;
    let xpriv: HDPrivateKey;
    if (walletType === WalletType.MULTISIG) {
      accXpriv = rootXpriv.deriveNonCompliantChild(P2SH_ACCT_PATH);
      xpriv = accXpriv.deriveNonCompliantChild(0);
    } else {
      accXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
      xpriv = accXpriv.deriveNonCompliantChild(0);
    }

    const encryptedMainKey = encryptData(xpriv.xprivkey, pin);
    const encryptedAuthPathKey = encryptData(authXpriv.xprivkey, pin);
    const encryptedWords = encryptData(words, password);

    let multisigData: IMultisigData|undefined;
    if (multisig === undefined) {
      multisigData = undefined;
    } else {
      // For multisig wallets we need to save the pubkey of the account path
      multisigData = {
        pubkey: accXpriv.publicKey.toString('hex'),
        ...multisig,
      };
    }

    return {
      walletType,
      multisigData,
      xpubkey: xpriv.xpubkey,
      mainKey: encryptedMainKey,
      authKey: encryptedAuthPathKey,
      words: encryptedWords,
      walletFlags: 0,
    };
  },
}

export default wallet;
