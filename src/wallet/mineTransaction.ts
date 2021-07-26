/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { MIN_POLLING_INTERVAL } from '../constants';
import Transaction from '../models/transaction';
import txMiningApi from '../api/txMining';

// Error to be shown in case of no miners connected
const noMinersError = 'There are no miners to resolve the proof of work of this transaction.';

// Error to be shown in case of an unexpected error
const unexpectedError = 'An unexpected error happened. Please try to send your transaction again.';

// Error to be shown in case of a timeout
const timeoutError = 'Timeout solving transaction\'s proof-of-work.\n\nAll transactions need to solve a proof-of-work as an anti spam mechanism. Currently, Hathor Labs provides this service for free, but their servers may be fully loaded right now.';

type promiseReturnType = {
  nonce: number,
  weight: number,
  timestamp: number,
  parents: string[],
};

/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 **/
class MineTransaction extends EventEmitter {
  // Transaction to be mined
  transaction: Transaction;
  // Promise that will resolve when the mining is over or reject when an error is found
  promise: Promise<promiseReturnType>;
  // Mining time estimation
  private estimation: number | null;
  // Mining job ID
  private jobID: string | null;
  // Current mining attempt
  private countTxMiningAttempts: number;
  // Maximum number of mining retries
  private maxTxMiningRetries: number;
  constructor(transaction: Transaction, options = { maxTxMiningRetries: 3 }) {
    super();

    this.transaction = transaction;
    // Job estimation
    this.estimation = null;
    // Job ID
    this.jobID = null;

    // Counter of number of attempts to mine the transaction.
    this.countTxMiningAttempts = 0;
    // Maximum number of retries if mining timeouts.
    this.maxTxMiningRetries = options.maxTxMiningRetries;

    // Promise that resolves when push tx finishes with success
    // or rejects in case of an error
    this.promise = new Promise((resolve, reject) => {
      this.on('success', (data) => {
        resolve(data);
      });

      this.on('error', (message) => {
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
    const txHex = this.transaction.toHex();
    this.countTxMiningAttempts++;
    // Send to be mined in tx mining API
    txMiningApi.submitJob(txHex, false, true, null, (response) => {
      if (response.expected_total_time === -1) {
        // Error: there are no miners online
        this.emit('error', noMinersError);
      } else {
        this.estimation = response.expected_total_time;
        this.jobID = response.job_id;
        this.emit('job-submitted', {estimation: this.estimation!, jobID: this.jobID});
        this.handleJobStatus();
      }
    }).catch((e) => {
      this.emit('unexpected-error', unexpectedError);
    });
  }

  /**
   * Schedule job status request
   * If the job is done, emits 'job-done' event, complete and send the tx
   * Otherwise, schedule again the job status request and emits 'estimation-updated' event.
   */
  handleJobStatus() {
    // this.estimation and MIN_POLLING_INTERVAL are in seconds
    const poll_time = Math.max(this.estimation! / 2, MIN_POLLING_INTERVAL)*1000;

    setTimeout(() => {
      txMiningApi.getJobStatus(this.jobID, (response) => {
        if (response.status === 'done') {
          this.emit('job-done', {jobID: this.jobID});
          this.emit('success', {
            nonce: parseInt(response.tx.nonce, 16),
            parents: response.tx.parents,
            timestamp: response.tx.timestamp,
            weight: response.tx.weight
          });
        } else if (response.status === 'timeout') {
          // Error: Timeout resolving pow
          if (this.countTxMiningAttempts < this.maxTxMiningRetries) {
            this.submitJob()
          } else {
            this.emit('error', timeoutError);
          }
        } else {
          if (response.expected_total_time === -1) {
            // Error: there are no miners online
            this.emit('error', noMinersError);
          } else {
            this.estimation = response.expected_total_time;
            this.emit('estimation-updated', {jobID: this.jobID, estimation: response.expected_total_time});
            this.handleJobStatus();
          }
        }
      }).catch((e) => {
        this.emit('unexpected-error', unexpectedError);
      });
    }, poll_time);
  }

  /**
   * Start object (submit job)
   */
  start() {
    this.emit('mining-started');
    this.submitJob();
  }
}

export default MineTransaction;
