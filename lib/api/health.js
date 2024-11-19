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
 * Api calls for healthcheck
 *
 * @namespace ApiHealth
 */

const healthApi = {
  /**
   * Get health information of full node running in connected server
   *
   * @return {Promise}
   * @memberof ApiHealth
   * @inner
   */
  async getHealth() {
    return new Promise((resolve, reject) => {
      (0, _axiosInstance.createRequestInstance)(resolve).get(`health`).then(res => {
        resolve(res.data);
      }, err => {
        reject(err);
      });
    });
  }
};
var _default = exports.default = healthApi;