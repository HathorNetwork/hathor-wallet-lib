"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.registerNewCreateRequestInstance = exports.defaultCreateRequestInstance = exports.createRequestInstance = void 0;
var _config = _interopRequireDefault(require("../config"));
var _axiosWrapper = _interopRequireDefault(require("./axiosWrapper"));
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
 * @param {callback} resolve Callback to be stored and used in case of a retry after a fail
 * @param {number} timeout Timeout in milliseconds for the request
 */
const defaultCreateRequestInstance = (resolve, timeout) => {
  return (0, _axiosWrapper.default)(_config.default.getServerUrl(), resolve, timeout);
};
exports.defaultCreateRequestInstance = defaultCreateRequestInstance;
let _createRequestInstance = defaultCreateRequestInstance;
const registerNewCreateRequestInstance = fn => {
  _createRequestInstance = fn;
};
exports.registerNewCreateRequestInstance = registerNewCreateRequestInstance;
const createRequestInstance = (resolve, timeout) => {
  return _createRequestInstance(resolve, timeout);
};
exports.createRequestInstance = createRequestInstance;