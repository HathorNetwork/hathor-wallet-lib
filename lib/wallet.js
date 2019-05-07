'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _constants = require('./constants');

var _bitcoreMnemonic = require('bitcore-mnemonic');

var _bitcoreMnemonic2 = _interopRequireDefault(_bitcoreMnemonic);

var _bitcoreLib = require('bitcore-lib');

var _cryptoJs = require('crypto-js');

var _cryptoJs2 = _interopRequireDefault(_cryptoJs);

var _wallet = require('./api/wallet');

var _wallet2 = _interopRequireDefault(_wallet);

var _tokens = require('./tokens');

var _tokens2 = _interopRequireDefault(_tokens);

var _helpers = require('./helpers');

var _helpers2 = _interopRequireDefault(_helpers);

var _errors = require('./errors');

var _version = require('./version');

var _version2 = _interopRequireDefault(_version);

var _WebSocketHandler = require('./WebSocketHandler');

var _WebSocketHandler2 = _interopRequireDefault(_WebSocketHandler);

var _date = require('./date');

var _date2 = _interopRequireDefault(_date);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } } /**
                                                                                                                                                                                                     * Copyright (c) Hathor Labs and its affiliates.
                                                                                                                                                                                                     *
                                                                                                                                                                                                     * This source code is licensed under the MIT license found in the
                                                                                                                                                                                                     * LICENSE file in the root directory of this source tree.
                                                                                                                                                                                                     */

