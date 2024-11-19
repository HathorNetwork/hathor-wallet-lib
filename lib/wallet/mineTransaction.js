"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _events = require("events");
var _constants = require("../constants");
var _errors = require("../errors");
var _txMining = _interopRequireDefault(require("../api/txMining"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Error to be shown in case of no miners connected
const noMinersError = 'There are no miners to resolve the proof of work of this transaction.';

// Error to be shown in case of an unexpected error
const unexpectedError = 'An unexpected error happened. Please try to send your transaction again.';

// Error to be shown in case of a timeout
const timeoutError = "Timeout solving transaction's proof-of-work.\n\nAll transactions need to solve a proof-of-work as an anti spam mechanism. Currently, Hathor Labs provides this service for free, but their servers may be fully loaded right now.";

// Error to be shown in case of rate limit exceeded
const rateLimitExceededError = 'Too many transactions sent in a short time-span.\n\nAll transactions need to solve a proof-of-work as an anti spam mechanism. Currently, Hathor Labs provides a tx mining service for free, but there are limits to the number of transactions someone can mine using it to avoid abuse.\n\nPlease try again in a few seconds.';

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
 * */
class MineTransaction extends _events.EventEmitter {
  constructor(transaction, options = {
    maxTxMiningRetries: 3
  }) {
    super();
    // Transaction to be mined
    _defineProperty(this, "transaction", void 0);
    // Promise that will resolve when the mining is over or reject when an error is found
    _defineProperty(this, "promise", void 0);
    // Mining time estimation
    _defineProperty(this, "estimation", void 0);
    // Mining job ID
    _defineProperty(this, "jobID", void 0);
    // Current mining attempt
    _defineProperty(this, "countTxMiningAttempts", void 0);
    // Maximum number of mining retries
    _defineProperty(this, "maxTxMiningRetries", void 0);
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
    // TODO: If this promise is not handled properly we crash the client application with a
    //       misleading error message. This should be refactored to a more stable solution with
    //       better user experience
    this.promise = new Promise((resolve, reject) => {
      this.on('success', data => {
        resolve(data);
      });
      this.on('error', message => {
        const err = new _errors.MineTxError(message);
        reject(err);
      });
      this.on('unexpected-error', message => {
        const err = new _errors.MineTxError(message);
        reject(err);
      });
    });
  }

  /**
   * Used to handle errors in requests to the tx mining API
   *
   * @param error The error that was received from the axiosInstance
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- To fix this would require changing tests
  handleRequestError(error) {
    if (error.response && error.response.status === 429) {
      this.emit('error', rateLimitExceededError);
    } else {
      // eslint-disable-next-line no-console
      console.error(error);
      this.emit('unexpected-error', unexpectedError);
    }
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
    _txMining.default.submitJob(txHex, false, true, null, response => {
      if (response.expected_total_time === -1) {
        // Error: there are no miners online
        this.emit('error', noMinersError);
      } else {
        this.estimation = response.expected_total_time;
        this.jobID = response.job_id;
        this.emit('job-submitted', {
          estimation: this.estimation,
          jobID: this.jobID
        });
        this.handleJobStatus();
      }
    }).catch(e => {
      this.handleRequestError(e);
    });
  }

  /**
   * Schedule job status request
   * If the job is done, emits 'job-done' event, complete and send the tx
   * Otherwise, schedule again the job status request and emits 'estimation-updated' event.
   */
  handleJobStatus() {
    // this.estimation and MIN_POLLING_INTERVAL are in seconds
    const poll_time = Math.max(this.estimation / 2, _constants.MIN_POLLING_INTERVAL) * 1000;
    setTimeout(() => {
      _txMining.default.getJobStatus(this.jobID, response => {
        if (response.status === 'done') {
          this.emit('job-done', {
            jobID: this.jobID
          });
          this.emit('success', {
            nonce: parseInt(response.tx.nonce, 16),
            parents: response.tx.parents,
            timestamp: response.tx.timestamp,
            weight: response.tx.weight
          });
        } else if (response.status === 'timeout') {
          // Error: Timeout resolving pow
          if (this.countTxMiningAttempts < this.maxTxMiningRetries) {
            this.submitJob();
          } else {
            this.emit('error', timeoutError);
          }
        } else if (response.expected_total_time === -1) {
          // Error: there are no miners online
          this.emit('error', noMinersError);
        } else {
          this.estimation = response.expected_total_time;
          this.emit('estimation-updated', {
            jobID: this.jobID,
            estimation: response.expected_total_time
          });
          this.handleJobStatus();
        }
      }).catch(e => {
        this.handleRequestError(e);
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
var _default = exports.default = MineTransaction;