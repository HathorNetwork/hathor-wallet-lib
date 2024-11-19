"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.axiosInstance = void 0;
var _axiosWrapper = _interopRequireDefault(require("./axiosWrapper"));
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
 * Create an axios instance to be used when sending requests to the explorer service
 *
 * @param {string} network The network to access the explorer service
 * @param {number} timeout Timeout in milliseconds for the request
 */
const axiosInstance = async (network, timeout = _constants.TIMEOUT) => {
  const baseURL = _config.default.getExplorerServiceBaseUrl(network);
  return (0, _axiosWrapper.default)(baseURL, undefined, timeout);
};
exports.axiosInstance = axiosInstance;
var _default = exports.default = axiosInstance;