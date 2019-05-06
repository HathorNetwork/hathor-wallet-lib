'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _axiosInstance = require('./axiosInstance');

var _constants = require('../constants');

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var walletApi = {
  /**
   * Get address history from passed addresses
   *
   * @param {Array} addresses Array of addresses to search for the history
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getAddressHistory: function getAddressHistory(addresses, resolve) {
    var data = { addresses: addresses };
    return (0, _axiosInstance.createRequestInstance)(resolve).get('thin_wallet/address_history', { 'params': data }).then(function (res) {
      resolve(res.data);
    }, function (res) {
      return Promise.reject(res);
    });
  },


  /**
   * Execute method to send tokens
   *
   * @param {string} txHex Complete transaction serialized in hexadecimal
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  sendTokens: function sendTokens(txHex, resolve) {
    var postData = { tx_hex: txHex };
    return (0, _axiosInstance.createRequestInstance)(resolve, _constants.SEND_TOKENS_TIMEOUT).post('thin_wallet/send_tokens', postData).then(function (res) {
      resolve(res.data);
    }, function (res) {
      return Promise.reject(res);
    });
  }
};

exports.default = walletApi;