"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _txMiningAxios = _interopRequireDefault(require("./txMiningAxios"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
   * @memberof ApiTxMining
   * @inner
   */
  submitJob(tx, propagate, add_parents, timeout, resolve) {
    const postData = {
      tx,
      propagate,
      add_parents
    };
    if (timeout) {
      postData.timeout = timeout;
    }
    return (0, _txMiningAxios.default)(resolve).post('submit-job', postData).then(res => {
      resolve(res.data);
    }, error => {
      return Promise.reject(error);
    });
  },
  /**
   * Get job status
   *
   * @param {String} job Job id
   *
   * @return {Promise}
   * @memberof ApiTxMining
   * @inner
   */
  getJobStatus(job, resolve) {
    const data = {
      'job-id': job
    };
    return (0, _txMiningAxios.default)(resolve).get('job-status', {
      params: data
    }).then(res => {
      resolve(res.data);
    }, error => {
      return Promise.reject(error);
    });
  },
  /**
   * Cancel a job
   *
   * @param {String} job Job id
   *
   * @return {Promise}
   * @memberof ApiTxMining
   * @inner
   */
  cancelJob(job, resolve) {
    const data = {
      'job-id': job
    };
    return (0, _txMiningAxios.default)(resolve).post('cancel-job', data).then(res => {
      resolve(res.data);
    }, error => {
      return Promise.reject(error);
    });
  },
  /**
   * Get health information for the tx-mining-service
   *
   * @return {Promise}
   * @memberof ApiTxMining
   * @inner
   */
  async getHealth() {
    return new Promise((resolve, reject) => {
      (0, _txMiningAxios.default)(resolve).get(`health`).then(res => {
        resolve(res.data);
      }, err => {
        reject(err);
      });
    });
  }
};
var _default = exports.default = txMiningApi;