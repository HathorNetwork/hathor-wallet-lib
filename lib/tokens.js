'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _transaction = require('./transaction');

var _transaction2 = _interopRequireDefault(_transaction);

var _bitcoreLib = require('bitcore-lib');

var _wallet = require('./api/wallet');

var _wallet2 = _interopRequireDefault(_wallet);

var _errors = require('./errors');

var _buffer = require('buffer');

var _buffer2 = _interopRequireDefault(_buffer);

var _constants = require('./constants');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } } /**
                                                                                                                                                                                                     * Copyright (c) Hathor Labs and its affiliates.
                                                                                                                                                                                                     *
                                                                                                                                                                                                     * This source code is licensed under the MIT license found in the
                                                                                                                                                                                                     * LICENSE file in the root directory of this source tree.
                                                                                                                                                                                                     */

/**
 * Methods to create and handle tokens
 *
 * @namespace Tokens
 */

var tokens = {
  /**
   * Create a token UID from the tx_id and index that the tx is spending to create the token
   *
   * @param {string} txID Transaction id in hexadecimal of the output that is being spent when creating the token
   * @param {number} index Index of the output that is being spent when creating the token
   *
   * @return {Buffer} UID of the token in bytes
   *
   * @memberof Tokens
   * @inner
   */
  getTokenUID: function getTokenUID(txID, index) {
    var arr = [];
    arr.push(_bitcoreLib.util.buffer.hexToBuffer(txID));
    arr.push(_transaction2.default.intToBytes(index, 1));
    return _bitcoreLib.crypto.Hash.sha256(_bitcoreLib.util.buffer.concat(arr));
  },


  /**
   * Add a new token to the localStorage and redux
   *
   * @param {string} uid Token uid
   * @param {string} name Token name
   * @param {string} symbol Token synbol
   *
   * @return {Array} array of token configs with new added one
   *
   * @memberof Tokens
   * @inner
   */
  addToken: function addToken(uid, name, symbol) {
    var newConfig = { 'name': name, 'symbol': symbol, 'uid': uid };
    var tokens = this.getTokens();
    tokens.push(newConfig);
    this.saveToStorage(tokens);
    return tokens;
  },


  /**
   * Edit token name and symbol. Save in localStorage and redux
   *
   * @param {string} uid Token uid to be edited
   * @param {string} name New token name
   * @param {string} synbol New token symbol
   *
   * @return {Array} array of token configs with edited one
   *
   * @memberof Tokens
   * @inner
   */
  editToken: function editToken(uid, name, symbol) {
    var tokens = this.getTokens();
    var filteredTokens = tokens.filter(function (token) {
      return token.uid !== uid;
    });
    var newConfig = { uid: uid, name: name, symbol: symbol };
    var editedTokens = [].concat(_toConsumableArray(filteredTokens), [newConfig]);
    this.saveToStorage(editedTokens);
    return editedTokens;
  },


  /**
   * Unregister token from localStorage and redux
   *
   * @param {string} uid Token uid to be unregistered
   *
   * @return {Array} array of token configs without the unregister one
   *
   * @memberof Tokens
   * @inner
   */
  unregisterToken: function unregisterToken(uid) {
    var tokens = this.getTokens();
    var filteredTokens = tokens.filter(function (token) {
      return token.uid !== uid;
    });
    this.saveToStorage(filteredTokens);
    return filteredTokens;
  },


  /**
   * Validation token by configuration string
   * Check if string is valid and, if uid is passed, check also if uid matches
   *
   * @param {string} config Token configuration string
   * @param {string} uid Uid to check if matches with uid from config (optional)
   *
   * @return {Object} {success: boolean, message: in case of failure, tokenData: object with token data in case of success}
   *
   * @memberof Tokens
   * @inner
   */
  validateTokenToAddByConfigurationString: function validateTokenToAddByConfigurationString(config, uid) {
    var tokenData = this.getTokenFromConfigurationString(config);
    if (tokenData === null) {
      return { success: false, message: 'Invalid configuration string' };
    }
    if (uid && uid !== tokenData.uid) {
      return { success: false, message: 'Configuration string uid does not match: ' + uid + ' != ' + tokenData.uid };
    }

    var validation = this.validateTokenToAddByUid(tokenData.uid);
    if (validation.success) {
      return { success: true, tokenData: tokenData };
    } else {
      return validation;
    }
  },


  /**
   * Validation token by uid. Check if already exist
   *
   * @param {string} uid Uid to check for existence
   *
   * @return {Object} {success: boolean, message: in case of failure}
   *
   * @memberof Tokens
   * @inner
   */
  validateTokenToAddByUid: function validateTokenToAddByUid(uid) {
    var existedToken = this.tokenExists(uid);
    if (existedToken) {
      return { success: false, message: 'You already have this token: ' + uid + ' (' + existedToken.name + ')' };
    }

    return { success: true };
  },


  /**
   * Returns the saved tokens in localStorage
   *
   * @return {Object} Array of objects ({'name', 'symbol', 'uid'}) of saved tokens
   *
   * @memberof Tokens
   * @inner
   */
  getTokens: function getTokens() {
    var dataToken = localStorage.getItem('wallet:tokens');
    if (dataToken) {
      dataToken = localStorage.memory ? dataToken : JSON.parse(dataToken);
    } else {
      dataToken = [_constants.HATHOR_TOKEN_CONFIG];
    }
    return dataToken;
  },


  /**
   * Updates the saved tokens in localStorage
   *
   * @param {Object} Array of objects ({'name', 'symbol', 'uid'}) with new tokens
   *
   * @memberof Tokens
   * @inner
   *
   */
  saveToStorage: function saveToStorage(newTokens) {
    var dataTokens = localStorage.memory ? newTokens : JSON.stringify(newTokens);
    localStorage.setItem('wallet:tokens', dataTokens);
  },


  /**
   * Returns token configuration string
   *
   * @param {string} uid Token uid
   * @param {string} name Token name
   * @param {string} symbol Token symbol
   *
   * @return {string} Configuration string of the token
   *
   * @memberof Tokens
   * @inner
   *
   */
  getConfigurationString: function getConfigurationString(uid, name, symbol) {
    var partialConfig = name + ':' + symbol + ':' + uid;
    var checksum = _transaction2.default.getChecksum(_buffer2.default.Buffer.from(partialConfig));
    return '[' + partialConfig + ':' + checksum.toString('hex') + ']';
  },


  /**
   * Returns token from configuration string
   * Configuration string has the following format:
   * [name:symbol:uid:checksum]
   *
   * @param {string} config Configuration string with token data plus a checksum
   *
   * @return {Object} token {'uid', 'name', 'symbol'} or null in case config is invalid
   *
   * @memberof Tokens
   * @inner
   *
   */
  getTokenFromConfigurationString: function getTokenFromConfigurationString(config) {
    // First we validate that first char is [ and last one is ]
    if (!config || config[0] !== '[' || config[config.length - 1] !== ']') {
      return null;
    }
    // Then we remove the [] and split the string by :
    var configArr = config.slice(1, -1).split(':');
    if (configArr.length < 4) {
      return null;
    }

    // Last element is the checksum
    var checksum = configArr.splice(-1);
    var configWithoutChecksum = configArr.join(':');
    var correctChecksum = _transaction2.default.getChecksum(_buffer2.default.Buffer.from(configWithoutChecksum));
    if (correctChecksum.toString('hex') !== checksum[0]) {
      return null;
    }
    var uid = configArr.pop();
    var symbol = configArr.pop();
    // Assuming that the name might have : on it
    var name = configArr.join(':');
    return { uid: uid, name: name, symbol: symbol };
  },


  /**
   * Indicates if a token with this uid was already added in the wallet
   *
   * @param {string} uid UID of the token to search
   *
   * @return {Object|null} Token if uid already exists, else null
   *
   * @memberof Tokens
   * @inner
   */
  tokenExists: function tokenExists(uid) {
    var tokens = this.getTokens();
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = tokens[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var token = _step.value;

        if (token.uid === uid) {
          return token;
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

    return null;
  },


  /**
   * Create the tx for the new token in the backend and creates a new mint and melt outputs to be used in the future
   *
   * @param {Object} input {'tx_id', 'index', 'token'} Hathor input to be spent to generate the token
   * @param {Object} output {'address', 'value', 'tokenData'} Hathor output to get the change of the input that generated the token
   * @param {string} address Address to receive the amount of the generated token
   * @param {string} name Name of the new token
   * @param {string} symbol Symbol of the new token
   * @param {number} mintAmount Amount of the new token that will be minted
   * @param {string} pin Pin to generate new addresses, if necessary
   *
   * @return {Promise} Promise that resolves when token is created or an error from the backend arrives
   *
   * @memberof Tokens
   * @inner
   */
  createToken: function createToken(input, output, address, name, symbol, mintAmount, pin) {
    var _this = this;

    // Create authority output
    // First the tokens masks that will be the value for the authority output
    var tokenMasks = _constants.TOKEN_CREATION_MASK | _constants.TOKEN_MINT_MASK | _constants.TOKEN_MELT_MASK;
    // Authority output token data
    var tokenData = 129;
    // Create token uid
    var tokenUID = this.getTokenUID(input.tx_id, input.index);
    var authorityOutput = { 'address': address, 'value': tokenMasks, 'tokenData': tokenData };
    // Create tx data
    var txData = { 'inputs': [input], 'outputs': [authorityOutput, output], 'tokens': [tokenUID] };
    // Get data to sign
    var dataToSign = _transaction2.default.dataToSign(txData);
    // Sign tx
    txData = _transaction2.default.signTx(txData, dataToSign, pin);
    // Assemble tx and send to backend
    _transaction2.default.completeTx(txData);
    var txBytes = _transaction2.default.txToBytes(txData);
    var txHex = _bitcoreLib.util.buffer.bufferToHex(txBytes);
    var promise = new Promise(function (resolve, reject) {
      _wallet2.default.sendTokens(txHex, function (response) {
        if (response.success) {
          // Save in localStorage and redux new token configuration
          _this.addToken(response.tx.tokens[0], name, symbol);
          var mintPromise = _this.mintTokens(response.tx.hash, response.tx.tokens[0], address, mintAmount, pin);
          mintPromise.then(function () {
            resolve({ uid: response.tx.tokens[0], name: name, symbol: symbol });
          }, function (message) {
            reject(message);
          });
        } else {
          reject(response.message);
        }
      }, function (e) {
        // Error in request
        console.log(e);
        reject(e.message);
      });
    });
    return promise;
  },


  /**
   * Mint new tokens
   *
   * @param {string} txId Hash of the transaction to be used to mint tokens
   * @param {string} token Token uid to be minted
   * @param {string} address Address to receive the amount of the generated token
   * @param {number} amount Amount of the new token that will be minted
   * @param {string} pin Pin to generate new addresses, if necessary
   *
   * @return {Promise} Promise that resolves when token is minted or an error from the backend arrives
   *
   * @memberof Tokens
   * @inner
   */
  mintTokens: function mintTokens(txId, token, address, amount, pin) {
    var promise = new Promise(function (resolve, reject) {
      // Authority output token data
      var tokenData = 129;
      // Now we will mint the tokens
      var newInput = { 'tx_id': txId, 'index': 0, 'token': token, 'address': address };
      // Output1: Mint token amount
      var tokenOutput1 = { 'address': address, 'value': amount, 'tokenData': 1 };
      // Output2: new mint authority
      var tokenOutput2 = { 'address': address, 'value': _constants.TOKEN_MINT_MASK, 'tokenData': tokenData };
      // Output3: new melt authority
      var tokenOutput3 = { 'address': address, 'value': _constants.TOKEN_MELT_MASK, 'tokenData': tokenData };
      // Create new data
      var newTxData = { 'inputs': [newInput], 'outputs': [tokenOutput1, tokenOutput2, tokenOutput3], 'tokens': [token] };
      try {
        // Get new data to sign
        var newDataToSign = _transaction2.default.dataToSign(newTxData);
        // Sign mint tx
        newTxData = _transaction2.default.signTx(newTxData, newDataToSign, pin);
        // Assemble tx and send to backend
        _transaction2.default.completeTx(newTxData);
        var newTxBytes = _transaction2.default.txToBytes(newTxData);
        var newTxHex = _bitcoreLib.util.buffer.bufferToHex(newTxBytes);
        _wallet2.default.sendTokens(newTxHex, function (response) {
          if (response.success) {
            resolve();
          } else {
            reject(response.message);
          }
        }, function (e) {
          // Error in request
          reject(e.message);
        });
      } catch (e) {
        if (e instanceof _errors.AddressError || e instanceof _errors.OutputValueError) {
          reject(e.message);
        } else {
          // Unhandled error
          throw e;
        }
      }
    });
    return promise;
  },


  /**
   * Filter an array of tokens removing one element
   *
   * @param {Object} tokens Array of token configs
   * @param {Object} toRemove Config of the token to be removed
   *
   * @return {Object} Array of token configs filtered
   *
   * @memberof Tokens
   * @inner
   */
  filterTokens: function filterTokens(tokens, toRemove) {
    return tokens.filter(function (token) {
      return token.uid !== toRemove.uid;
    });
  },


  /**
   * Gets the token index to be added to the tokenData in the output from tx
   *
   * @param {Object} tokens Array of token configs
   * @param {Object} uid Token uid to return the index
   *
   * @return {number} Index of token to be set as tokenData in output tx
   *
   * @memberof Tokens
   * @inner
   */
  getTokenIndex: function getTokenIndex(tokens, uid) {
    // If token is Hathor, index is always 0
    // Otherwise, it is always the array index + 1
    if (uid === _constants.HATHOR_TOKEN_CONFIG.uid) {
      return 0;
    } else {
      var tokensWithoutHathor = this.filterTokens(tokens, _constants.HATHOR_TOKEN_CONFIG);
      var myIndex = tokensWithoutHathor.findIndex(function (token) {
        return token.uid === uid;
      });
      return myIndex + 1;
    }
  }
};

exports.default = tokens;