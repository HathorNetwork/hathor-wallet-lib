/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import helpers from '../helpers';
import { TX_MINING_URL, TX_MINING_TESTNET_URL } from '../constants';
import axiosWrapperCreateRequestInstance from './axiosWrapper';
import networkInstance from '../network';

/**
 * Create axios instance settings base URL and content type  
 * Besides that, it captures error to show modal error and save in Redux
 *
 * @module Axios
 */

/**
 * Create an axios instance to be used when sending requests
 *
 * @param {callback} resolve Callback to be stored and used in case of a retry after a fail
 * @param {number} timeout Timeout in milliseconds for the request
 */
const txMiningRequestClient = (resolve, timeout) => {
  let txMiningURL;
  if (networkInstance.network === 'mainnet') {
    txMiningURL = TX_MINING_URL;
  } else {
    txMiningURL = TX_MINING_TESTNET_URL;
  }
  return axiosWrapperCreateRequestInstance(txMiningURL, resolve, timeout);
}

export default txMiningRequestClient;
