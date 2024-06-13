/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axiosWrapperCreateRequestInstance from './axiosWrapper';
import config from '../config';

/**
 * Create axios instance settings base URL and content type
 * Besides that, it captures error to show modal error and save in Redux
 *
 * @module Axios
 */

/**
 * Create an axios instance to be used when sending requests
 *
 * @param {Function | null} resolve Callback to be stored and used in case of a retry after a fail
 * @param {number | null | undefined} [timeout] Timeout in milliseconds for the request
 */
const txMiningRequestClient = (resolve: Function | null, timeout?: number | null) => {
  const txMiningURL = config.getTxMiningUrl();
  const txMiningApiKey = config.getTxMiningApiKey();

  const headers = {};

  if (txMiningApiKey) {
    headers['apikey'] = txMiningApiKey;
  }

  return axiosWrapperCreateRequestInstance(txMiningURL, resolve, timeout, headers);
};

export default txMiningRequestClient;
