/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import EventEmitter from 'events';
import PriorityQueue from './priority_queue';

type TaskOptions = { signal?: AbortSignal };

type Task<TaskResultType> =
  | ((options?: TaskOptions) => PromiseLike<TaskResultType>)
  | ((options?: TaskOptions) => TaskResultType);

type AddTaskOptions = {
  priority?: number;
  signal?: AbortSignal;
};

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
export default class PromiseQueue extends EventEmitter {
  #queue: PriorityQueue<() => Promise<void>>;

  // Number of active jobs currently running.
  #jobsRunning: number;

  #allowedConcurrentJobs: number = 1;

  #isPaused = false;

  #intervalId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.#queue = new PriorityQueue<() => Promise<void>>();
    this.#jobsRunning = 0;
    this.#startInterval();
  }

  /**
   * Try to start any jobs we can and set a timeout for the next interval.
   * Will stop the interval if the PromiseQueue is paused.
   */
  #startInterval() {
    this.processQueue();
    this.#intervalId = setTimeout(() => {
      if (this.#isPaused) {
        this.#clearInterval();
        return;
      }
      this.#startInterval();
    }, 1000);
  }

  /**
   * If there is an interval scheduled to run, stop and clear internal state.
   */
  #clearInterval() {
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  }

  /**
   * Check idf the PromiseQueue is paused.
   */
  public get isPaused() {
    return this.#isPaused;
  }

  /**
   * Pause or stop processing the tasks.
   * Does not stop any running tasks.
   */
  public stop() {
    this.#isPaused = true;
    this.#clearInterval();
  }

  /**
   * Unpause or continue processing tasks.
   */
  public continue() {
    this.#isPaused = false;
    this.#startInterval();
  }

  /**
   * Getter for how many jobs are currently running.
   */
  public get jobsRunning() {
    return this.#jobsRunning;
  }

  /**
   * Called after a task is done, will try to start a new task.
   */
  #next() {
    this.emit('next');
    this.#jobsRunning--;
    this.#tryToStartNextJob();
  }

  /**
   * Whether we can start a new job.
   */
  get #canStartJob() {
    return this.#jobsRunning < this.concurrent;
  }

  /**
   * Getter for how many concurrent jobs can run.
   */
  public get concurrent() {
    return this.#allowedConcurrentJobs;
  }

  /**
   * Setter for concurrent jobs.
   */
  public set concurrent(value) {
    if (value < 1) {
      throw new Error('Cannot have less than 1 job running.');
    }
    this.#allowedConcurrentJobs = value;
  }

  /**
   * Check if we can start a new job and start it.
   */
  #tryToStartNextJob(): boolean {
    if (this.#isPaused) {
      return false;
    }
    if (this.#queue.isEmpty()) {
      // No more tasks to run
      this.emit('queue_empty');
      if (this.#jobsRunning === 0) {
        this.emit('idle');
      }
      return false;
    }

    if (this.#canStartJob) {
      const job = this.#queue.pop();
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

  /**
   * When the signal emits an abort event we should reject with the same reason.
   */
  static async throwOnAbort(signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(signal.reason);
        },
        { once: true }
      );
    });
  }

  /**
   * Try to start jobs until the concurrency limit is reached.
   */
  processQueue(): void {
    // eslint-disable-next-line no-empty
    while (this.#tryToStartNextJob()) {}
  }

  /**
   * Add a new task to the queue, the returned promise will resolve when the task resolves.
   * @param task The underlying job to run.
   * @param options.priority The task priority, the higher it is the sooner the task will run.
   * @param option.signal The `AbortSignal` that can be used to abort the task from the caller.
   */
  async add<TaskResultType>(task: Task<TaskResultType>, options?: AddTaskOptions) {
    this.emit('new_job');
    return new Promise((resolve, reject) => {
      this.#queue.push(
        PriorityQueue.makeNode(options?.priority || 0, async () => {
          this.#jobsRunning++;
          try {
            // Throw if the operation was aborted and don't run.
            options?.signal?.throwIfAborted();

            // Run the task until completion or until the task aborts.
            let operation = task({ signal: options?.signal });
            // If a signal was passed, we may abort the operation from the outside.
            // This does not abort internally the task, it has to also manage the abort signal.
            if (options?.signal) {
              operation = Promise.race([operation, PromiseQueue.throwOnAbort(options.signal)]);
            }
            const result = await operation;
            resolve(result);
            // Completed task
          } catch (error: unknown) {
            reject(error);
          } finally {
            this.emit('finished_job');
            this.#next();
          }
        })
      );
      // Try to start the job we enqueued and any other we can start
      this.processQueue();
    });
  }
}
