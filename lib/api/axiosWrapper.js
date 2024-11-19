"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.axiosWrapperCreateRequestInstance = void 0;
var _axios = _interopRequireDefault(require("axios"));
var _constants = require("../constants");
var _config = _interopRequireDefault(require("../config"));
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
 * @param url Base URL for the api requests
 * @param _resolve (UNUSED) Callback to be stored and used in case of a retry after a fail
 * @param timeout Timeout in milliseconds for the request
 * @param additionalHeaders Headers to be sent with the request
 */
const axiosWrapperCreateRequestInstance = (url, _resolve, timeout, additionalHeaders = {}) => {
  let timeoutRef;
  const additionalHeadersObj = {
    ...additionalHeaders
  };
  if (timeout === undefined) {
    timeoutRef = _constants.TIMEOUT;
  }

  // Any application using the lib may set in the config object a user agent to be set in all requests
  const userAgent = _config.default.getUserAgent();
  if (userAgent) {
    additionalHeadersObj['User-Agent'] = userAgent;
  }
  const defaultOptions = {
    baseURL: url,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeadersObj
    }
  };
  if (timeoutRef) {
    defaultOptions.timeout = timeoutRef;
  }
  return _axios.default.create(defaultOptions);
};
exports.axiosWrapperCreateRequestInstance = axiosWrapperCreateRequestInstance;
var _default = exports.default = axiosWrapperCreateRequestInstance;