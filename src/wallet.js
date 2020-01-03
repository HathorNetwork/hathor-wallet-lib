/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GAP_LIMIT, LIMIT_ADDRESS_GENERATION, HATHOR_BIP44_CODE, TOKEN_MINT_MASK, TOKEN_MELT_MASK, TOKEN_INDEX_MASK, HATHOR_TOKEN_INDEX, HATHOR_TOKEN_CONFIG, MAX_OUTPUT_VALUE, HASH_KEY_SIZE, HASH_ITERATIONS } from './constants';
import Mnemonic from 'bitcore-mnemonic';
import { HDPublicKey, Address, crypto } from 'bitcore-lib';
import CryptoJS from 'crypto-js';
import walletApi from './api/wallet';
import tokens from './tokens';
import helpers from './helpers';
import { OutputValueError } from './errors';
import version from './version';
import storage from './storage';
import network from './network';
import transaction from './transaction';
import WebSocketHandler from './WebSocketHandler';
import dateFormatter from './date';
import _ from 'lodash';

/**
 * We use storage and Redux to save data.
 * In storage we have the following keys (prefixed by wallet:)
 * - data: object with data from the wallet including (all have full description in the reducers file)
 *   . historyTransactions: Object of transactions indexed by tx_id
 * - accessData: object with data to access the wallet
 *   . mainKey: string with encrypted private key
 *   . hash: string with hash of pin
 *   . words: string with encrypted words
 *   . hashPasswd: string with hash of password
 * - address: string with last shared address to show on screen
 * - lastSharedIndex: number with the index of the last shared address
 * - lastGeneratedIndex: number with the index of the last generated address
 * - lastUsedIndex: number with the index of the last used address
 * - lastUsedAddress: string the last used address
 * - server: string with server to connect and execute requests
 * - started: if wallet was already started (after welcome screen)
 * - backup: if words backup was already done
 * - locked: if wallet is locked
 * - closed: when the wallet was closed
 * - txMinWeight: minimum weight of a transaction (variable got from the backend)
 * - txWeightCoefficient: minimum weight coefficient of a transaction (variable got from the backend)
 * - tokens: array with tokens information {'name', 'symbol', 'uid'}
 * - sentry: if user allowed to send errors to sentry
 * - notification: if user allowed to send notifications
 *
 * @namespace Wallet
 */
