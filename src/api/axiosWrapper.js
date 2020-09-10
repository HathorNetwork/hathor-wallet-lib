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
 * @param {String} url Base URL for the api requests
 * @param {callback} resolve Callback to be stored and used in case of a retry after a fail
 * @param {number} timeout Timeout in milliseconds for the request
 */
export const axiosWrapperCreateRequestInstance = (url, resolve, timeout) => {
  if (timeout === undefined) {
    timeout = TIMEOUT;
  }
  const defaultOptions = {
    baseURL: url,
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  return axios.create(defaultOptions);
}

export default axiosWrapperCreateRequestInstance;
