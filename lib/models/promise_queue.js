"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _events = _interopRequireDefault(require("events"));
var _priority_queue = _interopRequireDefault(require("./priority_queue"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _classPrivateMethodInitSpec(e, a) { _checkPrivateRedeclaration(e, a), a.add(e); }
function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
function _classPrivateGetter(s, r, a) { return a(_assertClassBrand(s, r)); }
function _classPrivateFieldGet(s, a) { return s.get(_assertClassBrand(s, a)); }
function _classPrivateFieldSet(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }
function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var _queue = /*#__PURE__*/new WeakMap();
var _jobsRunning = /*#__PURE__*/new WeakMap();
var _allowedConcurrentJobs = /*#__PURE__*/new WeakMap();
var _isPaused = /*#__PURE__*/new WeakMap();
var _intervalId = /*#__PURE__*/new WeakMap();
var _PromiseQueue_brand = /*#__PURE__*/new WeakSet();
/**
 * PromiseQueue is a task executor that allows a certain number of concurrent
 * tasks to run at any time.
 * When a task is added it returns a promise that resolves when the underlying task resolves.
 *
 * PromiseQueue is also an EventEmitter for the events:
 * - new_job: When a new job is added to the queue.
 * - finished_job: When a job is finished.
 * - next: When we try to start the next job.
 * - queue_empty: When the last job on queue start running.
 * - idle: When all jobs are done and there is no more jobs to run.
 * - job_start: When we start running a new job.
 */
class PromiseQueue extends _events.default {
  constructor() {
    super();
    /**
     * Try to start any jobs we can and set a timeout for the next interval.
     * Will stop the interval if the PromiseQueue is paused.
     */
    _classPrivateMethodInitSpec(this, _PromiseQueue_brand);
    _classPrivateFieldInitSpec(this, _queue, void 0);
    // Number of active jobs currently running.
    _classPrivateFieldInitSpec(this, _jobsRunning, void 0);
    _classPrivateFieldInitSpec(this, _allowedConcurrentJobs, 1);
    _classPrivateFieldInitSpec(this, _isPaused, false);
    _classPrivateFieldInitSpec(this, _intervalId, null);
    _classPrivateFieldSet(_queue, this, new _priority_queue.default());
    _classPrivateFieldSet(_jobsRunning, this, 0);
    _assertClassBrand(_PromiseQueue_brand, this, _startInterval).call(this);
  }
  /**
   * Check if the PromiseQueue is paused.
   */
  get isPaused() {
    return _classPrivateFieldGet(_isPaused, this);
  }

  /**
   * Pause or stop processing the tasks.
   * Does not stop any running tasks.
   */
  stop() {
    _classPrivateFieldSet(_isPaused, this, true);
    _assertClassBrand(_PromiseQueue_brand, this, _clearInterval).call(this);
  }

  /**
   * Unpause or continue processing tasks.
   */
  continue() {
    _classPrivateFieldSet(_isPaused, this, false);
    _assertClassBrand(_PromiseQueue_brand, this, _startInterval).call(this);
  }

  /**
   * Getter for how many jobs are currently running.
   */
  get jobsRunning() {
    return _classPrivateFieldGet(_jobsRunning, this);
  }

  /**
   * Called after a task is done, will try to start a new task.
   */

  /**
   * Getter for how many concurrent jobs can run.
   */
  get concurrent() {
    return _classPrivateFieldGet(_allowedConcurrentJobs, this);
  }

  /**
   * Setter for concurrent jobs.
   */
  set concurrent(value) {
    if (value < 1) {
      throw new Error('Cannot have less than 1 job running.');
    }
    _classPrivateFieldSet(_allowedConcurrentJobs, this, value);
  }

  /**
   * Check if we can start a new job and start it.
   */

  /**
   * When the signal emits an abort event we should reject with the same reason.
   */
  static async throwOnAbort(signal) {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason);
      }, {
        once: true
      });
    });
  }

  /**
   * Try to start jobs until the concurrency limit is reached.
   */
  processQueue() {
    // eslint-disable-next-line no-empty
    while (_assertClassBrand(_PromiseQueue_brand, this, _tryToStartNextJob).call(this)) {}
  }

  /**
   * Add a new task to the queue, the returned promise will resolve when the task resolves.
   * @param task The underlying job to run.
   * @param options.priority The task priority, the higher it is the sooner the task will run.
   * @param option.signal The `AbortSignal` that can be used to abort the task from the caller.
   */
  async add(task, options) {
    this.emit('new_job');
    return new Promise((resolve, reject) => {
      _classPrivateFieldGet(_queue, this).push(_priority_queue.default.makeNode(options?.priority || 0, async () => {
        var _this$jobsRunning3, _this$jobsRunning4;
        _classPrivateFieldSet(_jobsRunning, this, (_this$jobsRunning3 = _classPrivateFieldGet(_jobsRunning, this), _this$jobsRunning4 = _this$jobsRunning3++, _this$jobsRunning3)), _this$jobsRunning4;
        try {
          // Throw if the operation was aborted and don't run.
          options?.signal?.throwIfAborted();

          // Run the task until completion or until the task aborts.
          let operation = task({
            signal: options?.signal
          });
          // If a signal was passed, we may abort the operation from the outside.
          // This does not abort internally the task, it has to also manage the abort signal.
          if (options?.signal) {
            operation = Promise.race([operation, PromiseQueue.throwOnAbort(options.signal)]);
          }
          const result = await operation;
          resolve(result);
          // Completed task
        } catch (error) {
          reject(error);
        } finally {
          this.emit('finished_job');
          _assertClassBrand(_PromiseQueue_brand, this, _next).call(this);
        }
      }));
      // Try to start the job we enqueued and any other we can start
      this.processQueue();
    });
  }
}
exports.default = PromiseQueue;
function _startInterval() {
  this.processQueue();
  _classPrivateFieldSet(_intervalId, this, setTimeout(() => {
    if (_classPrivateFieldGet(_isPaused, this)) {
      _assertClassBrand(_PromiseQueue_brand, this, _clearInterval).call(this);
      return;
    }
    _assertClassBrand(_PromiseQueue_brand, this, _startInterval).call(this);
  }, 1000));
}
/**
 * If there is an interval scheduled to run, stop and clear internal state.
 */
