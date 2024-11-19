"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _axiosInstance = require("./axiosInstance");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Api calls for version
 *
 * @namespace ApiVersion
 */

const versionApi = {
  /**
   * Get version of full node running in connected server
   *
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiVersion
   * @inner
   */
  getVersion(resolve) {
    return (0, _axiosInstance.createRequestInstance)(resolve).get(`version`).then(res => {
      resolve(res.data);
    }, res => {
      return Promise.reject(res);
    });
  },
  /**
   * Get version of full node running in connected server
   *
   * @return {Promise}
   * @memberof ApiVersion
   * @inner
   */
  async asyncGetVersion() {
    return new Promise((resolve, reject) => {
      (0, _axiosInstance.createRequestInstance)(resolve).get(`version`).then(res => {
        resolve(res.data);
      }, err => {
        reject(err);
      });
    });
  }
};
var _default = exports.default = versionApi;