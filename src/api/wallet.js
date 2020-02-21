/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';
import { SEND_TOKENS_TIMEOUT } from '../constants';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
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
  getAddressHistory(addresses, resolve) {
    const data = {addresses};
    return createRequestInstance(resolve).get('thin_wallet/address_history', {'params': data}).then((res) => {
      resolve(res.data)
    }, (res) => {
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
  sendTokens(txHex, resolve) {
    const postData = {tx_hex: txHex};
    return createRequestInstance(resolve, SEND_TOKENS_TIMEOUT).post('thin_wallet/send_tokens', postData).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Call get general token info API
   *
   * @param {string} uid Token uid to get the general info
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getGeneralTokenInfo(uid, resolve) {
    const data = {id: uid};
    return createRequestInstance(resolve).get('thin_wallet/token', {'params': data}).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Call get token transaction history API
   *
   * @param {string} uid Token uid to get the info
   * @param {number} count Quantity of elements to be returned
   * @param {string} hash Hash of transaction as reference in pagination
   * @param {number} timestamp Timestamp of transaction as reference in pagination
   * @param {string} page The button clicked in the pagination ('previous' or 'next')
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getTokenHistory(uid, count, hash, timestamp, page, resolve) {
    const data = {id: uid, count};

    if (hash) {
      data['hash'] = hash
      data['timestamp'] = timestamp
      data['page'] = page
    }

    return createRequestInstance(resolve).get('thin_wallet/token_history', {'params': data}).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Call get mining info data
   *
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getMiningInfo(resolve) {
    return createRequestInstance(resolve).get('getmininginfo').then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Call get tokens list API
   *
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getTokensList(resolve) {
    return createRequestInstance(resolve).get('thin_wallet/token').then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Get address balance summary
   *
   * @param {String} addresse Address to get the balance summary
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getAddressBalance(address, resolve) {
    const data = {address};
    return createRequestInstance(resolve).get('thin_wallet/address_balance', {'params': data}).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Search address
   *
   * @param {String} address Address to search history
   * @param {Number} count Quantity of elements to return
   * @param {String} hash Optional pagination parameter to reference the search
   * @param {String} page Optional pagination parameter to indicate which page button was clicked
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getSearchAddress(address, count, hash, page, token, resolve) {
    const data = {address, count};

    if (hash) {
      data['hash'] = hash;
      data['page'] = page;
    }

    if (token) {
      data['token'] = token;
    }

    return createRequestInstance(resolve).get('thin_wallet/address_search', {'params': data}).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

};

export default walletApi;
