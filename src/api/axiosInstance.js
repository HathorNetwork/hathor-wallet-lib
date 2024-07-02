/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import config from '../config';
import axiosWrapperCreateRequestInstance from './axiosWrapper';

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
export const defaultCreateRequestInstance = (resolve, timeout) => {
  return axiosWrapperCreateRequestInstance(config.getServerUrl(), resolve, timeout);
};

let _createRequestInstance = defaultCreateRequestInstance;

export const registerNewCreateRequestInstance = fn => {
  _createRequestInstance = fn;
};

export const createRequestInstance = (resolve, timeout) => {
  return _createRequestInstance(resolve, timeout);
};
