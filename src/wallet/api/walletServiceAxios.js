/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import { TIMEOUT } from '../constants';

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
export const axiosInstance = (timeout) => {
  // TODO make base URL customizable
  // TODO How to allow 'Retry' request?
  if (timeout === undefined) {
    timeout = TIMEOUT;
  }
  const defaultOptions = {
    baseURL: 'https://ot51ga8oh6.execute-api.us-east-1.amazonaws.com/local/',
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  return axios.create(defaultOptions);
}

export default axiosInstance;