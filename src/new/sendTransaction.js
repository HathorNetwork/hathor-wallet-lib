/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import { MIN_POLLING_INTERVAL } from '../constants';
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
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'send-success': after push tx succeeds;
 * 'send-error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 **/
class SendTransaction extends EventEmitter {
  /*
   * data {Object} Prepared tx data
   */
  constructor({
    data=null,
  } = {}) {
    super();

    this.data = data;
    // Job estimation
    this.estimation = null;
    // Job ID
    this.jobID = null;

    // Error to be shown in case of no miners connected
    this.noMinersError = 'There are no miners to resolve the proof of work of this transaction.';

    // Error to be shown in case of an unexpected error
    this.unexpectedError = 'An unexpected error happened. Please try to send your transaction again.';

    // Error to be shown in case of an unexpected error when executing push tx
    this.unexpectedPushTxError = 'An unexpected error happened. Check if the transaction has been sent looking into the history and try again if it hasn\'t.';

    // Error to be shown in case of a timeout
    this.timeoutError = 'Timeout solving transaction\'s proof-of-work.\n\nAll transactions need to solve a proof-of-work as an anti spam mechanism. Currently, Hathor Labs provides this service for free, but their servers may be fully loaded right now.';

    // Promise that resolves when push tx finishes with success
    // or rejects in case of an error
    this.promise = new Promise((resolve, reject) => {
      this.on('send-success', (tx) => {
        resolve(tx);
      });

      this.on('send-error', (message) => {
        reject(message);
      });

      this.on('unexpected-error', (message) => {
        reject(message);
      });
    });
  }

  /**
   * Submit job to be mined, update object variables of jobID and estimation, and start method to get job status
   * Emits 'job-submitted' after submit.
   */
  submitJob() {
    // Get tx hex without parents and nonce
    const txHex = transaction.getTxHexFromData(this.data);
    // Send to be mined in tx mining API
    txMiningApi.submitJob(txHex, false, true, null, (response) => {
      if (response.expected_total_time === -1) {
        // Error: there are no miners online
        this.emit('send-error', this.noMinersError);
      } else {
        this.estimation = response.expected_total_time;
        this.jobID = response.job_id;
        this.emit('job-submitted', {estimation: this.estimation, jobID: this.jobID});
        this.handleJobStatus();
      }
    }).catch((e) => {
      this.emit('unexpected-error', this.unexpectedError);
    });
  }

  /**
   * Schedule job status request
   * If the job is done, emits 'job-done' event, complete and send the tx
   * Otherwise, schedule again the job status request and emits 'estimation-updated' event.
   */
  handleJobStatus() {
    // this.estimation and MIN_POLLING_INTERVAL are in seconds
    const poll_time = Math.max(this.estimation / 2, MIN_POLLING_INTERVAL)*1000;

    setTimeout(() => {
      txMiningApi.getJobStatus(this.jobID, (response) => {
        if (response.status === 'done') {
          this.data.nonce = parseInt(response.tx.nonce, 16);
          this.data.parents = response.tx.parents;
          this.data.timestamp = response.tx.timestamp;
          this.emit('job-done', {jobID: this.jobID});
          this.handlePushTx();
        } else if (response.status === 'timeout') {
          // Error: Timeout resolving pow
          this.emit('send-error', this.timeoutError);
        } else {
          if (response.expected_total_time === -1) {
            // Error: there are no miners online
            this.emit('send-error', this.noMinersError);
          } else {
            this.estimation = response.expected_total_time;
            this.emit('estimation-updated', {jobID: this.jobID, estimation: response.expected_total_time});
            this.handleJobStatus();
          }
        }
      }).catch((e) => {
        this.emit('unexpected-error', this.unexpectedError);
      });
    }, poll_time);
  }

  /**
   * Push tx to the network
   * If success, emits 'send-success' event, otherwise emits 'send-error' event.
   */
  handlePushTx() {
    const txHex = transaction.getTxHexFromData(this.data);
    txApi.pushTx(txHex, false, (response) => {
      if (response.success) {
        this.emit('send-success', response.tx);
      } else {
        this.emit('send-error', response.message);
      }
    }).catch(() => {
      this.emit('send-error', this.unexpectedPushTxError);
    });;
  }

  /**
   * Start object (submit job)
   */
  start() {
    this.submitJob();
  }
}

export default SendTransaction;