/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import txMiningRequestClient from './txMiningAxios';

/**
 * Api calls for tx mining
 *
 * @namespace ApiTxMining
 */

const txMiningApi = {
  /**
   * Submit tx to be mined
   *
   * @param {String} tx data in hexadecimal
   *
   * @return {Promise}
   * @memberof txMiningApi
   * @inner
   */
  submitJob(tx, propagate, add_parents, resolve) {
    const postData = {tx, propagate, add_parents};
    return txMiningRequestClient(resolve).post('submit-job', postData).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },

  /**
   * Get job status
   *
   * @param {String} job Job id
   *
   * @return {Promise}
   * @memberof txMiningApi
   * @inner
   */
  getJobStatus(job, resolve) {
    const data = {'job-id': job};
    return txMiningRequestClient(resolve).get('job-status', {'params': data}).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },
};

export default txMiningApi;