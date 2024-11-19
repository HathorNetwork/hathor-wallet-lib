"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
var _bitcoreMnemonic = _interopRequireDefault(require("bitcore-mnemonic"));
var _lodash = _interopRequireDefault(require("lodash"));
var _constants = require("../constants");
var _opcodes = require("../opcodes");
var _errors = require("../errors");
var _network = _interopRequireDefault(require("../models/network"));
var _helpers = _interopRequireDefault(require("./helpers"));
var _types = require("../types");
var _crypto = require("./crypto");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const wallet = {
  /**
   * Get the wallet id given the change path xpubkey
   *
   * @param {string} xpub - The change path xpubkey
   * @returns {string} The walletId
   *
   * @memberof Wallet
   * @inner
   */
  getWalletIdFromXPub(xpub) {
    return _bitcoreLib.crypto.Hash.sha256sha256(Buffer.from(xpub)).toString('hex');
  },
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
  wordsValid(words) {
    if (!_lodash.default.isString(words)) {
      // Must be string
      throw new _errors.InvalidWords('Words must be a string.');
    }
    let newWordsString = '';
    // 1. Replace all non ascii chars by a single space
    // 2. Remove one or more spaces (or line breaks) before and after the 24 words
    // 3. Set text to lower case
    newWordsString = words.replace(/[^A-Za-z0-9]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const wordsArray = newWordsString.split(' ');
    const getInvalidWords = paramWords => {
      const wordlist = _bitcoreMnemonic.default.Words.ENGLISH;
      const errorList = [];
      for (const word of paramWords) {
        if (wordlist.indexOf(word) < 0) {
          errorList.push(word);
        }
      }
      return errorList;
    };
    if (wordsArray.length !== 24) {
      // Must have 24 words
      const err = new _errors.InvalidWords('Must have 24 words.');
      err.invalidWords = getInvalidWords(wordsArray);
      throw err;
    } else if (!_bitcoreMnemonic.default.isValid(newWordsString)) {
      // Check if there is a word that does not belong to the list of possible words
      const errorList = getInvalidWords(wordsArray);
      if (errorList.length > 0) {
        const err = new _errors.InvalidWords('Invalid words.');
        err.invalidWords = errorList;
        throw err;
      } else {
        // Invalid sequence of words
        throw new _errors.InvalidWords('Invalid sequence of words.');
      }
    }
    return {
      valid: true,
      words: newWordsString
    };
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
  generateWalletWords(entropy = _constants.HD_WALLET_ENTROPY) {
    const code = new _bitcoreMnemonic.default(entropy);
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
  xpubFromData(pubkey, chainCode, fingerprint, networkName = 'mainnet') {
    const network = new _network.default(networkName);
    const hdpubkey = new _bitcoreLib.HDPublicKey({
      network: network.bitcoreNetwork,
      depth: 4,
      parentFingerPrint: fingerprint,
      childIndex: 0,
      chainCode,
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
  toPubkeyCompressed(pubkey) {
    if (pubkey.length !== 65) {
      throw new _errors.UncompressedPubKeyError('Invalid uncompressed public key size.');
    }
    const x = pubkey.slice(1, 33);
    const y = pubkey.slice(33, 65);
    const point = new _bitcoreLib.crypto.Point(x, y);
    return _bitcoreLib.crypto.Point.pointToCompressed(point);
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
  getPublicKeyFromXpub(xpubkey, index) {
    let xpub;
    try {
      xpub = (0, _bitcoreLib.HDPublicKey)(xpubkey);
    } catch (error) {
      if (error instanceof Error) {
        throw new _errors.XPubError(error.message);
      } else {
        throw new _errors.XPubError(error);
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
  getXPubKeyFromXPrivKey(xpriv) {
    const privateKey = (0, _bitcoreLib.HDPrivateKey)(xpriv);
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
  getXPubKeyFromSeed(seed, options = {}) {
    const methodOptions = {
      passphrase: '',
      networkName: 'mainnet',
      accountDerivationIndex: "0'",
      ...options
    };
    const {
      accountDerivationIndex
    } = methodOptions;
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
  getXPrivKeyFromSeed(seed, options = {}) {
    const methodOptions = {
      passphrase: '',
      networkName: 'mainnet',
      ...options
    };
    const {
      passphrase,
      networkName
    } = methodOptions;
    const network = new _network.default(networkName);
    const code = new _bitcoreMnemonic.default(seed);
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
  deriveXpriv(xpriv, accountDerivationIndex) {
    return xpriv.deriveNonCompliantChild(`m/44'/${_constants.HATHOR_BIP44_CODE}'/${accountDerivationIndex}`);
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
    return _bitcoreLib.HDPublicKey.isValidSerialized(xpubkey);
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
  xpubDeriveChild(xpubkey, derivationIndex) {
    let xpub;
    try {
      xpub = (0, _bitcoreLib.HDPublicKey)(xpubkey);
    } catch (error) {
      if (error instanceof Error) {
        throw new _errors.XPubError(error.message);
      } else {
        throw new _errors.XPubError(error);
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
  createP2SHRedeemScript(xpubs, numSignatures, index) {
    const sortedXpubs = _lodash.default.sortBy(xpubs.map(xp => new _bitcoreLib.HDPublicKey(xp)), xpub => {
      return xpub.publicKey.toString('hex');
    });

    // xpub comes derived to m/45'/280'/0'
    // Derive to m/45'/280'/0'/0/index
    const pubkeys = sortedXpubs.map(xpub => xpub.deriveChild(0).deriveChild(index).publicKey);

    // bitcore-lib sorts the public keys by default before building the script
    // noSorting prevents that and keeps our order
    const redeemScript = _bitcoreLib.Script.buildMultisigOut(pubkeys, numSignatures, {
      noSorting: true
    });
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
  getP2SHInputData(signatures, redeemScript) {
    // numSignatures is the first opcode
    const numSignatures = redeemScript.readUInt8(0) - _opcodes.OP_0.readUInt8(0);
    if (signatures.length !== numSignatures) {
      throw new Error('Signatures are incompatible with redeemScript');
    }
    const arr = [];
    for (const sig of signatures) {
      _helpers.default.pushDataToStack(arr, sig);
    }
    _helpers.default.pushDataToStack(arr, redeemScript);
    return _bitcoreLib.util.buffer.concat(arr);
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
  getMultiSigXPubFromXPriv(xpriv) {
    const derived = xpriv.deriveNonCompliantChild(_constants.P2SH_ACCT_PATH);
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
  getMultiSigXPubFromWords(seed, options = {}) {
    const methodOptions = {
      passphrase: '',
      networkName: 'mainnet',
      ...options
    };
    const xpriv = this.getXPrivKeyFromSeed(seed, methodOptions);
    return this.getMultiSigXPubFromXPriv(xpriv);
  },
  /**
   * Generate access data from xpubkey.
   * The access data will be used to start a wallet and derive the wallet's addresses.
   * This method can only generate READONLY wallets since we do not have the private key.
   *
   * We can only accept xpubs derived to the account or change path.
   * Since hdpublickeys cannot derive on hardened paths, the derivation must be done previously with the private key
   * The last path with hardened derivation defined on bip44 is the account path so we support using an account path xpub.
   * We can also use the change path xpub since we use it to derive the addresses
   * but we cannot use the address path xpub since we won't be able to derive all addresses.
   * And the wallet-lib currently does not support the creation of a wallet with a single address.
   *
   * @param {string} xpubkey HDPublicKey in string format.
   * @param {Object} [options={}] Options to generate the access data.
   * @param {IMultisigData|undefined} [options.multisig=undefined] MultiSig data of the wallet
   * @param {boolean} [options.hardware=false] If the wallet is a hardware wallet
   * @returns {IWalletAccessData}
   */
  generateAccessDataFromXpub(xpubkey, {
    multisig,
    hardware = false
  } = {}) {
    let walletFlags = 0 | _types.WALLET_FLAGS.READONLY;
    if (hardware) {
      walletFlags |= _types.WALLET_FLAGS.HARDWARE;
    }
    let walletType;
    if (multisig === undefined) {
      walletType = _types.WalletType.P2PKH;
    } else {
      walletType = _types.WalletType.MULTISIG;
    }
    // HDPublicKeys cannot derive on hardened paths, so the derivation must be done previously with the xprivkey.
    // So we assume the user sent an xpub derived to the account level.

    const argXpub = new _bitcoreLib.HDPublicKey(xpubkey);
    let multisigData;
    let xpub;
    if (argXpub.depth === 3) {
      // This is an account path xpub which we expect was derived to the path m/45'/280'/0'
      xpub = argXpub.derive(0);
      if (multisig) {
        // A multisig wallet requires the account path publickey to determine which participant this wallet is.
        // Since we have the account path xpub we can initialize the readonly multisig wallet.
        multisigData = {
          ...multisig,
          pubkey: argXpub.publicKey.toString('hex')
        };
      } else {
        multisigData = undefined;
      }
    } else if (argXpub.depth === 4) {
      // This is a change path xpub which we expect was derived to the path m/45'/280'/0'/0
      xpub = argXpub;
      if (multisig) {
        // A multisig wallet requires the account path publickey to determine which participant this wallet is.
        // Since we cannot get the account path publickey we must stop the wallet creation.
        throw new Error('Cannot create a multisig wallet with a change path xpub');
      }
    } else {
      // We currently only support account path and change path xpubs.
      throw new Error('Invalid xpub');
    }
    return {
      // Change path hdpublickey in string format
      xpubkey: xpub.xpubkey,
      walletType,
      multisigData,
      // We force the readonly flag because we are starting a wallet without the private key
      walletFlags
    };
  },
  /**
   * Generate access data from the xprivkey.
   * We can use either the root xprivkey or the change path xprivkey.
   * Obs: A multisig wallet cannot be started with a change path xprivkey.
   *
   * The seed can be passed so we save it on the storage, even if its not used.
   * Obs: must also pass password to encrypt the seed.
   *
   * @param {string} xprivkey
   * @param {Object} options
   * @param {IMultisigData | undefined} [options.multisig=undefined]
   * @param {string} [options.pin]
   * @param {string | undefined} [options.seed=undefined]
   * @param {string | undefined} [options.password=undefined]
   * @param {string | undefined} [options.authXpriv=undefined]
   * @returns {IWalletAccessData}
   */
  generateAccessDataFromXpriv(xprivkey, {
    multisig,
    pin,
    seed,
    password,
    authXpriv
  }) {
    let walletType;
    if (multisig === undefined) {
      walletType = _types.WalletType.P2PKH;
    } else {
      walletType = _types.WalletType.MULTISIG;
    }
    const argXpriv = new _bitcoreLib.HDPrivateKey(xprivkey);
    let xpriv;
    let acctXpriv = null;
    let derivedAuthKey = null;
    if (argXpriv.depth === 0) {
      derivedAuthKey = argXpriv.deriveNonCompliantChild(_constants.WALLET_SERVICE_AUTH_DERIVATION_PATH);
      if (walletType === _types.WalletType.MULTISIG) {
        acctXpriv = argXpriv.deriveNonCompliantChild(_constants.P2SH_ACCT_PATH);
        xpriv = acctXpriv.deriveNonCompliantChild(0);
      } else {
        acctXpriv = argXpriv.deriveNonCompliantChild(_constants.P2PKH_ACCT_PATH);
        xpriv = acctXpriv.deriveNonCompliantChild(0);
      }
    } else {
      if (walletType === _types.WalletType.MULTISIG) {
        throw new Error('Cannot start a multisig wallet with a derived xpriv');
      }
      xpriv = argXpriv;
    }
    const encryptedMainKey = (0, _crypto.encryptData)(xpriv.xprivkey, pin);
    let multisigData;
    if (multisig === undefined) {
      multisigData = undefined;
    } else {
      // For multisig wallets we need to save the pubkey of the account path
      const derivedXpriv = argXpriv.deriveNonCompliantChild(_constants.P2SH_ACCT_PATH);
      multisigData = {
        pubkey: derivedXpriv.publicKey.toString('hex'),
        ...multisig
      };
    }
    const accessData = {
      walletType,
      multisigData,
      mainKey: encryptedMainKey,
      xpubkey: xpriv.xpubkey,
      walletFlags: 0
    };
    if (acctXpriv !== null) {
      // Account path key will only be available if the provided key is a root key
      const encryptedAcctPathKey = (0, _crypto.encryptData)(acctXpriv.xprivkey, pin);
      accessData.acctPathKey = encryptedAcctPathKey;
    }
    if (authXpriv || derivedAuthKey) {
      let authKey;
      if (authXpriv) {
        authKey = (0, _crypto.encryptData)(authXpriv, pin);
      } else {
        authKey = (0, _crypto.encryptData)(derivedAuthKey.xprivkey, pin);
      }
      accessData.authKey = authKey;
    }
    if (seed && password) {
      const encryptedWords = (0, _crypto.encryptData)(seed, password);
      accessData.words = encryptedWords;
    }
    return accessData;
  },
  generateAccessDataFromSeed(words, {
    multisig,
    passphrase = '',
    pin,
    password,
    networkName
  }) {
    let walletType;
    if (multisig === undefined) {
      walletType = _types.WalletType.P2PKH;
    } else {
      walletType = _types.WalletType.MULTISIG;
    }
    const code = new _bitcoreMnemonic.default(words);
    const rootXpriv = code.toHDPrivateKey(passphrase, new _network.default(networkName));
    const authXpriv = rootXpriv.deriveNonCompliantChild(_constants.WALLET_SERVICE_AUTH_DERIVATION_PATH);
    let accXpriv;
    let xpriv;
    if (walletType === _types.WalletType.MULTISIG) {
      accXpriv = rootXpriv.deriveNonCompliantChild(_constants.P2SH_ACCT_PATH);
      xpriv = accXpriv.deriveNonCompliantChild(0);
    } else {
      accXpriv = rootXpriv.deriveNonCompliantChild(_constants.P2PKH_ACCT_PATH);
      xpriv = accXpriv.deriveNonCompliantChild(0);
    }
    const encryptedMainKey = (0, _crypto.encryptData)(xpriv.xprivkey, pin);
    const encryptedAcctPathKey = (0, _crypto.encryptData)(accXpriv.xprivkey, pin);
    const encryptedAuthPathKey = (0, _crypto.encryptData)(authXpriv.xprivkey, pin);
    const encryptedWords = (0, _crypto.encryptData)(words, password);
    let multisigData;
    if (multisig === undefined) {
      multisigData = undefined;
    } else {
      // For multisig wallets we need to save the pubkey of the account path
      multisigData = {
        pubkey: accXpriv.publicKey.toString('hex'),
        ...multisig
      };
    }
    return {
      walletType,
      multisigData,
      xpubkey: xpriv.xpubkey,
      mainKey: encryptedMainKey,
      acctPathKey: encryptedAcctPathKey,
      authKey: encryptedAuthPathKey,
      words: encryptedWords,
      walletFlags: 0
    };
  },
  /**
   * Change the encryption pin on the fields that are encrypted using the pin.
   * Will not save the access data, only return the new access data.
   *
   * @param {IWalletAccessData} accessData The current access data encrypted with `oldPin`.
   * @param {string} oldPin Used to decrypt the old access data.
   * @param {string} newPin Encrypt the fields with this pin.
   * @returns {IWalletAccessData} The access data with fields encrypted with `newPin`.
   */
  changeEncryptionPin(accessData, oldPin, newPin) {
    const data = _lodash.default.cloneDeep(accessData);
    if (!(data.mainKey || data.authKey || data.acctPathKey)) {
      throw new Error('No data to change');
    }
    if (data.mainKey) {
      const mainKey = (0, _crypto.decryptData)(data.mainKey, oldPin);
      const newEncryptedMainKey = (0, _crypto.encryptData)(mainKey, newPin);
      data.mainKey = newEncryptedMainKey;
    }
    if (data.authKey) {
      const authKey = (0, _crypto.decryptData)(data.authKey, oldPin);
      const newEncryptedAuthKey = (0, _crypto.encryptData)(authKey, newPin);
      data.authKey = newEncryptedAuthKey;
    }
    if (data.acctPathKey) {
      const acctPathKey = (0, _crypto.decryptData)(data.acctPathKey, oldPin);
      const newEncryptedAcctPathKey = (0, _crypto.encryptData)(acctPathKey, newPin);
      data.acctPathKey = newEncryptedAcctPathKey;
    }
    return data;
  },
  /**
   * Change the encryption password on the seed.
   * Will not save the access data, only return the new access data.
   *
   * @param {IWalletAccessData} accessData The current access data encrypted with `oldPassword`.
   * @param {string} oldPassword Used to decrypt the old access data.
   * @param {string} newPassword Encrypt the seed with this password.
   * @returns {IWalletAccessData} The access data with fields encrypted with `newPassword`.
   */
  changeEncryptionPassword(accessData, oldPassword, newPassword) {
    const data = _lodash.default.cloneDeep(accessData);
    if (!data.words) {
      throw new Error('No data to change');
    }
    const words = (0, _crypto.decryptData)(data.words, oldPassword);
    const newEncryptedWords = (0, _crypto.encryptData)(words, newPassword);
    data.words = newEncryptedWords;
    return data;
  }
};
var _default = exports.default = wallet;