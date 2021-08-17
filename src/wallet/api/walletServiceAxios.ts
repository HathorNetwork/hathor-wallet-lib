/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import { WALLET_SERVICE_BASE_URL, TIMEOUT } from '../../constants';
import HathorWalletServiceWallet from '../wallet';

/**
 * Method that creates an axios instance
 *
 * @module Axios
 */

/**
 * Create an axios instance to be used when sending requests
 *
 * @param {number} timeout Timeout in milliseconds for the request
 */
export const axiosInstance = async (wallet: HathorWalletServiceWallet | null = null, timeout: number = TIMEOUT) => {
  // TODO make base URL customizable
  // TODO How to allow 'Retry' request?
  const defaultOptions = {
    baseURL: WALLET_SERVICE_BASE_URL,
    timeout: timeout,
    // `validateStatus` defines whether to resolve or reject the promise for a given
    // HTTP response status code. If `validateStatus` returns `true` (or is set to `null`
    // or `undefined`), the promise will be resolved; otherwise, the promise will be
    // rejected. The default behaviour of axios is to reject anything different than 2xx
    // We need to handle some 400 manually (e.g. create wallet might already be loaded)
    validateStatus: (status) => status >= 200 && status < 500,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  if (wallet) {
    // Then we need the auth token
    await wallet.validateAndRenewAuthToken();
    defaultOptions['headers']['Authorization'] = `Bearer ${wallet.getAuthToken()}`;
  }

  return axios.create(defaultOptions);
}

export default axiosInstance;