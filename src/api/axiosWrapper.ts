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
 * @param url Base URL for the api requests
 * @param _resolve (UNUSED) Callback to be stored and used in case of a retry after a fail
 * @param timeout Timeout in milliseconds for the request
 * @param additionalHeaders Headers to be sent with the request
 */
export const axiosWrapperCreateRequestInstance = (
  url: string,
  _resolve?: undefined | null, // XXX: We should remove or use this parameter
  timeout?: number | null,
  additionalHeaders = {}
) => {
  let timeoutRef;
  const additionalHeadersObj = { ...additionalHeaders };
  if (timeout === undefined) {
    timeoutRef = TIMEOUT;
  }

  // Any application using the lib may set in the config object a user agent to be set in all requests
  const userAgent = config.getUserAgent();
  if (userAgent) {
    additionalHeadersObj['User-Agent'] = userAgent;
  }

  const defaultOptions: {
    baseURL: string;
    timeout?: number;
    headers: Record<string, string>;
  } = {
    baseURL: url,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeadersObj,
    },
  };
  if (timeoutRef) {
    defaultOptions.timeout = timeoutRef;
  }

  return axios.create(defaultOptions);
};

export default axiosWrapperCreateRequestInstance;