const wallet = {
  /**
   * Verify if words passed to generate wallet are valid. In case of invalid, returns message
   *
   * @param {string} words Words (separated by space) to generate the HD Wallet seed
   *
   * @return {Object} {'valid': boolean, 'message': string}
   * @memberof Wallet
   * @inner
   */
  wordsValid(words) {
    if (_.isString(words)) {
      if (words.split(' ').length !== 24) {
        // Must have 24 words
        return {'valid': false, 'message': 'Must have 24 words'};
      } else if (!Mnemonic.isValid(words)) {
        // Invalid sequence of words
        return {'valid': false, 'message': 'Invalid sequence of words'};
      }
    } else {
      // Must be string
      return {'valid': false, 'message': 'Must be a string'};
    }
    return {'valid': true, 'message': ''};
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
  generateWalletWords(entropy) {
    const code = new Mnemonic(entropy);
    return code.phrase;
  },

  /**
   * Start a new HD wallet with new private key
   * Encrypt this private key and save data in storage
   *
   * @param {string} words Words to generate the HD Wallet seed
   * @param {string} passphrase
   * @param {string} pin
   * @param {string} password
   * @param {boolean} loadHistory if should load the history from the generated addresses
   *
   * @return {Promise} Promise that resolves when finishes loading address history, in case loadHistory = true, else returns null
   * @memberof Wallet
   * @inner
   */
  executeGenerateWallet(words, passphrase, pin, password, loadHistory) {
    let code = new Mnemonic(words);
    let xpriv = code.toHDPrivateKey(passphrase, network.getNetwork());
    let privkey = xpriv.derive(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);

    let encryptedData = this.encryptData(privkey.xprivkey, pin)
    let encryptedDataWords = this.encryptData(words, password)

    // Save in storage the encrypted private key and the hash of the pin and password
    let access = {
      mainKey: encryptedData.encrypted.toString(),
      hash: encryptedData.hash.key.toString(),
      salt: encryptedData.hash.salt,
      words: encryptedDataWords.encrypted.toString(),
      hashPasswd: encryptedDataWords.hash.key.toString(),
      saltPasswd: encryptedDataWords.hash.salt,
      hashIterations: HASH_ITERATIONS,
      pbkdf2Hasher: 'sha1', // For now we are only using SHA1
    }

    return this.startWallet(access, privkey.xpubkey, loadHistory);
  },

  /**
   * Set wallet data on storage and start it
   *
   * @param {Object} accessData Object of data to be saved on storage. Will be empty for hardware wallet and for software will have the keys
   *                    (mainKey, hash, salt, words, hashPasswd, saltPasswd, hashIterations, pbkdf2Hasher) as set on executeGenerateWallet method
   * @param {string} xpub Xpub string of the wallet being started
   * @param {boolean} loadHistory if should load the history from the generated addresses
   *
   * @return {Promise} Promise that resolves when finishes loading address history, in case loadHistory = true, else returns null
   * @memberof Wallet
   * @inner
   */
  startWallet(accessData, xpub, loadHistory) {
    WebSocketHandler.setup();
    this.afterOpen();
    let walletData = {
      keys: {},
      xpubkey: xpub,
    }

    storage.setItem('wallet:accessData', accessData);
    storage.setItem('wallet:data', walletData);

    let promise = null;
    if (loadHistory) {
      // Load history from address
      promise = this.loadAddressHistory(0, GAP_LIMIT);
    }
    return promise;
  },

  /**
   * Get wallet last generated address index
   *
   * @return {number} Index that was last generated
   *
   * @memberof Wallet
   * @inner
   */
  getLastGeneratedIndex() {
    const raw = storage.getItem('wallet:lastGeneratedIndex');
    if (!raw) {
      return 0;
    }
    return parseInt(raw, 10);
  },

  /**
   * Get wallet data already parsed from JSON
   *
   * @return {Object} wallet data
   *
   * @memberof Wallet
   * @inner
   */
  getWalletData() {
    return storage.getItem('wallet:data');
  },

  /**
   * Load the history for each of the addresses of a new generated wallet
   * We always search until the GAP_LIMIT. If we have any history in the middle of the searched addresses
   * we search again until we have the GAP_LIMIT of addresses without any transactions
   * The loaded history is added to storage and Redux
   *
   * @param {number} startIndex Address index to start to load history
   * @param {number} count How many addresses I will load
   *
   * @return {Promise} Promise that resolves when addresses history is finished loading from server
   *
   * @memberof Wallet
   * @inner
   */
  loadAddressHistory(startIndex, count) {
    const promise = new Promise((resolve, reject) => {
      // First generate all private keys and its addresses, then get history
      let addresses = [];
      let dataJson = this.getWalletData();

      const xpub = HDPublicKey(dataJson.xpubkey);
      const stopIndex = startIndex + count;
      for (var i=startIndex; i<stopIndex; i++) {
        // Generate each key from index, encrypt and save
        let key = xpub.derive(i);
        var address = Address(key.publicKey, network.getNetwork());
        dataJson.keys[address.toString()] = {privkey: null, index: i};
        addresses.push(address.toString());

        // Subscribe in websocket to this address updates
        this.subscribeAddress(address.toString());

        if (storage.getItem('wallet:address') === null) {
          // If still don't have an address to show on the screen
          this.updateAddress(address.toString(), i);
        }
      }

      let lastGeneratedIndex = this.getLastGeneratedIndex();
      if (lastGeneratedIndex < stopIndex - 1) {
        storage.setItem('wallet:lastGeneratedIndex', stopIndex - 1);
      }

      storage.setItem('wallet:data', dataJson);

      walletApi.getAddressHistory(addresses, (response) => {
        const data = this.getWalletData();
        // Update historyTransactions with new one
        const historyTransactions = 'historyTransactions' in data ? data['historyTransactions'] : {};
        const allTokens = 'allTokens' in data ? data['allTokens'] : [];
        const result = this.updateHistoryData(historyTransactions, allTokens, response.history, resolve, data, reject);
        WebSocketHandler.emit('addresses_loaded', result);
      }).catch((e) => {
        // Error in request
        reject(e);
      });
    });
    return promise;
  },

  /**
   * Add passphrase to the wallet
   *
   * @param {string} passphrase Passphrase to be added
   * @param {string} pin
   * @param {string} password
   *
   * @return {string} words generated (null if words are not valid)
   * @memberof Wallet
   * @inner
   */
  addPassphrase(passphrase, pin, password) {
    const words = this.getWalletWords(password);
    this.cleanWallet()
    return this.executeGenerateWallet(words, passphrase, pin, password, true);
  },

  /**
   * Update address shared in storage and redux
   *
   * @param {string} lastSharedAddress
   * @param {number} lastSharedIndex
   * @memberof Wallet
   * @inner
   */
  updateAddress(lastSharedAddress, lastSharedIndex) {
    storage.setItem('wallet:address', lastSharedAddress);
    storage.setItem('wallet:lastSharedIndex', lastSharedIndex);
  },

  /**
   * Encrypt private key with pin
   *
   * @param {string} privateKey String of private key
   * @param {string} pin
   *
   * @return {Object} encrypted private key and pin hash
   *
   * @memberof Wallet
   * @inner
   */
  encryptData(privateKey, pin, salt) {
    const encrypted = CryptoJS.AES.encrypt(privateKey, pin);
    const hash = this.hashPassword(pin, salt);
    return {'encrypted': encrypted, 'hash': hash}
  },

  /**
   * Get the hash (sha256) of a password
   * Old method, used only for compatibility with old wallets
   *
   * @param {string} password Password to be hashes
   *
   * @return {Object} Object with hash of password
   *
   * @memberof Wallet
   * @inner
   */
  oldHashPassword(password) {
    return CryptoJS.SHA256(CryptoJS.SHA256(password));
  },

  /**
   * Get the hash of a password (hmac + salt)
   *
   * @param {string} password Password to be hashes
   * @param {string} salt Salt to be used when hashing the password. If not passed, we generate one
   *
   * @return {Object} Object with {key, salt}
   *
   * @memberof Wallet
   * @inner
   */
  hashPassword(password, salt) {
    if (salt === undefined) {
      salt = CryptoJS.lib.WordArray.random(128 / 8).toString();
    }
    // NIST has issued Special Publication SP 800-132 recommending PBKDF2
    // For further information, see https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf
    // The default hash algorithm used by CryptoJS.PBKDF2 is SHA1
    // https://github.com/brix/crypto-js/blob/develop/src/pbkdf2.js#L24
    const key = CryptoJS.PBKDF2(password, salt, {
      keySize: HASH_KEY_SIZE / 32,
      iterations: HASH_ITERATIONS
    });
    return { key, salt };
  },

  /**
   * Decrypt data with password
   *
   * @param {string} data Encrypted data
   * @param {string} password
   *
   * @return {string} string of decrypted data
   *
   * @memberof Wallet
   * @inner
   */
  decryptData(data, password) {
    let decrypted = CryptoJS.AES.decrypt(data, password);
    return decrypted.toString(CryptoJS.enc.Utf8);
  },

  /**
   * Validate if pin is correct
   *
   * @param {string} pin
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  isPinCorrect(pin) {
    return this.hashValidation(pin, 'hash', 'salt');
  },

  /**
   * Validate if password is correct
   *
   * @param {string} password
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  isPasswordCorrect(password) {
    return this.hashValidation(password, 'hashPasswd', 'saltPasswd');
  },

  /**
   * Validate if password matches the corresponding hash in the storage
   *
   * @param {string} password
   * @param {string} hashKey key of the hash saved in storage
   * @param {string} saltKey key of the salt saved in storage
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  hashValidation(password, hashKey, saltKey) {
    const accessData = storage.getItem('wallet:accessData');
    let hash;
    if (!(saltKey in accessData)) {
      // Old wallet, we need to validate with old method and update it to the new method
      hash = this.oldHashPassword(password).toString();
      if (hash !== accessData[hashKey]) {
        return false;
      }
      const newHash = this.hashPassword(password);
      accessData[hashKey] = newHash.key.toString();
      accessData[saltKey] = newHash.salt;
      accessData['hashIterations'] = HASH_ITERATIONS;
      accessData['pbkdf2Hasher'] = 'sha1'; // For now we are only using SHA1
      // Updating access data with new hash data
      storage.setItem('wallet:accessData', accessData);
      return true;
    } else {
      // Already a wallet with new hash algorithm, so only validate
      hash = this.hashPassword(password, accessData[saltKey]);
      return hash.key.toString() === accessData[hashKey];
    }
  },

  /**
   * Validate old PIN and change it for the new one
   *
   * @param {string} oldPin
   * @param {string} newPin
   *
   * @return {boolean} true if the PIN was successfully changed
   *
   * @memberof Wallet
   * @inner
   */
  changePin(oldPin, newPin) {
    const isCorrect = this.isPinCorrect(oldPin);
    if (!isCorrect) {
      return false;
    }

    const accessData = storage.getItem('wallet:accessData');

    // Get new PIN hash
    const newHash = this.hashPassword(newPin);
    // Update new PIN data in storage
    accessData['hash'] = newHash.key.toString();
    accessData['salt'] = newHash.salt;

    // Get and update data encrypted with PIN
    const decryptedData = this.decryptData(accessData.mainKey, oldPin);
    const encryptedData = this.encryptData(decryptedData, newPin);
    accessData['mainKey'] = encryptedData.encrypted.toString();

    storage.setItem('wallet:accessData', accessData);

    return true;
  },

  /**
   * Checks if has more generated addresses after the last shared one
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  hasNewAddress() {
    const lastGeneratedIndex = this.getLastGeneratedIndex();
    const lastSharedIndex = this.getLastSharedIndex();
    return lastGeneratedIndex > lastSharedIndex;
  },

  /**
   * Get next address after the last shared one (only if it's already generated)
   * Update the data in storage and Redux
   *
   * @memberof Wallet
   * @inner
   */
  getNextAddress() {
    const lastSharedIndex = this.getLastSharedIndex();
    const data = this.getWalletData();
    for (const address in data.keys) {
      if (data.keys[address].index === lastSharedIndex + 1) {
        this.updateAddress(address, lastSharedIndex + 1);
        return {address, index: lastSharedIndex + 1}
      }
    }
    return null;
  },

  /**
   * We should generate at most GAP_LIMIT unused addresses
   * This method checks if we can generate more addresses or if we have already reached the limit
   * In the constants file we have the LIMIT_ADDRESS_GENERATION that can skip this validation
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  canGenerateNewAddress() {
    const lastUsedIndex = this.getLastUsedIndex();
    const lastGeneratedIndex = this.getLastGeneratedIndex();
    if (LIMIT_ADDRESS_GENERATION) {
      if (lastUsedIndex + GAP_LIMIT > lastGeneratedIndex) {
        // Still haven't reached the limit
        return true;
      } else {
        return false;
      }
    } else {
      // Skip validation
      return true;
    }
  },

  /**
   * Generate a new address
   * We update the wallet data and new address shared
   *
   * @return {Object} {newAddress, newIndex}
   *
   * @memberof Wallet
   * @inner
   */
  generateNewAddress() {
    const dataJson = this.getWalletData();
    const xpub = HDPublicKey(dataJson.xpubkey);

    // Get last shared index to discover new index
    const lastSharedIndex = this.getLastSharedIndex();
    let newIndex = lastSharedIndex + 1;

    const newKey = xpub.derive(newIndex);
    const newAddress = Address(newKey.publicKey, network.getNetwork());

    // Update address data and last generated indexes
    this.updateAddress(newAddress.toString(), newIndex);
    let lastGeneratedIndex = this.getLastGeneratedIndex();
    if (newIndex > lastGeneratedIndex) {
      storage.setItem('wallet:lastGeneratedIndex', newIndex);
    }

    // Save new keys to local storage
    let data = this.getWalletData();
    data.keys[newAddress.toString()] = {privkey: null, index: newIndex};
    storage.setItem('wallet:data', data);

    // Subscribe in ws to new address updates
    this.subscribeAddress(newAddress.toString());

    return {newAddress, newIndex};
  },

  /**
   * Get the address to be used and generate a new one
   *
   * @return {string} address
   *
   * @memberof Wallet
   * @inner
   */
  getAddressToUse() {
    const address = this.getCurrentAddress();
    // Updating address because the last one was used
    this.nextAddress();
    return address;
  },

  /**
   * Get current address
   *
   * @return {string} address
   *
   * @memberof Wallet
   * @inner
   */
  getCurrentAddress() {
    return storage.getItem('wallet:address');
  },

  /**
   * Move to the next address in the derivation chain and return it.
   *
   * It may not move to the next address if the number of unused addresses has reached the GAP_LIMIT.
   * In this case, it returns the same as getCurrentAddress.
   *
   * @return {string} address
   *
   * @memberof Wallet
   * @inner
   */
  nextAddress() {
    if (this.hasNewAddress()) {
      this.getNextAddress();
    } else if (this.canGenerateNewAddress()) {
      this.generateNewAddress();
    }
    return this.getCurrentAddress();
  },

  /**
   * Validates if transaction is from this wallet (uses an address of this wallet)
   * and if this output/input is also from the selectedToken
   *
   * @param {Object} tx Transaction object
   * @param {string} selectedToken Token uid
   * @param {Object} walletData Wallet data in storage already loaded. This parameter is optional and if nothing is passed, the data will be loaded again. We expect this field to be the return of the method wallet.getWalletData()
   * @param {boolean} acceptAuthority If should accept authority outputs/inputs in the method
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  hasTokenAndAddress(tx, selectedToken, walletData, acceptAuthority) {
    if (walletData === undefined) {
      walletData = this.getWalletData();
    }

    if (walletData === null) {
      return false;
    }

    for (let txin of tx.inputs) {
      if (this.isAuthorityOutput(txin) && !acceptAuthority) {
        continue;
      }

      if (txin.token === selectedToken) {
        if (this.isAddressMine(txin.decoded.address, walletData)) {
          return true;
        }
      }
    }
    for (let txout of tx.outputs) {
      if (this.isAuthorityOutput(txout) && !acceptAuthority) {
        continue;
      }

      if (txout.token === selectedToken) {
        if (this.isAddressMine(txout.decoded.address, walletData)) {
          return true;
        }
      }
    }
    return false;
  },

  /**
   * Filters an array of transactions to only the ones from this wallet and selectedToken
   *
   * @param {Object} historyTransactions Object of transactions indexed by tx_id
   * @param {string} selectedToken Token uid
   * @param {boolean} acceptAuthority If should accept authority outputs/inputs in the method
   *
   * @return {Object} array of the filtered transactions
   *
   * @memberof Wallet
   * @inner
   */
  filterHistoryTransactions(historyTransactions, selectedToken, acceptAuthority) {
    const walletData = this.getWalletData();
    const data = [];
    for (const tx_id in historyTransactions) {
      const tx = historyTransactions[tx_id];
      if (this.hasTokenAndAddress(tx, selectedToken, walletData, acceptAuthority)) {
        data.push(tx);
      }
    }
    data.sort((a, b) => {
      return b.timestamp - a.timestamp;
    });
    return data;
  },

  /**
   * Calculate the balance for each token (available and locked) from the historyTransactions
   *
   * @param {Object} historyTransactions Array of transactions
   * @param {string} selectedToken token uid to get the balance
   *
   * @return {Object} Object with {available: number, locked: number}
   *
   * @memberof Wallet
   * @inner
   */
  calculateBalance(historyTransactions, selectedToken) {
    let balance = {available: 0, locked: 0};
    const data = this.getWalletData();
    if (data === null) {
      return balance;
    }
    for (let tx of historyTransactions) {
      if (tx.is_voided) {
        // Ignore voided transactions.
        continue;
      }
      for (let txout of tx.outputs) {
        if (this.isAuthorityOutput(txout)) {
          // Ignore authority outputs.
          continue;
        }
        if (txout.spent_by === null && txout.token === selectedToken && this.isAddressMine(txout.decoded.address, data)) {
          if (this.canUseUnspentTx(txout)) {
            balance.available += txout.value;
          } else {
            balance.locked += txout.value;
          }
        }
      }
    }
    return balance;
  },

  /**
   * Check if unspentTx is locked or can be used
   *
   * @param {Object} unspentTx (needs to have decoded.timelock key)
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  canUseUnspentTx(unspentTx) {
    if (unspentTx.decoded.timelock) {
      let currentTimestamp = dateFormatter.dateToTimestamp(new Date());
      return currentTimestamp > unspentTx.decoded.timelock;
    } else {
      return true;
    }
  },

  /**
   * Save wallet data from redux to storage
   *
   * @param {Object} historyTransactions
   * @param {Object} allTokens Set of all tokens added to the wallet
   *
   * @memberof Wallet
   * @inner
   */
  saveAddressHistory(historyTransactions, allTokens) {
    let data = this.getWalletData();
    data['historyTransactions'] = historyTransactions;
    data['allTokens'] = [...allTokens];
    storage.setItem('wallet:data', data);
  },

  /**
   * Check if wallet is already loaded
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  loaded() {
    return storage.getItem('wallet:accessData') !== null;
  },

  /**
   * Check if wallet was already started (user clicked in 'Get started')
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  started() {
    return storage.getItem('wallet:started') !== null;
  },

  /**
   * Save wallet as started
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  markWalletAsStarted() {
    return storage.setItem('wallet:started', true);
  },

  /**
   * Subscribe to receive updates from an address in the websocket
   *
   * @param {string} address
   */
  subscribeAddress(address) {
    const msg = JSON.stringify({'type': 'subscribe_address', 'address': address});
    WebSocketHandler.sendMessage(msg);
  },

  /**
   * Subscribe to receive updates from all generated addresses
   *
   * @memberof Wallet
   * @inner
   */
  subscribeAllAddresses() {
    let data = this.getWalletData();
    if (data) {
      for (let address in data.keys) {
        this.subscribeAddress(address);
      }
    }
  },

  /**
   * Unsubscribe to receive updates from an address in the websocket
   *
   * @param {string} address
   * @memberof Wallet
   * @inner
   */
  unsubscribeAddress(address) {
    const msg = JSON.stringify({'type': 'unsubscribe_address', 'address': address});
    WebSocketHandler.sendMessage(msg);
  },

  /**
   * Unsubscribe to receive updates from all generated addresses
   * @memberof Wallet
   * @inner
   */
  unsubscribeAllAddresses() {
    let data = this.getWalletData();
    if (data) {
      for (let address in data.keys) {
        this.unsubscribeAddress(address);
      }
    }
  },

  /**
   * Get an address, find its index and set as last used in storage
   *
   * @param {string} address
   * @memberof Wallet
   * @inner
   */
  setLastUsedIndex(address) {
    let data = this.getWalletData();
    if (data) {
      let index = data.keys[address].index;
      const lastUsedIndex = this.getLastUsedIndex();
      if (lastUsedIndex === null || index > parseInt(lastUsedIndex, 10)) {
        storage.setItem('wallet:lastUsedAddress', address);
        storage.setItem('wallet:lastUsedIndex', index);
      }
    }
  },

  /*
   * Clean all data before logout wallet
   * - Clean local storage
   * - Clean redux
   * - Unsubscribe websocket connections
   *
   * @memberof Wallet
   * @inner
   */
  cleanWallet() {
    this.unsubscribeAllAddresses();
    this.cleanLoadedData();
    WebSocketHandler.endConnection();
  },

  /*
   * Clean data from server
   *
   * @memberof Wallet
   * @inner
   */
  cleanServer() {
    storage.removeItem('wallet:server');
  },

  /**
   * Remove all storage saved items
   * @memberof Wallet
   * @inner
   */
  cleanLoadedData() {
    storage.removeItem('wallet:accessData');
    storage.removeItem('wallet:data');
    storage.removeItem('wallet:address');
    storage.removeItem('wallet:lastSharedIndex');
    storage.removeItem('wallet:lastGeneratedIndex');
    storage.removeItem('wallet:lastUsedIndex');
    storage.removeItem('wallet:lastUsedAddress');
    this.afterOpen();
  },

  /*
   * Clean all data, except for wallet:defaultServer.
   * That can be done manually with clearDefaultServer()
   *
   * @memberof Wallet
   * @inner
   */
  resetWalletData() {
    this.cleanWallet();
    this.cleanServer();
    transaction.clearTransactionWeightConstants();
    tokens.clearDepositPercentage();
    storage.removeItem('wallet:started');
    storage.removeItem('wallet:backup');
    storage.removeItem('wallet:locked');
    storage.removeItem('wallet:tokens');
    storage.removeItem('wallet:sentry');
    storage.removeItem('wallet:type');
  },

  /*
   * Clean all data
   *
   * @memberof Wallet
   * @inner
   */
  resetAllData() {
    this.resetWalletData();
    this.clearDefaultServer();
  },

  /*
   * Get inputs to be used in transaction from amount required and selectedToken
   *
   * @param {Object} historyTransactions Object of transactions indexed by tx_id
   * @param {number} amount Amount required to send transaction
   * @param {string} selectedToken UID of token that is being sent
   *
   * @return {Object} {'inputs': Array of objects {'tx_id', 'index', 'token', 'address'}, 'inputsAmount': number}
   *
   * @memberof Wallet
   * @inner
   */
  getInputsFromAmount(historyTransactions, amount, selectedToken) {
    const ret = {'inputs': [], 'inputsAmount': 0};
    const data = this.getWalletData();
    if (data === null) {
      return ret;
    }

    for (const tx_id in historyTransactions) {
      const tx = historyTransactions[tx_id];
      if (tx.is_voided) {
        // Ignore voided transactions.
        continue;
      }

      for (const [index, txout] of tx.outputs.entries()) {
        if (this.isAuthorityOutput(txout)) {
          // Ignore authority outputs.
          continue;
        }
        if (ret.inputsAmount >= amount) {
          return ret;
        }
        if (txout.spent_by === null && txout.token === selectedToken && this.isAddressMine(txout.decoded.address, data)) {
          if (this.canUseUnspentTx(txout)) {
            ret.inputsAmount += txout.value;
            ret.inputs.push({ tx_id: tx.tx_id, index, token: selectedToken, address: txout.decoded.address });
          }
        }
      }
    }
    return ret;
  },

  /*
   * Get output of a change of a transaction
   *
   * @param {number} value Amount of the change output
   * @param {number} tokenData Token index of the output
   *
   * @return {Object} {'address': string, 'value': number, 'tokenData': number, 'isChange': true}
   *
   * @memberof Wallet
   * @inner
   */
  getOutputChange(value, tokenData) {
    const address = this.getAddressToUse();
    return {'address': address, 'value': value, 'tokenData': tokenData, 'isChange': true};
  },

  /*
   * Verify if has unspentTxs from tx_id, index and selectedToken
   *
   * @param {Object} historyTransactions Object of transactions indexed by tx_id
   * @param {string} txId Transaction id to search
   * @param {number} index Output index to search
   * @param {string} selectedToken UID of the token to check existence
   *
   * @return {Object} {success: boolean, message: Error message in case of failure, output: output object in case of success}
   *
   * @memberof Wallet
   * @inner
   */
  checkUnspentTxExists(historyTransactions, txId, index, selectedToken) {
    const data = this.getWalletData();
    if (data === null) {
      return {exists: false, message: 'Data not loaded yet'};
    }
    for (const tx_id in historyTransactions) {
      const tx = historyTransactions[tx_id]
      if (tx.tx_id !== txId) {
        continue;
      }
      if (tx.is_voided) {
        // If tx is voided, not unspent
        return {exists: false, message: `Transaction [${txId}] is voided`};
      }
      if (tx.outputs.length - 1 < index) {
        // Output with this index does not exist
        return {exists: false, message: `Transaction [${txId}] does not have this output [index=${index}]`};
      }

      const txout = tx.outputs[index];
      if (this.isAuthorityOutput(txout)) {
        // Ignore authority outputs for now.
        return {exists: false, message: `Output [${index}] of transaction [${txId}] is an authority output`};
      }

      if (!(this.isAddressMine(txout.decoded.address, data))) {
        return {exists: false, message: `Output [${index}] of transaction [${txId}] is not yours`};
      }

      if (txout.token !== selectedToken) {
        return {exists: false, message: `Output [${index}] of transaction [${txId}] is not from selected token [${selectedToken}]`};
      }

      if (txout.spent_by !== null) {
        return {exists: false, message: `Output [${index}] of transaction [${txId}] is already spent`};
      }
      return {exists: true, 'output': txout};
    }
    // Requests txId does not exist in historyTransactions
    return {exists: false, message: `Transaction [${txId}] does not exist in the wallet`};
  },

  /*
   * Lock wallet
   *
   * @memberof Wallet
   * @inner
   */
  lock() {
    storage.setItem('wallet:locked', true);
  },

  /*
   * Unlock wallet
   *
   * @memberof Wallet
   * @inner
   */
  unlock() {
    storage.removeItem('wallet:locked');
  },

  /*
   * Return if wallet is locked
   *
   * @return {boolean} if wallet is locked
   *
   * @memberof Wallet
   * @inner
   */
  isLocked() {
    return storage.getItem('wallet:locked') !== null;
  },

  /*
   * Return if wallet was closed
   *
   * @return {boolean} if wallet was closed
   *
   * @memberof Wallet
   * @inner
   */
  wasClosed() {
    return storage.getItem('wallet:closed') === true;
  },

  /*
   * Set in storage as closed
   *
   * @memberof Wallet
   * @inner
   */
  close() {
    storage.setItem('wallet:closed', true);
  },

  /*
   * Set in storage as not closed
   *
   * @memberof Wallet
   * @inner
   */
  afterOpen() {
    storage.setItem('wallet:closed', false);
  },

  /**
   * Get words of the loaded wallet
   *
   * @param {string} password Password to decrypt the words
   *
   * @return {string} words of the wallet
   *
   * @memberof Wallet
   * @inner
   */
  getWalletWords(password) {
    const accessData = storage.getItem('wallet:accessData');
    return this.decryptData(accessData.words, password);
  },

  /*
   * Save backup done in storage
   *
   * @memberof Wallet
   * @inner
   */
  markBackupAsDone() {
    storage.setItem('wallet:backup', true);
  },

  /*
   * Save backup not done in storage
   *
   * @memberof Wallet
   * @inner
   */
  markBackupAsNotDone() {
    storage.removeItem('wallet:backup');
  },

  /*
   * Return if backup of wallet words is done
   *
   * @return {boolean} if wallet words are saved
   *
   * @memberof Wallet
   * @inner
   */
  isBackupDone() {
    return storage.getItem('wallet:backup') !== null;
  },

  /*
   * Reload data in the storage
   *
   * @memberof Wallet
   * @inner
   */
  reloadData() {
    // Get old access data
    const accessData = storage.getItem('wallet:accessData');
    const walletData = this.getWalletData();

    if (walletData === null) {
      return Promise.reject();
    }

    this.cleanWallet();
    // Restart websocket connection
    WebSocketHandler.setup();

    let newWalletData = {
      keys: {},
      xpubkey: walletData.xpubkey,
    }

    storage.setItem('wallet:accessData', accessData);
    storage.setItem('wallet:data', newWalletData);

    // Load history from new server
    const promise = this.loadAddressHistory(0, GAP_LIMIT);
    return promise;
  },

  /*
   * Verifies if output is an authority one checking with authority mask
   *
   * @param {Object} output Output object with 'token_data' key
   *
   * @return {boolean} if output is authority
   *
   * @memberof Wallet
   * @inner
   */
  isAuthorityOutput(output) {
    return transaction.isTokenDataAuthority(output.token_data);
  },

  /*
   * Verifies if output is of mint
   *
   * @param {Object} output Output object with 'token_data' and 'value' key
   *
   * @return {boolean} if output is mint
   *
   * @memberof Wallet
   * @inner
   */
  isMintOutput(output) {
    return this.isAuthorityOutput(output) && ((output.value & TOKEN_MINT_MASK) > 0);
  },

  /*
   * Verifies if output is of melt
   *
   * @param {Object} output Output object with 'token_data' and 'value' key
   *
   * @return {boolean} if output is melt
   *
   * @memberof Wallet
   * @inner
   */
  isMeltOutput(output) {
    return this.isAuthorityOutput(output) && ((output.value & TOKEN_MELT_MASK) > 0);
  },

  /*
   * Change server in storage
   *
   * @param {string} newServer New server to connect
   *
   * @memberof Wallet
   * @inner
   */
  changeServer(newServer) {
    storage.setItem('wallet:server', newServer);
  },

  /*
   * Set default server in storage
   *
   * @param {string} server Default server to be used
   *
   * @memberof Wallet
   * @inner
   */
  setDefaultServer(server) {
    storage.setItem('wallet:defaultServer', server);
  },

  /*
   * Remove the default server from storage
   *
   * @memberof Wallet
   * @inner
   */
  clearDefaultServer() {
    storage.removeItem('wallet:defaultServer');
  },

  /*
   * Prepare data (inputs and outputs) to be used in the send tokens
   *
   * @param {Object} data Object with array of inputs and outputs
   * @param {Object} token Corresponding token
   * @param {boolean} chooseInputs If should choose inputs automatically
   * @param {Object} historyTransactions Object of transactions indexed by tx_id
   * @param {Object} Array with all tokens already selected in the send tokens
   *
   * @return {Object} {success: boolean, message: error message in case of failure, data: prepared data in case of success}
   *
   * @memberof Wallet
   * @inner
   */
  prepareSendTokensData(data, token, chooseInputs, historyTransactions, allTokens) {
    // Get the data and verify if we need to select the inputs or add a change output

    // First get the amount of outputs
    let outputsAmount = 0;
    for (let output of data.outputs) {
      outputsAmount += output.value;
    }

    if (outputsAmount === 0) {
      return {success: false, message:  `Token: ${token.symbol}. Total value can't be 0`};
    }

    if (chooseInputs) {
      // If no inputs selected we select our inputs and, maybe add also a change output
      let newData = this.getInputsFromAmount(historyTransactions, outputsAmount, token.uid);

      data['inputs'] = newData['inputs'];

      if (newData.inputsAmount < outputsAmount) {
        // Don't have this amount of token
        return {success: false, message:  `Token ${token.symbol}: Insufficient amount of tokens`};
      }

      if (newData.inputsAmount > outputsAmount) {
        // Need to create change output
        let outputChange = this.getOutputChange(newData.inputsAmount - outputsAmount, tokens.getTokenIndex(allTokens, token.uid));
        data['outputs'].push(outputChange);
        // Shuffle outputs, so we don't have change output always in the same index
        data['outputs'] = _.shuffle(data['outputs']);
      }

    } else {
      // Validate the inputs used and if have to create a change output
      let inputsAmount = 0;
      for (const input of data.inputs) {
        const utxo = wallet.checkUnspentTxExists(historyTransactions, input.tx_id, input.index, token.uid);
        if (!utxo.exists) {
          return {success: false, message: `Token: ${token.symbol}. ${utxo.message}`};
        }

        const output = utxo.output;
        if (this.canUseUnspentTx(output)) {
          inputsAmount += output.value;
          input.address = output.decoded.address;
        } else {
          return {success: false, message: `Token: ${token.symbol}. Output [${input.tx_id}, ${input.index}] is locked until ${dateFormatter.parseTimestamp(output.decoded.timelock)}`};
        }
      }

      if (inputsAmount < outputsAmount) {
        return {success: false, message: `Token: ${token.symbol}. Sum of outputs is larger than the sum of inputs`};
      }

      if (inputsAmount > outputsAmount) {
        // Need to create change output
        let outputChange = wallet.getOutputChange(inputsAmount - outputsAmount, tokens.getTokenIndex(allTokens, token.uid));
        data['outputs'].push(outputChange);
        // Shuffle outputs, so we don't have change output always in the same index
        data['outputs'] = _.shuffle(data['outputs']);
      }
    }
    return {success: true, data};
  },

  /**
   * Get storage index and, in case is not null, parse to int
   *
   * @param {string} key Index key to get in the storage
   *
   * @return {number} Index parsed to integer or null
   * @memberof Wallet
   * @inner
   */
  getLocalStorageIndex(key) {
    let index = storage.getItem(`wallet:${key}`);
    if (index !== null) {
      index = parseInt(index, 10);
    }
    return index;
  },

  /**
   * Get storage last used index (in case is not set return null)
   *
   * @return {number} Last used index parsed to integer or null
   * @memberof Wallet
   * @inner
   */
  getLastUsedIndex() {
    return this.getLocalStorageIndex('lastUsedIndex');
  },

  /**
   * Get storage last shared index (in case is not set return null)
   *
   * @return {number} Last shared index parsed to integer or null
   * @memberof Wallet
   * @inner
   */
  getLastSharedIndex() {
    return this.getLocalStorageIndex('lastSharedIndex');
  },

  /**
   * Update the historyTransactions and allTokens from a new array of history that arrived
   *
   * Check if need to call loadHistory again to get more addresses data
   *
   * @param {Object} historyTransactions Object of transactions indexed by tx_id to be added the new txs
   * @param {Set} allTokens Set of all tokens (uid) already added
   * @param {Array} newHistory Array of new data that arrived from the server to be added to local data
   * @param {function} resolve Resolve method from promise to be called after finishing handling the new history
   * @param {Object} dataJson Wallet data in storage already loaded. This parameter is optional and if nothing is passed, the data will be loaded again. We expect this field to be the return of the method wallet.getWalletData()
   * @param {function} reject Reject method from promise to be called if an error happens
   *
   * @throws {OutputValueError} Will throw an error if one of the output value is invalid
   *
   * @return {Object} Return an object with {historyTransactions, allTokens, newSharedAddress, newSharedIndex, addressesFound}
   * @memberof Wallet
   * @inner
   */
  updateHistoryData(oldHistoryTransactions, oldAllTokens, newHistory, resolve, dataJson, reject) {
    if (dataJson === undefined) {
      dataJson = this.getWalletData();
    }
    const historyTransactions = Object.assign({}, oldHistoryTransactions);
    const allTokens = new Set(oldAllTokens);

    let maxIndex = -1;
    let lastUsedAddress = null;
    for (const tx of newHistory) {
      // If one of the outputs has a value that cannot be handled by the wallet we discard it
      for (const output of tx.outputs) {
        if (output.value > MAX_OUTPUT_VALUE) {
          throw new OutputValueError(`Transaction with id ${tx.tx_id} has output value of ${helpers.prettyValue(output.value)}. Maximum value is ${helpers.prettyValue(MAX_OUTPUT_VALUE)}`);
        }
      }

      historyTransactions[tx.tx_id] = tx

      for (const txin of tx.inputs) {
        const key = dataJson.keys[txin.decoded.address];
        if (key) {
          allTokens.add(txin.token);
          if (key.index > maxIndex) {
            maxIndex = key.index;
            lastUsedAddress = txin.decoded.address
          }
        }
      }
      for (const txout of tx.outputs) {
        const key = dataJson.keys[txout.decoded.address];
        if (key) {
          allTokens.add(txout.token);
          if (key.index > maxIndex) {
            maxIndex = key.index;
            lastUsedAddress = txout.decoded.address
          }
        }
      }
    }

    let lastUsedIndex = this.getLastUsedIndex();
    if (lastUsedIndex === null) {
      lastUsedIndex = -1;
    }

    let lastSharedIndex = this.getLastSharedIndex();
    if (lastSharedIndex === null) {
      lastSharedIndex = -1;
    }

    let newSharedAddress = null;
    let newSharedIndex = -1;

    if (maxIndex > lastUsedIndex && lastUsedAddress !== null) {
      // Setting last used index and last shared index
      this.setLastUsedIndex(lastUsedAddress);
      // Setting last shared address, if necessary
      const candidateIndex = maxIndex + 1;
      if (candidateIndex > lastSharedIndex) {
        const xpub = HDPublicKey(dataJson.xpubkey);
        const key = xpub.derive(candidateIndex);
        const address = Address(key.publicKey, network.getNetwork()).toString();
        newSharedIndex = candidateIndex;
        newSharedAddress = address;
        this.updateAddress(address, candidateIndex);
      }
    }

    // Saving to storage before resolving the promise
    this.saveAddressHistory(historyTransactions, allTokens);

    const lastGeneratedIndex = this.getLastGeneratedIndex();
    // Just in the case where there is no element in all data
    maxIndex = Math.max(maxIndex, 0);
    if (maxIndex + GAP_LIMIT > lastGeneratedIndex) {
      const startIndex = lastGeneratedIndex + 1;
      const count = maxIndex + GAP_LIMIT - lastGeneratedIndex;
      const promise = this.loadAddressHistory(startIndex, count);
      promise.then(() => {
        if (resolve) {
          resolve();
        }
      }, (e) => {
        if (reject) {
          reject(e);
        }
      })
    } else {
      // When it gets here, it means that already loaded all transactions
      // so no need to load more
      if (resolve) {
        resolve();
      }
    }

    return {historyTransactions, allTokens, newSharedAddress, newSharedIndex, addressesFound: lastGeneratedIndex + 1};
  },

  /**
   * Check if address is from the loaded wallet
   *
   * @param {string} address Address to check
   * @param {Object} data Wallet data in storage already loaded. This parameter is optional and if nothing is passed, the data will be loaded again. We expect this field to be the return of the method wallet.getWalletData()
   *
   * @return {boolean}
   * @memberof Wallet
   * @inner
   */
  isAddressMine(address, data) {
    if (data === undefined) {
      data = this.getWalletData();
    }

    if (data && address in data.keys) {
      return true;
    }
    return false;
  },

  /**
   * Get balance of a transaction for the loaded wallet
   * For each token if the wallet sent or received amount
   *
   * @param {Object} tx Transaction with outputs, inputs and tokens
   *
   * @return {Object} Object with balance for each token {'uid': value}
   * @memberof Wallet
   * @inner
   */
  getTxBalance(tx) {
    let balance = {};

    for (const txin of tx.inputs) {
      if (this.isAuthorityOutput(txin)) {
        continue;
      }
      if (this.isAddressMine(txin.decoded.address)) {
        let tokenUID = '';
        if (txin.decoded.token_data === HATHOR_TOKEN_INDEX) {
          tokenUID = HATHOR_TOKEN_CONFIG.uid;
        } else {
          tokenUID = tx.tokens[this.getTokenIndex(txin.decoded.token_data) - 1].uid;
        }
        if (tokenUID in balance) {
          balance[tokenUID] -= txin.value;
        } else {
          balance[tokenUID] = -txin.value;
        }
      }
    }

    for (const txout of tx.outputs) {
      if (this.isAuthorityOutput(txout)) {
        continue;
      }
      if (this.isAddressMine(txout.decoded.address)) {
        let tokenUID = '';
        if (txout.decoded.token_data === HATHOR_TOKEN_INDEX) {
          tokenUID = HATHOR_TOKEN_CONFIG.uid;
        } else {
          tokenUID = tx.tokens[this.getTokenIndex(txout.decoded.token_data) - 1].uid;
        }
        if (tokenUID in balance) {
          balance[tokenUID] += txout.value;
        } else {
          balance[tokenUID] = txout.value;
        }
      }
    }
    return balance;
  },

  /**
   * Checks if the transaction was already added to the history data of the wallet
   *
   * @param {Object} txData Transaction data with a key 'tx_id'
   *
   * @return {boolean} If the transaction is in the wallet or not
   *
   * @memberof Wallet
   * @inner
   */
  txExists(txData) {
    const data = this.getWalletData();
    return txData.tx_id in data['historyTransactions'];
  },

  /**
   * Check if all inputs from the txData are from this wallet
   *
   * @param {Object} txData Transaction data with a key 'inputs'
   *
   * @return {boolean} If all the inputs are from this wallet or not
   *
   * @memberof Wallet
   * @inner
   */
  areInputsMine(txData) {
    // If is a block, the inputs are never from this wallet
    if (helpers.isBlock(txData)) return false;

    const data = this.getWalletData();
    let mine = true;
    for (const input of txData.inputs) {
      if (!this.isAddressMine(input.decoded.address, data)) {
        mine = false;
        break;
      }
    }
    return mine;
  },

  /**
   * Get index of token list of the output
   *
   * @param {number} token_data Token data of the output
   *
   * @return {number} Index of the token of this output
   *
   * @memberof Wallet
   * @inner
   */
  getTokenIndex(token_data) {
    return token_data & TOKEN_INDEX_MASK;
  },

  /**
   * Update wallet type (hardware or software) on storage
   *
   * @param {string} type Wallet type
   *
   * @memberof Wallet
   * @inner
   */
  setWalletType(type) {
    storage.setItem('wallet:type', type);
  },

  /**
   * Return if wallet is software
   *
   * @return {boolean} True if wallet is software and false otherwise
   *
   * @memberof Wallet
   * @inner
   */
  isSoftwareWallet() {
    return storage.getItem('wallet:type') === 'software';
  },

  /**
   * Return if wallet is hardware
   *
   * @return {boolean} True if wallet is hardware and false otherwise
   *
   * @memberof Wallet
   * @inner
   */
  isHardwareWallet() {
    return storage.getItem('wallet:type') === 'hardware';
  },

  /**
   * Return wallet type beautified as string
   *
   * @return {string} Wallet type as a pretty string
   *
   * @memberof Wallet
   * @inner
   */
  getWalletTypePretty() {
    return this.isSoftwareWallet() ? 'Software Wallet' : 'Hardware Wallet';
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
  getPublicKey(index) {
    const data = this.getWalletData();
    const hdpubkey = HDPublicKey(data.xpubkey);
    const key = hdpubkey.derive(index);
    return key.publicKey.toBuffer();
  },
}

export default wallet;
