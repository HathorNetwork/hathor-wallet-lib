/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';

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
      // TODO: We should chage this to get `health` instead of `version`
      createRequestInstance(resolve).get(`version`).then((res) => {
        resolve(res.data);
      }, (err) => {
        reject(err);
      });
    });
  }
};

export default healthApi;
