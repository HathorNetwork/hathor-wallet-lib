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
   * @param {String} tx Data in hexadecimal
   * @param {boolean} propagate If should propagate tx after the job is completed
   * @param {boolean} add_parents If should return the parents
   * @param {Number} timeout Optional parameter to define the timeout of the submit job in seconds
   *
   * @return {Promise}
   * @memberof txMiningApi
   * @inner
   */
  submitJob(tx, propagate, add_parents, timeout, resolve) {
    let postData = {tx, propagate, add_parents};
    if (timeout) {
      postData.timeout = timeout;
    }
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

  /**
   * Cancel a job
   *
   * @param {String} job Job id
   *
   * @return {Promise}
   * @memberof txMiningApi
   * @inner
   */
  cancelJob(job, resolve) {
    const data = {'job-id': job};
    return txMiningRequestClient(resolve).post('cancel-job', data).then((res) => {
      resolve(res.data)
    }, (res) => {
      return Promise.reject(res);
    });
  },
};

export default txMiningApi;