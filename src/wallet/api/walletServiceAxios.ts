/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import {
    WALLET_SERVICE_BASE_URL,
    WALLET_SERVICE_TESTNET_BASE_URL,
    TIMEOUT,
} from '../../constants';
import HathorWalletServiceWallet from '../wallet';
import Network from '../../models/network';

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
export const axiosInstance = async (network: Network, wallet: HathorWalletServiceWallet | null = null, timeout: number = TIMEOUT) => {
  // TODO How to allow 'Retry' request?
  const defaultOptions = {
    baseURL: getBaseUrl(network),
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

/**
 * Returns the correct base url constant for wallet service based on the network
 *
 * @param {Network} network The network, can be either mainnet or testnet but will default to testnet
 */
const getBaseUrl = (network: Network): string => {
  if (network.name === 'mainnet') {
    return WALLET_SERVICE_BASE_URL;
  } else {
    return WALLET_SERVICE_TESTNET_BASE_URL;
  }
};

export default axiosInstance;
