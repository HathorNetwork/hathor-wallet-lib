'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createRequestInstance = exports.registerNewCreateRequestInstance = exports.defaultCreateRequestInstance = undefined;

var _helpers = require('../helpers');

var _helpers2 = _interopRequireDefault(_helpers);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _constants = require('../constants');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

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
var defaultCreateRequestInstance = exports.defaultCreateRequestInstance = function defaultCreateRequestInstance(resolve, timeout) {
  if (timeout === undefined) {
    timeout = _constants.TIMEOUT;
  }
  var defaultOptions = {
    baseURL: _helpers2.default.getServerURL(),
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return _axios2.default.create(defaultOptions);
}; /**
    * Copyright (c) Hathor Labs and its affiliates.
    *
    * This source code is licensed under the MIT license found in the
    * LICENSE file in the root directory of this source tree.
    */

var _createRequestInstance = defaultCreateRequestInstance;

var registerNewCreateRequestInstance = exports.registerNewCreateRequestInstance = function registerNewCreateRequestInstance(fn) {
  _createRequestInstance = fn;
};

var createRequestInstance = exports.createRequestInstance = function createRequestInstance(resolve, timeout) {
  return _createRequestInstance(resolve, timeout);
};