function _clearInterval() {
  if (_classPrivateFieldGet(_intervalId, this)) {
    clearInterval(_classPrivateFieldGet(_intervalId, this));
    _classPrivateFieldSet(_intervalId, this, null);
  }
}
function _next() {
  var _this$jobsRunning, _this$jobsRunning2;
  this.emit('next');
  _classPrivateFieldSet(_jobsRunning, this, (_this$jobsRunning = _classPrivateFieldGet(_jobsRunning, this), _this$jobsRunning2 = _this$jobsRunning--, _this$jobsRunning)), _this$jobsRunning2;
  _assertClassBrand(_PromiseQueue_brand, this, _tryToStartNextJob).call(this);
}
/**
 * Whether we can start a new job.
 */
function _get_canStartJob(_this) {
  return _classPrivateFieldGet(_jobsRunning, _this) < _this.concurrent;
}
function _tryToStartNextJob() {
  if (_classPrivateFieldGet(_isPaused, this)) {
    return false;
  }
  if (_classPrivateFieldGet(_queue, this).isEmpty()) {
    // No more tasks to run
    this.emit('queue_empty');
    if (_classPrivateFieldGet(_jobsRunning, this) === 0) {
      this.emit('idle');
    }
    return false;
  }
  if (_classPrivateGetter(_PromiseQueue_brand, this, _get_canStartJob)) {
    const job = _classPrivateFieldGet(_queue, this).pop();
    if (!job) {
      // Should never happen, but treating for typing
      return false;
    }
    this.emit('job_start');
    job();
    return true;
  }
  return false;
}