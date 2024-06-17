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
 * @param resolve (UNUSED) Callback to be stored and used in case of a retry after a fail
 * @param timeout Timeout in milliseconds for the request
 */
const txMiningRequestClient = (resolve: undefined | null, timeout?: number | null) => {
  const txMiningURL = config.getTxMiningUrl();
  const txMiningApiKey = config.getTxMiningApiKey();

  const headers: { apikey?: string } = {};

  if (txMiningApiKey) {
    headers.apikey = txMiningApiKey;
  }

  return axiosWrapperCreateRequestInstance(txMiningURL, resolve, timeout, headers);
};

export default txMiningRequestClient;
