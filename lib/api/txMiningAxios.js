"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _axiosWrapper = _interopRequireDefault(require("./axiosWrapper"));
var _config = _interopRequireDefault(require("../config"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
const txMiningRequestClient = (resolve, timeout) => {
  const txMiningURL = _config.default.getTxMiningUrl();
  const txMiningApiKey = _config.default.getTxMiningApiKey();
  const headers = {};
  if (txMiningApiKey) {
    headers.apikey = txMiningApiKey;
  }
  return (0, _axiosWrapper.default)(txMiningURL, resolve, timeout, headers);
};
var _default = exports.default = txMiningRequestClient;