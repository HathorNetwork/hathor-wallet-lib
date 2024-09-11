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

export default class PromiseQueue extends EventEmitter {
  #queue: PriorityQueue<() => Promise<void>>;

  // Number of active jobs currently running.
  #jobsRunning: number;

  #allowedConcurrentJobs: number = 1;

  #isPaused = false;

  #intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.#queue = new PriorityQueue<() => Promise<void>>();
    this.#jobsRunning = 0;
    this.#startInterval();
  }

  #startInterval() {
    this.#clearInterval();
    this.#intervalId = setInterval(() => {
      this.processQueue();
    }, 1000);
  }

  #clearInterval() {
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  }

  get isPaused() {
    return this.#isPaused;
  }

  stop() {
    this.#isPaused = true;
    this.#clearInterval();
  }

  continue() {
    this.#isPaused = false;
    this.processQueue();
    this.#startInterval();
  }

  #next() {
    this.emit('next');
    this.#jobsRunning--;
    this.#tryToStartNextJob();
  }

  get #canStartJob() {
    return this.#jobsRunning < this.concurrent;
  }

  get concurrent() {
    return this.#allowedConcurrentJobs;
  }

  set concurrent(value) {
    if (value < 1) {
      throw new Error('Cannot have less than 1 job running.');
    }
    this.#allowedConcurrentJobs = value;
  }

  #tryToStartNextJob(): boolean {
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
    });
  }
}
