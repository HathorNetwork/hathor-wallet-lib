/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import { TIMEOUT } from '../constants';
import config from '../config';

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
 * @param {Object} additionalHeaders Headers to be sent with the request
 */
export const axiosWrapperCreateRequestInstance = (url: string, resolve?: Function, timeout?: number, additionalHeaders = {}) => {
  if (timeout === undefined) {
    timeout = TIMEOUT;
  }

  // Any application using the lib may set in the config object a user agent to be set in all requests
  const userAgent = config.getUserAgent();
  if (userAgent) {
    additionalHeaders['User-Agent'] = userAgent;
  }

  const defaultOptions = {
    baseURL: url,
    timeout: timeout,
    headers: Object.assign({
      'Content-Type': 'application/json',
    }, additionalHeaders),
  }

  return axios.create(defaultOptions);
}

export default axiosWrapperCreateRequestInstance;
