/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import { MIN_POLL } from '../constants';
import transaction from '../transaction';
import txApi from '../api/txApi';
import txMiningApi from '../api/txMining';
import { AddressError, OutputValueError, ConstantNotSet, MaximumNumberOutputsError, MaximumNumberInputsError } from '../errors';

/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 * - Push tx to the network;
 **/
class SendTransaction extends EventEmitter {
  /*
   * data {Object} Tx data
   */
  constructor({
    data=null,
  } = {}) {
    super();

    this.data = data;
    this.estimation = null;
    this.jobID = null;
  }

  submitJob() {
    // Get tx hex without parents and nonce
    const txHex = transaction.getTxHexFromData(this.data);
    // Send to be mined in tx mining API
    txMiningApi.submitJob(txHex, false, true, (response) => {
      this.estimation = response.expected_total_time;
      this.jobID = response.job_id;
      this.emit('job-submitted', {estimation: this.estimation, jobID: this.jobID});
      this.handleJobStatus();
    });
  }

  handleJobStatus() {
    // this.estimation and MIN_POLL are in seconds
    const poll_time = Math.max(this.estimation / 2, MIN_POLL)*1000;

    setTimeout(() => {
      txMiningApi.getJobStatus(this.jobID, (response) => {
        if (response.status === 'done') {
          this.data.nonce = response.nonce;
          this.data.parents = response.parents;
          this.emit('job-done', {jobID: this.jobID});
          this.handlePushTx();
        } else {
          this.estimation = response.expected_total_time;
          this.emit('estimation-updated', {estimation: response.expected_total_time});
          this.handleJobStatus();
        }
      });
    }, poll_time);
  }

  handlePushTx() {
    const txHex = transaction.getTxHexFromData(this.data);
    txApi.pushTx(txHex, false, (response) => {
      this.emit('tx-sent', response);
    });
  }

  handleSendError(e) {
    if (e instanceof AddressError ||
        e instanceof OutputValueError ||
        e instanceof ConstantNotSet ||
        e instanceof MaximumNumberOutputsError ||
        e instanceof MaximumNumberInputsError) {
      this.emit('prepare-error', e);
    } else {
      // Unhandled error
      throw e;
    }
  }

  start() {
    this.submitJob();
  }
}

export default SendTransaction;