"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.axiosInstance = void 0;
var _axios = _interopRequireDefault(require("axios"));
var _constants = require("../../constants");
var _config = _interopRequireDefault(require("../../config"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
const axiosInstance = async (wallet, needsAuth, timeout = _constants.TIMEOUT) => {
  // TODO How to allow 'Retry' request?
  const defaultOptions = {
    baseURL: _config.default.getWalletServiceBaseUrl(),
    timeout,
    // `validateStatus` defines whether to resolve or reject the promise for a given
    // HTTP response status code. If `validateStatus` returns `true` (or is set to `null`
    // or `undefined`), the promise will be resolved; otherwise, the promise will be
    // rejected. The default behaviour of axios is to reject anything different than 2xx
    // We need to handle some 400 manually (e.g. create wallet might already be loaded)
    validateStatus: status => status >= 200 && status < 500,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  if (needsAuth) {
    // Then we need the auth token
    await wallet.validateAndRenewAuthToken();
    defaultOptions.headers.Authorization = `Bearer ${wallet.getAuthToken()}`;
  }
  return _axios.default.create(defaultOptions);
};
exports.axiosInstance = axiosInstance;
var _default = exports.default = axiosInstance;