/**
 * We use localStorage and Redux to save data.
 * In localStorage we have the following keys (prefixed by wallet:)
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
var wallet = {
  /**
   * Validate if can generate the wallet with those parameters and then, call to generate it
   *
   * @param {string} words Words to generate the HD Wallet seed,
   * @param {string} passphrase
   * @param {string} pin
   * @param {string} password
   * @param {boolean} loadHistory if should load history from generated addresses
   *
   * @return {string} words generated (null if words are not valid)
   * @memberof Wallet
   * @inner
   */
  generateWallet: function generateWallet(words, passphrase, pin, password, loadHistory) {
    if (this.wordsValid(words).valid) {
      return this.executeGenerateWallet(words, passphrase, pin, password, loadHistory);
    } else {
      return null;
    }
  },


  /**
   * Verify if words passed to generate wallet are valid. In case of invalid, returns message
   *
   * @param {string} words Words (separated by space) to generate the HD Wallet seed
   *
   * @return {Object} {'valid': boolean, 'message': string}
   * @memberof Wallet
   * @inner
   */
  wordsValid: function wordsValid(words) {
    if (_lodash2.default.isString(words)) {
      if (words.split(' ').length !== 24) {
        // Must have 24 words
        return { 'valid': false, 'message': 'Must have 24 words' };
      } else if (!_bitcoreMnemonic2.default.isValid(words)) {
        // Invalid sequence of words
        return { 'valid': false, 'message': 'Invalid sequence of words' };
      }
    } else {
      // Must be string
      return { 'valid': false, 'message': 'Must be a string' };
    }
    return { 'valid': true, 'message': '' };
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
  generateWalletWords: function generateWalletWords(entropy) {
    var code = new _bitcoreMnemonic2.default(entropy);
    return code.phrase;
  },


  /**
   * Start a new HD wallet with new private key
   * Encrypt this private key and save data in localStorage
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
  executeGenerateWallet: function executeGenerateWallet(words, passphrase, pin, password, loadHistory) {
    _WebSocketHandler2.default.setup();
    var code = new _bitcoreMnemonic2.default(words);
    var xpriv = code.toHDPrivateKey(passphrase, _constants.NETWORK);
    var privkey = xpriv.derive('m/44\'/' + _constants.HATHOR_BIP44_CODE + '\'/0\'/0');

    var encryptedData = this.encryptData(privkey.xprivkey, pin);
    var encryptedDataWords = this.encryptData(words, password);

    // Save in localStorage the encrypted private key and the hash of the pin and password
    var access = {
      mainKey: encryptedData.encrypted.toString(),
      hash: encryptedData.hash.toString(),
      words: encryptedDataWords.encrypted.toString(),
      hashPasswd: encryptedDataWords.hash.toString()
    };

    var walletData = {
      keys: {},
      xpubkey: privkey.xpubkey
    };

    access = localStorage.memory ? access : JSON.stringify(access);
    walletData = localStorage.memory ? walletData : JSON.stringify(walletData);

    localStorage.setItem('wallet:accessData', access);
    localStorage.setItem('wallet:data', walletData);

    var promise = null;
    if (loadHistory) {
      // Load history from address
      promise = this.loadAddressHistory(0, _constants.GAP_LIMIT);
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
  getLastGeneratedIndex: function getLastGeneratedIndex() {
    var raw = localStorage.getItem('wallet:lastGeneratedIndex');
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
  getWalletData: function getWalletData() {
    var data = localStorage.getItem('wallet:data');
    if (!data) {
      return null;
    }
    return localStorage.memory ? data : JSON.parse(data);
  },


  /**
   * Load the history for each of the addresses of a new generated wallet
   * We always search until the GAP_LIMIT. If we have any history in the middle of the searched addresses
   * we search again until we have the GAP_LIMIT of addresses without any transactions
   * The loaded history is added to localStorage and Redux
   *
   * @param {number} startIndex Address index to start to load history
   * @param {number} count How many addresses I will load
   *
   * @return {Promise} Promise that resolves when addresses history is finished loading from server
   *
   * @memberof Wallet
   * @inner
   */
  loadAddressHistory: function loadAddressHistory(startIndex, count) {
    var _this = this;

    var promise = new Promise(function (resolve, reject) {
      // First generate all private keys and its addresses, then get history
      var addresses = [];
      var dataJson = _this.getWalletData();

      var xpub = (0, _bitcoreLib.HDPublicKey)(dataJson.xpubkey);
      var stopIndex = startIndex + count;
      for (var i = startIndex; i < stopIndex; i++) {
        // Generate each key from index, encrypt and save
        var key = xpub.derive(i);
        var address = (0, _bitcoreLib.Address)(key.publicKey, _constants.NETWORK);
        dataJson.keys[address.toString()] = { privkey: null, index: i };
        addresses.push(address.toString());

        // Subscribe in websocket to this address updates
        _this.subscribeAddress(address.toString());

        if (localStorage.getItem('wallet:address') === null) {
          // If still don't have an address to show on the screen
          _this.updateAddress(address.toString(), i);
        }
      }

      var lastGeneratedIndex = _this.getLastGeneratedIndex();
      if (lastGeneratedIndex < stopIndex - 1) {
        localStorage.setItem('wallet:lastGeneratedIndex', stopIndex - 1);
      }

      dataJson = localStorage.memory ? dataJson : JSON.stringify(dataJson);
      localStorage.setItem('wallet:data', dataJson);

      _wallet2.default.getAddressHistory(addresses, function (response) {
        var data = _this.getWalletData();
        // Update historyTransactions with new one
        var historyTransactions = 'historyTransactions' in data ? data['historyTransactions'] : {};
        var allTokens = 'allTokens' in data ? data['allTokens'] : [];
        var result = _this.updateHistoryData(historyTransactions, allTokens, response.history, resolve, data);
        _WebSocketHandler2.default.emit('addresses_loaded', result);
      }, function (e) {
        // Error in request
        console.log(e);
        reject(e);
      });
    });
    // Update the version of the wallet that the data was loaded
    localStorage.setItem('wallet:version', _constants.VERSION);
    // Check api version everytime we load address history
    _version2.default.checkApiVersion();
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
  addPassphrase: function addPassphrase(passphrase, pin, password) {
    var words = this.getWalletWords(password);
    this.cleanWallet();
    return this.generateWallet(words, passphrase, pin, password, true);
  },


  /**
   * Update address shared in localStorage and redux
   *
   * @param {string} lastSharedAddress
   * @param {number} lastSharedIndex
   * @memberof Wallet
   * @inner
   */
  updateAddress: function updateAddress(lastSharedAddress, lastSharedIndex) {
    localStorage.setItem('wallet:address', lastSharedAddress);
    localStorage.setItem('wallet:lastSharedIndex', lastSharedIndex);
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
  encryptData: function encryptData(privateKey, pin) {
    var encrypted = _cryptoJs2.default.AES.encrypt(privateKey, pin);
    var hash = this.hashPassword(pin);
    return { 'encrypted': encrypted, 'hash': hash };
  },


  /**
   * Get the hash (sha256) of a password
   *
   * @param {string} password Password to be hashes
   *
   * @return {Object} Object with hash of password
   *
   * @memberof Wallet
   * @inner
   */
  hashPassword: function hashPassword(password) {
    return _cryptoJs2.default.SHA256(_cryptoJs2.default.SHA256(password));
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
  decryptData: function decryptData(data, password) {
    var decrypted = _cryptoJs2.default.AES.decrypt(data, password);
    return decrypted.toString(_cryptoJs2.default.enc.Utf8);
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
  isPinCorrect: function isPinCorrect(pin) {
    var accessData = localStorage.getItem('wallet:accessData');
    var data = localStorage.memory ? accessData : JSON.parse(accessData);
    var pinHash = this.hashPassword(pin).toString();
    return pinHash === data.hash;
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
  isPasswordCorrect: function isPasswordCorrect(password) {
    var accessData = localStorage.getItem('wallet:accessData');
    var data = localStorage.memory ? accessData : JSON.parse(accessData);
    var passwordHash = this.hashPassword(password).toString();
    return passwordHash === data.hashPasswd;
  },


  /**
   * Checks if has more generated addresses after the last shared one
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  hasNewAddress: function hasNewAddress() {
    var lastGeneratedIndex = this.getLastGeneratedIndex();
    var lastSharedIndex = this.getLastSharedIndex();
    return lastGeneratedIndex > lastSharedIndex;
  },


  /**
   * Get next address after the last shared one (only if it's already generated)
   * Update the data in localStorage and Redux
   *
   * @memberof Wallet
   * @inner
   */
  getNextAddress: function getNextAddress() {
    var lastSharedIndex = this.getLastSharedIndex();
    var data = this.getWalletData();
    for (var address in data.keys) {
      if (data.keys[address].index === lastSharedIndex + 1) {
        this.updateAddress(address, lastSharedIndex + 1);
        return { address: address, index: lastSharedIndex + 1 };
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
  canGenerateNewAddress: function canGenerateNewAddress() {
    var lastUsedIndex = this.getLastUsedIndex();
    var lastGeneratedIndex = this.getLastGeneratedIndex();
    if (_constants.LIMIT_ADDRESS_GENERATION) {
      if (lastUsedIndex + _constants.GAP_LIMIT > lastGeneratedIndex) {
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
  generateNewAddress: function generateNewAddress() {
    var dataJson = this.getWalletData();
    var xpub = (0, _bitcoreLib.HDPublicKey)(dataJson.xpubkey);

    // Get last shared index to discover new index
    var lastSharedIndex = this.getLastSharedIndex();
    var newIndex = lastSharedIndex + 1;

    var newKey = xpub.derive(newIndex);
    var newAddress = (0, _bitcoreLib.Address)(newKey.publicKey, _constants.NETWORK);

    // Update address data and last generated indexes
    this.updateAddress(newAddress.toString(), newIndex);
    var lastGeneratedIndex = this.getLastGeneratedIndex();
    if (newIndex > lastGeneratedIndex) {
      localStorage.setItem('wallet:lastGeneratedIndex', newIndex);
    }

    // Save new keys to local storage
    var data = this.getWalletData();
    data.keys[newAddress.toString()] = { privkey: null, index: newIndex };
    data = localStorage.memory ? data : JSON.stringify(data);
    localStorage.setItem('wallet:data', data);

    // Subscribe in ws to new address updates
    this.subscribeAddress(newAddress.toString());

    return { newAddress: newAddress, newIndex: newIndex };
  },


  /**
   * Get the address to be used and generate a new one
   *
   * @return {string} address
   *
   * @memberof Wallet
   * @inner
   */
  getAddressToUse: function getAddressToUse() {
    var address = localStorage.getItem('wallet:address');
    // Updating address because the last one was used
    if (this.hasNewAddress()) {
      this.getNextAddress();
    } else {
      this.generateNewAddress();
    }
    return address;
  },


  /**
   * Validates if transaction is from this wallet (uses an address of this wallet)
   * and if this output/input is also from the selectedToken
   *
   * @param {Object} tx Transaction object
   * @param {string} selectedToken Token uid
   * @param {Object} walletData Wallet data in localStorage already loaded. This parameter is optional and if nothing is passed, the data will be loaded again. We expect this field to be the return of the method wallet.getWalletData()
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  hasTokenAndAddress: function hasTokenAndAddress(tx, selectedToken, walletData) {
    if (walletData === undefined) {
      walletData = this.getWalletData();
    }

    if (walletData === null) {
      return false;
    }

    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = tx.inputs[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var txin = _step.value;

        if (this.isAuthorityOutput(txin)) {
          continue;
        }

        if (txin.token === selectedToken) {
          if (this.isAddressMine(txin.decoded.address, walletData)) {
            return true;
          }
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    var _iteratorNormalCompletion2 = true;
    var _didIteratorError2 = false;
    var _iteratorError2 = undefined;

    try {
      for (var _iterator2 = tx.outputs[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
        var txout = _step2.value;

        if (this.isAuthorityOutput(txout)) {
          continue;
        }

        if (txout.token === selectedToken) {
          if (this.isAddressMine(txout.decoded.address, walletData)) {
            return true;
          }
        }
      }
    } catch (err) {
      _didIteratorError2 = true;
      _iteratorError2 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion2 && _iterator2.return) {
          _iterator2.return();
        }
      } finally {
        if (_didIteratorError2) {
          throw _iteratorError2;
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
   *
   * @return {Object} array of the filtered transactions
   *
   * @memberof Wallet
   * @inner
   */
  filterHistoryTransactions: function filterHistoryTransactions(historyTransactions, selectedToken) {
    var walletData = this.getWalletData();
    var data = [];
    for (var tx_id in historyTransactions) {
      var tx = historyTransactions[tx_id];
      if (this.hasTokenAndAddress(tx, selectedToken, walletData)) {
        data.push(tx);
      }
    }
    data.sort(function (a, b) {
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
  calculateBalance: function calculateBalance(historyTransactions, selectedToken) {
    var balance = { available: 0, locked: 0 };
    var data = this.getWalletData();
    if (data === null) {
      return balance;
    }
    var _iteratorNormalCompletion3 = true;
    var _didIteratorError3 = false;
    var _iteratorError3 = undefined;

    try {
      for (var _iterator3 = historyTransactions[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
        var tx = _step3.value;

        if (tx.is_voided) {
          // Ignore voided transactions.
          continue;
        }
        var _iteratorNormalCompletion4 = true;
        var _didIteratorError4 = false;
        var _iteratorError4 = undefined;

        try {
          for (var _iterator4 = tx.outputs[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
            var txout = _step4.value;

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
        } catch (err) {
          _didIteratorError4 = true;
          _iteratorError4 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion4 && _iterator4.return) {
              _iterator4.return();
            }
          } finally {
            if (_didIteratorError4) {
              throw _iteratorError4;
            }
          }
        }
      }
    } catch (err) {
      _didIteratorError3 = true;
      _iteratorError3 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion3 && _iterator3.return) {
          _iterator3.return();
        }
      } finally {
        if (_didIteratorError3) {
          throw _iteratorError3;
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
  canUseUnspentTx: function canUseUnspentTx(unspentTx) {
    if (unspentTx.decoded.timelock) {
      var currentTimestamp = _date2.default.dateToTimestamp(new Date());
      return currentTimestamp > unspentTx.decoded.timelock;
    } else {
      return true;
    }
  },


  /**
   * Save wallet data from redux to localStorage
   *
   * @param {Object} historyTransactions
   * @param {Object} allTokens Set of all tokens added to the wallet
   *
   * @memberof Wallet
   * @inner
   */
  saveAddressHistory: function saveAddressHistory(historyTransactions, allTokens) {
    var data = this.getWalletData();
    data['historyTransactions'] = historyTransactions;
    data['allTokens'] = [].concat(_toConsumableArray(allTokens));
    data = localStorage.memory ? data : JSON.stringify(data);
    localStorage.setItem('wallet:data', data);
  },


  /**
   * Check if wallet is already loaded
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  loaded: function loaded() {
    return localStorage.getItem('wallet:accessData') !== null;
  },


  /**
   * Check if wallet was already started (user clicked in 'Get started')
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  started: function started() {
    return localStorage.getItem('wallet:started') !== null;
  },


  /**
   * Save wallet as started
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  markWalletAsStarted: function markWalletAsStarted() {
    return localStorage.setItem('wallet:started', true);
  },


  /**
   * Subscribe to receive updates from an address in the websocket
   *
   * @param {string} address
   */
  subscribeAddress: function subscribeAddress(address) {
    var msg = JSON.stringify({ 'type': 'subscribe_address', 'address': address });
    _WebSocketHandler2.default.sendMessage(msg);
  },


  /**
   * Subscribe to receive updates from all generated addresses
   *
   * @memberof Wallet
   * @inner
   */
  subscribeAllAddresses: function subscribeAllAddresses() {
    var data = this.getWalletData();
    if (data) {
      for (var address in data.keys) {
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
  unsubscribeAddress: function unsubscribeAddress(address) {
    var msg = JSON.stringify({ 'type': 'unsubscribe_address', 'address': address });
    _WebSocketHandler2.default.sendMessage(msg);
  },


  /**
   * Unsubscribe to receive updates from all generated addresses
   * @memberof Wallet
   * @inner
   */
  unsubscribeAllAddresses: function unsubscribeAllAddresses() {
    var data = this.getWalletData();
    if (data) {
      for (var address in data.keys) {
        this.unsubscribeAddress(address);
      }
    }
  },


  /**
   * Get an address, find its index and set as last used in localStorage
   *
   * @param {string} address
   * @memberof Wallet
   * @inner
   */
  setLastUsedIndex: function setLastUsedIndex(address) {
    var data = this.getWalletData();
    if (data) {
      var index = data.keys[address].index;
      var lastUsedIndex = this.getLastUsedIndex();
      if (lastUsedIndex === null || index > parseInt(lastUsedIndex, 10)) {
        localStorage.setItem('wallet:lastUsedAddress', address);
        localStorage.setItem('wallet:lastUsedIndex', index);
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
  cleanWallet: function cleanWallet() {
    this.unsubscribeAllAddresses();
    this.cleanLocalStorage();
    _WebSocketHandler2.default.endConnection();
  },


  /*
   * Clean data from server
   *
   * @memberof Wallet
   * @inner
   */
  cleanServer: function cleanServer() {
    localStorage.removeItem('wallet:server');
  },


  /*
   * Clean all data from everything
   *
   * @memberof Wallet
   * @inner
   */
  resetAllData: function resetAllData() {
    this.cleanWallet();
    this.cleanServer();
    localStorage.removeItem('wallet:started');
    localStorage.removeItem('wallet:backup');
    localStorage.removeItem('wallet:locked');
    localStorage.removeItem('wallet:tokens');
    localStorage.removeItem('wallet:sentry');
  },


  /**
   * Remove all localStorages saved items
   * @memberof Wallet
   * @inner
   */
  cleanLocalStorage: function cleanLocalStorage() {
    localStorage.removeItem('wallet:accessData');
    localStorage.removeItem('wallet:data');
    localStorage.removeItem('wallet:address');
    localStorage.removeItem('wallet:lastSharedIndex');
    localStorage.removeItem('wallet:lastGeneratedIndex');
    localStorage.removeItem('wallet:lastUsedIndex');
    localStorage.removeItem('wallet:lastUsedAddress');
    localStorage.removeItem('wallet:closed');
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
  getInputsFromAmount: function getInputsFromAmount(historyTransactions, amount, selectedToken) {
    var ret = { 'inputs': [], 'inputsAmount': 0 };
    var data = this.getWalletData();
    if (data === null) {
      return ret;
    }

    for (var tx_id in historyTransactions) {
      var tx = historyTransactions[tx_id];
      if (tx.is_voided) {
        // Ignore voided transactions.
        continue;
      }

      var _iteratorNormalCompletion5 = true;
      var _didIteratorError5 = false;
      var _iteratorError5 = undefined;

      try {
        for (var _iterator5 = tx.outputs.entries()[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
          var _step5$value = _slicedToArray(_step5.value, 2),
              index = _step5$value[0],
              txout = _step5$value[1];

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
              ret.inputs.push({ tx_id: tx.tx_id, index: index, token: selectedToken, address: txout.decoded.address });
            }
          }
        }
      } catch (err) {
        _didIteratorError5 = true;
        _iteratorError5 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion5 && _iterator5.return) {
            _iterator5.return();
          }
        } finally {
          if (_didIteratorError5) {
            throw _iteratorError5;
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
   * @return {Object} {'address': string, 'value': number, 'tokenData': number}
   *
   * @memberof Wallet
   * @inner
   */
  getOutputChange: function getOutputChange(value, tokenData) {
    var address = this.getAddressToUse();
    return { 'address': address, 'value': value, 'tokenData': tokenData };
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
  checkUnspentTxExists: function checkUnspentTxExists(historyTransactions, txId, index, selectedToken) {
    var data = this.getWalletData();
    if (data === null) {
      return { exists: false, message: 'Data not loaded yet' };
    }
    for (var tx_id in historyTransactions) {
      var tx = historyTransactions[tx_id];
      if (tx.tx_id !== txId) {
        continue;
      }
      if (tx.is_voided) {
        // If tx is voided, not unspent
        return { exists: false, message: 'Transaction [' + txId + '] is voided' };
      }
      if (tx.outputs.length - 1 < index) {
        // Output with this index does not exist
        return { exists: false, message: 'Transaction [' + txId + '] does not have this output [index=' + index + ']' };
      }

      var txout = tx.outputs[index];
      if (this.isAuthorityOutput(txout)) {
        // Ignore authority outputs for now.
        return { exists: false, message: 'Output [' + index + '] of transaction [' + txId + '] is an authority output' };
      }

      if (!this.isAddressMine(txout.decoded.address, data)) {
        return { exists: false, message: 'Output [' + index + '] of transaction [' + txId + '] is not yours' };
      }

      if (txout.token !== selectedToken) {
        return { exists: false, message: 'Output [' + index + '] of transaction [' + txId + '] is not from selected token [' + selectedToken + ']' };
      }

      if (txout.spent_by !== null) {
        return { exists: false, message: 'Output [' + index + '] of transaction [' + txId + '] is already spent' };
      }
      return { exists: true, 'output': txout };
    }
    // Requests txId does not exist in historyTransactions
    return { exists: false, message: 'Transaction [' + txId + '] does not exist in the wallet' };
  },


  /*
   * Verify if has authority output available from tx_id, index and tokenUID
   *
   * @param {Array} key [tx_id, index]
   * @param {string} tokenUID UID of the token to check existence
   *
   * @return {boolean}
   *
   * @memberof Wallet
   * @inner
   */
  checkAuthorityExists: function checkAuthorityExists(key, tokenUID) {
    var data = this.getWalletData();
    if (data) {
      var jsonData = localStorage.memory ? data : JSON.parse(data);
      var authorityOutputs = jsonData.authorityOutputs;
      if (tokenUID in authorityOutputs && key in authorityOutputs[tokenUID]) {
        return true;
      } else {
        return false;
      }
    }
  },


  /*
   * Lock wallet
   *
   * @memberof Wallet
   * @inner
   */
  lock: function lock() {
    localStorage.setItem('wallet:locked', true);
  },


  /*
   * Unlock wallet
   *
   * @memberof Wallet
   * @inner
   */
  unlock: function unlock() {
    localStorage.removeItem('wallet:locked');
  },


  /*
   * Return if wallet is locked
   *
   * @return {boolean} if wallet is locked
   *
   * @memberof Wallet
   * @inner
   */
  isLocked: function isLocked() {
    return localStorage.getItem('wallet:locked') !== null;
  },


  /*
   * Return if wallet was closed
   *
   * @return {boolean} if wallet was closed
   *
   * @memberof Wallet
   * @inner
   */
  wasClosed: function wasClosed() {
    return localStorage.getItem('wallet:closed') !== null;
  },


  /*
   * Set in localStorage as closed
   *
   * @memberof Wallet
   * @inner
   */
  close: function close() {
    localStorage.setItem('wallet:closed', true);
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
  getWalletWords: function getWalletWords(password) {
    var accessData = localStorage.getItem('wallet:accessData');
    var data = localStorage.memory ? accessData : JSON.parse(accessData);
    return this.decryptData(data.words, password);
  },


  /*
   * Save backup done in localStorage
   *
   * @memberof Wallet
   * @inner
   */
  markBackupAsDone: function markBackupAsDone() {
    localStorage.setItem('wallet:backup', true);
  },


  /*
   * Save backup not done in localStorage
   *
   * @memberof Wallet
   * @inner
   */
  markBackupAsNotDone: function markBackupAsNotDone() {
    localStorage.removeItem('wallet:backup');
  },


  /*
   * Return if backup of wallet words is done
   *
   * @return {boolean} if wallet words are saved
   *
   * @memberof Wallet
   * @inner
   */
  isBackupDone: function isBackupDone() {
    return localStorage.getItem('wallet:backup') !== null;
  },


  /*
   * Reload data in the localStorage
   *
   * @memberof Wallet
   * @inner
   */
  reloadData: function reloadData() {
    // Get old access data
    var accessDataStorage = localStorage.getItem('wallet:accessData');
    var accessData = localStorage.memory ? accessDataStorage : JSON.parse(accessDataStorage);
    var walletData = this.getWalletData();

    this.cleanWallet();
    // Restart websocket connection
    _WebSocketHandler2.default.setup();

    var newWalletData = {
      keys: {},
      xpubkey: walletData.xpubkey

      // Prepare to save new data
    };accessData = localStorage.memory ? accessData : JSON.stringify(accessData);
    newWalletData = localStorage.memory ? newWalletData : JSON.stringify(newWalletData);

    localStorage.setItem('wallet:accessData', accessData);
    localStorage.setItem('wallet:data', newWalletData);

    // Load history from new server
    var promise = this.loadAddressHistory(0, _constants.GAP_LIMIT);
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
  isAuthorityOutput: function isAuthorityOutput(output) {
    return (output.token_data & _constants.TOKEN_AUTHORITY_MASK) > 0;
  },


  /*
   * Change server in localStorage
   *
   * @param {string} newServer New server to connect
   *
   * @memberof Wallet
   * @inner
   */
  changeServer: function changeServer(newServer) {
    localStorage.setItem('wallet:server', newServer);
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
  prepareSendTokensData: function prepareSendTokensData(data, token, chooseInputs, historyTransactions, allTokens) {
    // Get the data and verify if we need to select the inputs or add a change output

    // First get the amount of outputs
    var outputsAmount = 0;
    var _iteratorNormalCompletion6 = true;
    var _didIteratorError6 = false;
    var _iteratorError6 = undefined;

    try {
      for (var _iterator6 = data.outputs[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
        var _output = _step6.value;

        outputsAmount += _output.value;
      }
    } catch (err) {
      _didIteratorError6 = true;
      _iteratorError6 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion6 && _iterator6.return) {
          _iterator6.return();
        }
      } finally {
        if (_didIteratorError6) {
          throw _iteratorError6;
        }
      }
    }

    if (outputsAmount === 0) {
      return { success: false, message: 'Token: ' + token.symbol + '. Total value can\'t be 0' };
    }

    if (chooseInputs) {
      // If no inputs selected we select our inputs and, maybe add also a change output
      var newData = this.getInputsFromAmount(historyTransactions, outputsAmount, token.uid);

      data['inputs'] = newData['inputs'];

      if (newData.inputsAmount < outputsAmount) {
        // Don't have this amount of token
        return { success: false, message: 'Token ' + token.symbol + ': Insufficient amount of tokens' };
      }

      if (newData.inputsAmount > outputsAmount) {
        // Need to create change output
        var outputChange = this.getOutputChange(newData.inputsAmount - outputsAmount, _tokens2.default.getTokenIndex(allTokens, token.uid));
        data['outputs'].push(outputChange);
        // Shuffle outputs, so we don't have change output always in the same index
        data['outputs'] = _lodash2.default.shuffle(data['outputs']);
      }
    } else {
      // Validate the inputs used and if have to create a change output
      var inputsAmount = 0;
      var _iteratorNormalCompletion7 = true;
      var _didIteratorError7 = false;
      var _iteratorError7 = undefined;

      try {
        for (var _iterator7 = data.inputs[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
          var input = _step7.value;

          var utxo = wallet.checkUnspentTxExists(historyTransactions, input.tx_id, input.index, token.uid);
          if (!utxo.exists) {
            return { success: false, message: 'Token: ' + token.symbol + '. ' + utxo.message };
          }

          var output = utxo.output;
          if (this.canUseUnspentTx(output)) {
            inputsAmount += output.value;
            input.address = output.decoded.address;
          } else {
            return { success: false, message: 'Token: ' + token.symbol + '. Output [' + input.tx_id + ', ' + input.index + '] is locked until ' + _date2.default.parseTimestamp(output.decoded.timelock) };
          }
        }
      } catch (err) {
        _didIteratorError7 = true;
        _iteratorError7 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion7 && _iterator7.return) {
            _iterator7.return();
          }
        } finally {
          if (_didIteratorError7) {
            throw _iteratorError7;
          }
        }
      }

      if (inputsAmount < outputsAmount) {
        return { success: false, message: 'Token: ' + token.symbol + '. Sum of outputs is larger than the sum of inputs' };
      }

      if (inputsAmount > outputsAmount) {
        // Need to create change output
        var _outputChange = wallet.getOutputChange(inputsAmount - outputsAmount, _tokens2.default.getTokenIndex(allTokens, token.uid));
        data['outputs'].push(_outputChange);
      }
    }
    return { success: true, data: data };
  },


  /**
   * Get localStorage index and, in case is not null, parse to int
   *
   * @param {string} key Index key to get in the localStorage
   *
   * @return {number} Index parsed to integer or null
   * @memberof Wallet
   * @inner
   */
  getLocalStorageIndex: function getLocalStorageIndex(key) {
    var index = localStorage.getItem('wallet:' + key);
    if (index !== null) {
      index = parseInt(index, 10);
    }
    return index;
  },


  /**
   * Get localStorage last used index (in case is not set return null)
   *
   * @return {number} Last used index parsed to integer or null
   * @memberof Wallet
   * @inner
   */
  getLastUsedIndex: function getLastUsedIndex() {
    return this.getLocalStorageIndex('lastUsedIndex');
  },


  /**
   * Get localStorage last shared index (in case is not set return null)
   *
   * @return {number} Last shared index parsed to integer or null
   * @memberof Wallet
   * @inner
   */
  getLastSharedIndex: function getLastSharedIndex() {
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
   * @param {Object} dataJson Wallet data in localStorage already loaded. This parameter is optional and if nothing is passed, the data will be loaded again. We expect this field to be the return of the method wallet.getWalletData()
   *
   * @throws {OutputValueError} Will throw an error if one of the output value is invalid
   *
   * @return {Object} Return an object with {historyTransactions, allTokens, newSharedAddress, newSharedIndex, addressesFound}
   * @memberof Wallet
   * @inner
   */
  updateHistoryData: function updateHistoryData(oldHistoryTransactions, oldAllTokens, newHistory, resolve, dataJson) {
    if (dataJson === undefined) {
      dataJson = this.getWalletData();
    }
    var historyTransactions = Object.assign({}, oldHistoryTransactions);
    var allTokens = new Set(oldAllTokens);

    var maxIndex = -1;
    var lastUsedAddress = null;
    var _iteratorNormalCompletion8 = true;
    var _didIteratorError8 = false;
    var _iteratorError8 = undefined;

    try {
      for (var _iterator8 = newHistory[Symbol.iterator](), _step8; !(_iteratorNormalCompletion8 = (_step8 = _iterator8.next()).done); _iteratorNormalCompletion8 = true) {
        var tx = _step8.value;

        // If one of the outputs has a value that cannot be handled by the wallet we discard it
        var _iteratorNormalCompletion9 = true;
        var _didIteratorError9 = false;
        var _iteratorError9 = undefined;

        try {
          for (var _iterator9 = tx.outputs[Symbol.iterator](), _step9; !(_iteratorNormalCompletion9 = (_step9 = _iterator9.next()).done); _iteratorNormalCompletion9 = true) {
            var output = _step9.value;

            if (output.value > _constants.MAX_OUTPUT_VALUE) {
              throw new _errors.OutputValueError('Transaction with id ' + tx.tx_id + ' has output value of ' + _helpers2.default.prettyValue(output.value) + '. Maximum value is ' + _helpers2.default.prettyValue(_constants.MAX_OUTPUT_VALUE));
            }
          }
        } catch (err) {
          _didIteratorError9 = true;
          _iteratorError9 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion9 && _iterator9.return) {
              _iterator9.return();
            }
          } finally {
            if (_didIteratorError9) {
              throw _iteratorError9;
            }
          }
        }

        historyTransactions[tx.tx_id] = tx;

        var _iteratorNormalCompletion10 = true;
        var _didIteratorError10 = false;
        var _iteratorError10 = undefined;

        try {
          for (var _iterator10 = tx.inputs[Symbol.iterator](), _step10; !(_iteratorNormalCompletion10 = (_step10 = _iterator10.next()).done); _iteratorNormalCompletion10 = true) {
            var txin = _step10.value;

            var _key = dataJson.keys[txin.decoded.address];
            if (_key) {
              allTokens.add(txin.token);
              if (_key.index > maxIndex) {
                maxIndex = _key.index;
                lastUsedAddress = txin.decoded.address;
              }
            }
          }
        } catch (err) {
          _didIteratorError10 = true;
          _iteratorError10 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion10 && _iterator10.return) {
              _iterator10.return();
            }
          } finally {
            if (_didIteratorError10) {
              throw _iteratorError10;
            }
          }
        }

        var _iteratorNormalCompletion11 = true;
        var _didIteratorError11 = false;
        var _iteratorError11 = undefined;

        try {
          for (var _iterator11 = tx.outputs[Symbol.iterator](), _step11; !(_iteratorNormalCompletion11 = (_step11 = _iterator11.next()).done); _iteratorNormalCompletion11 = true) {
            var txout = _step11.value;

            var _key2 = dataJson.keys[txout.decoded.address];
            if (_key2) {
              allTokens.add(txout.token);
              if (_key2.index > maxIndex) {
                maxIndex = _key2.index;
                lastUsedAddress = txout.decoded.address;
              }
            }
          }
        } catch (err) {
          _didIteratorError11 = true;
          _iteratorError11 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion11 && _iterator11.return) {
              _iterator11.return();
            }
          } finally {
            if (_didIteratorError11) {
              throw _iteratorError11;
            }
          }
        }
      }
    } catch (err) {
      _didIteratorError8 = true;
      _iteratorError8 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion8 && _iterator8.return) {
          _iterator8.return();
        }
      } finally {
        if (_didIteratorError8) {
          throw _iteratorError8;
        }
      }
    }

    var lastUsedIndex = this.getLastUsedIndex();
    if (lastUsedIndex === null) {
      lastUsedIndex = -1;
    }

    var lastSharedIndex = this.getLastSharedIndex();
    if (lastSharedIndex === null) {
      lastSharedIndex = -1;
    }

    var newSharedAddress = null;
    var newSharedIndex = -1;

    if (maxIndex > lastUsedIndex && lastUsedAddress !== null) {
      // Setting last used index and last shared index
      this.setLastUsedIndex(lastUsedAddress);
      // Setting last shared address, if necessary
      var candidateIndex = maxIndex + 1;
      if (candidateIndex > lastSharedIndex) {
        var xpub = (0, _bitcoreLib.HDPublicKey)(dataJson.xpubkey);
        var key = xpub.derive(candidateIndex);
        var address = (0, _bitcoreLib.Address)(key.publicKey, _constants.NETWORK).toString();
        newSharedIndex = candidateIndex;
        newSharedAddress = address;
        this.updateAddress(address, candidateIndex);
      }
    }

    // Saving to localStorage before resolving the promise
    this.saveAddressHistory(historyTransactions, allTokens);

    var lastGeneratedIndex = this.getLastGeneratedIndex();
    // Just in the case where there is no element in all data
    maxIndex = Math.max(maxIndex, 0);
    if (maxIndex + _constants.GAP_LIMIT > lastGeneratedIndex) {
      var startIndex = lastGeneratedIndex + 1;
      var count = maxIndex + _constants.GAP_LIMIT - lastGeneratedIndex;
      var promise = this.loadAddressHistory(startIndex, count);
      promise.then(function () {
        if (resolve) {
          resolve();
        }
      });
    } else {
      // When it gets here, it means that already loaded all transactions
      // so no need to load more
      if (resolve) {
        resolve();
      }
    }

    return { historyTransactions: historyTransactions, allTokens: allTokens, newSharedAddress: newSharedAddress, newSharedIndex: newSharedIndex, addressesFound: lastGeneratedIndex + 1 };
  },


  /**
   * Check if address is from the loaded wallet
   *
   * @param {string} address Address to check
   * @param {Object} data Wallet data in localStorage already loaded. This parameter is optional and if nothing is passed, the data will be loaded again. We expect this field to be the return of the method wallet.getWalletData()
   *
   * @return {boolean}
   * @memberof Wallet
   * @inner
   */
  isAddressMine: function isAddressMine(address, data) {
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
  getTxBalance: function getTxBalance(tx) {
    var balance = {};

    var _iteratorNormalCompletion12 = true;
    var _didIteratorError12 = false;
    var _iteratorError12 = undefined;

    try {
      for (var _iterator12 = tx.inputs[Symbol.iterator](), _step12; !(_iteratorNormalCompletion12 = (_step12 = _iterator12.next()).done); _iteratorNormalCompletion12 = true) {
        var txin = _step12.value;

        if (this.isAuthorityOutput(txin)) {
          continue;
        }
        if (this.isAddressMine(txin.decoded.address)) {
          var tokenUID = '';
          if (txin.decoded.token_data === _constants.HATHOR_TOKEN_INDEX) {
            tokenUID = _constants.HATHOR_TOKEN_CONFIG.uid;
          } else {
            tokenUID = tx.tokens[txin.decoded.token_data - 1];
          }
          if (tokenUID in balance) {
            balance[tokenUID] -= txin.value;
          } else {
            balance[tokenUID] = -txin.value;
          }
        }
      }
    } catch (err) {
      _didIteratorError12 = true;
      _iteratorError12 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion12 && _iterator12.return) {
          _iterator12.return();
        }
      } finally {
        if (_didIteratorError12) {
          throw _iteratorError12;
        }
      }
    }

    var _iteratorNormalCompletion13 = true;
    var _didIteratorError13 = false;
    var _iteratorError13 = undefined;

    try {
      for (var _iterator13 = tx.outputs[Symbol.iterator](), _step13; !(_iteratorNormalCompletion13 = (_step13 = _iterator13.next()).done); _iteratorNormalCompletion13 = true) {
        var txout = _step13.value;

        if (this.isAuthorityOutput(txout)) {
          continue;
        }
        if (this.isAddressMine(txout.decoded.address)) {
          var _tokenUID = '';
          if (txout.decoded.token_data === _constants.HATHOR_TOKEN_INDEX) {
            _tokenUID = _constants.HATHOR_TOKEN_CONFIG.uid;
          } else {
            _tokenUID = tx.tokens[txout.decoded.token_data - 1];
          }
          if (_tokenUID in balance) {
            balance[_tokenUID] += txout.value;
          } else {
            balance[_tokenUID] = txout.value;
          }
        }
      }
    } catch (err) {
      _didIteratorError13 = true;
      _iteratorError13 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion13 && _iterator13.return) {
          _iterator13.return();
        }
      } finally {
        if (_didIteratorError13) {
          throw _iteratorError13;
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
  txExists: function txExists(txData) {
    var data = this.getWalletData();
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
  areInputsMine: function areInputsMine(txData) {
    // If is a block, the inputs are never from this wallet
    if (_helpers2.default.isBlock(txData)) return false;

    var data = this.getWalletData();
    var mine = true;
    var _iteratorNormalCompletion14 = true;
    var _didIteratorError14 = false;
    var _iteratorError14 = undefined;

    try {
      for (var _iterator14 = txData.inputs[Symbol.iterator](), _step14; !(_iteratorNormalCompletion14 = (_step14 = _iterator14.next()).done); _iteratorNormalCompletion14 = true) {
        var input = _step14.value;

        if (!this.isAddressMine(input.decoded.address, data)) {
          mine = false;
          break;
        }
      }
    } catch (err) {
      _didIteratorError14 = true;
      _iteratorError14 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion14 && _iterator14.return) {
          _iterator14.return();
        }
      } finally {
        if (_didIteratorError14) {
          throw _iteratorError14;
        }
      }
    }

    return mine;
  }
};

exports.default = wallet;