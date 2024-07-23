/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AxiosResponse } from 'axios';
import { createRequestInstance } from './axiosInstance';
import { SEND_TOKENS_TIMEOUT } from '../constants';
import { transformJsonBigIntResponse } from '../utils/bigint';
import {
  AddressHistorySchema,
  addressHistorySchema,
  GeneralTokenInfoSchema,
  generalTokenInfoSchema,
} from './schemas/wallet';

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
   * @param {String} hash String of the hash to start the search in the first address (optional)
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getAddressHistory(addresses, hash, resolve): Promise<void | AxiosResponse<AddressHistorySchema>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { addresses, paginate: true };
    if (hash) {
      data.hash = hash;
    }
    return createRequestInstance(resolve)
      .get('thin_wallet/address_history', {
        params: data,
        transformResponse: res => transformJsonBigIntResponse(res, addressHistorySchema),
      })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
  },

  /**
   * Call API to get address history
   *
   * XXX Our current method to allow retry a request demands that we create an axios
   * instance with a resolve callback, which will be used in case of failure and the
   * user decides to retry. Because of that, it's impossible to use the old method (getAddressHistory)
   * to get data with async/await, only with promises. Because of the pagination,
   * we are in a loop getting data while not finished, so the code with async/await is
   * much cleaner.
   *
   * So, right now to use async/await we must use this method and it's not possible to
   * retry a request executed here. We must redesign the retry structure, so we can
   * support calling API methods with async/await.
   *
   * @param {Array} addresses Array of addresses to search for the history
   * @param {String} hash String of the hash to start the search in the first address (optional)
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getAddressHistoryForAwait(addresses, hash): Promise<AxiosResponse<AddressHistorySchema>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { addresses, paginate: true };
    if (hash) {
      data.hash = hash;
    }
    return createRequestInstance().get('thin_wallet/address_history', {
      params: data,
      transformResponse: res => transformJsonBigIntResponse(res, addressHistorySchema),
    });
  },

  /**
   * Same as the GET API but as a POST, in order to support requests with many addresses
   * in the GET we are getting 414, which is URI too large
   *
   * @param {Array} addresses Array of addresses to search for the history
   * @param {String} hash String of the hash to start the search in the first address (optional)
   *
   * @return {Promise}
   * @memberof ApiWallet
   * @inner
   */
  getAddressHistoryForAwaitPOST(addresses, hash): Promise<AxiosResponse<AddressHistorySchema>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { addresses, paginate: true };
    if (hash) {
      data.hash = hash;
    }
    return createRequestInstance().post('thin_wallet/address_history', data, {
      transformResponse: res => transformJsonBigIntResponse(res, addressHistorySchema),
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
    const postData = { tx_hex: txHex };
    return createRequestInstance(resolve, SEND_TOKENS_TIMEOUT)
      .post('thin_wallet/send_tokens', postData)
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
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
  getGeneralTokenInfo(uid, resolve): Promise<void | AxiosResponse<GeneralTokenInfoSchema>> {
    const data = { id: uid };
    return createRequestInstance(resolve)
      .get('thin_wallet/token', {
        params: data,
        transformResponse: res => transformJsonBigIntResponse(res, generalTokenInfoSchema),
      })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { id: uid, count };

    if (hash) {
      data.hash = hash;
      data.timestamp = timestamp;
      data.page = page;
    }

    return createRequestInstance(resolve)
      .get('thin_wallet/token_history', { params: data })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
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
    return createRequestInstance(resolve)
      .get('getmininginfo')
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
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
    return createRequestInstance(resolve)
      .get('thin_wallet/token')
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
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
    const data = { address };
    return createRequestInstance(resolve)
      .get('thin_wallet/address_balance', { params: data })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { address, count };

    if (hash) {
      data.hash = hash;
      data.page = page;
    }

    if (token) {
      data.token = token;
    }

    return createRequestInstance(resolve)
      .get('thin_wallet/address_search', { params: data })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
  },
};

export default walletApi;
