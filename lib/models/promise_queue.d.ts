/// <reference types="node" />
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import EventEmitter from 'events';
type TaskOptions = {
    signal?: AbortSignal;
};
type Task<TaskResultType> = ((options?: TaskOptions) => PromiseLike<TaskResultType>) | ((options?: TaskOptions) => TaskResultType);
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
    #private;
    constructor();
    /**
     * Check if the PromiseQueue is paused.
     */
    get isPaused(): boolean;
    /**
     * Pause or stop processing the tasks.
     * Does not stop any running tasks.
     */
    stop(): void;
    /**
     * Unpause or continue processing tasks.
     */
    continue(): void;
    /**
     * Getter for how many jobs are currently running.
     */
    get jobsRunning(): number;
    /**
     * Getter for how many concurrent jobs can run.
     */
    get concurrent(): number;
    /**
     * Setter for concurrent jobs.
     */
    set concurrent(value: number);
    /**
     * When the signal emits an abort event we should reject with the same reason.
     */
    static throwOnAbort(signal: AbortSignal): Promise<never>;
    /**
     * Try to start jobs until the concurrency limit is reached.
     */
    processQueue(): void;
    /**
     * Add a new task to the queue, the returned promise will resolve when the task resolves.
     * @param task The underlying job to run.
     * @param options.priority The task priority, the higher it is the sooner the task will run.
     * @param option.signal The `AbortSignal` that can be used to abort the task from the caller.
     */
    add<TaskResultType>(task: Task<TaskResultType>, options?: AddTaskOptions): Promise<unknown>;
}
export {};
//# sourceMappingURL=promise_queue.d.ts.map