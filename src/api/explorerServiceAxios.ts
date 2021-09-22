/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import {
    EXPLORER_SERVICE_BASE_URL,
    EXPLORER_SERVICE_TESTNET_BASE_URL,
    TIMEOUT,
} from '../constants';

/**
 * Method that creates an axios instance
 *
 * @module Axios
 */

/**
 * Create an axios instance to be used when sending requests to the explorer service
 *
 * @param {string} network The network to access the explorer service
 * @param {number} timeout Timeout in milliseconds for the request
 */
export const axiosInstance = async (network: string, timeout: number = TIMEOUT) => {
  const defaultOptions = {
    baseURL: getBaseUrl(network),
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  return axios.create(defaultOptions);
}

/**
 * Returns the correct base url constant for wallet service based on the network
 *
 * @param {string} network The network, can be either mainnet or testnet
 */
const getBaseUrl = (network: string): string => {
  if (network === 'mainnet') {
    return EXPLORER_SERVICE_BASE_URL;
  } else {
    return EXPLORER_SERVICE_TESTNET_BASE_URL;
  }
};

export default axiosInstance;