'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _axiosInstance = require('./axiosInstance');

/**
 * Api calls for version
 *
 * @namespace ApiVersion
 */

var versionApi = {
  /**
   * Get version of full node running in connected server
   *
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiVersion
   * @inner
   */
  getVersion: function getVersion(resolve) {
    return (0, _axiosInstance.createRequestInstance)(resolve).get('version').then(function (res) {
      resolve(res.data);
    }, function (res) {
      return Promise.reject(res);
    });
  }
}; /**
    * Copyright (c) Hathor Labs and its affiliates.
    *
    * This source code is licensed under the MIT license found in the
    * LICENSE file in the root directory of this source tree.
    */

exports.default = versionApi;