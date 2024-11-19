/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * This is a simple queue using an underlying linked list for O(1) enqueue and dequeue operations.
 *
 * @template [T=Object]
 */
export default class Queue<T = unknown> {
    private head?;
    private last?;
    private length;
    constructor();
    /**
     * Add to the queue.
     * @param {T} value An item to enqueue
     */
    enqueue(value: T): void;
    /**
     * Remove the first item and return it.
     * @returns {T|undefined} The first element on the queue if there is any.
     */
    dequeue(): T | undefined;
    /**
     * Peek the first element on queue without dequeuing.
     * @returns {T|undefined} The first element on queue if there is any.
     */
    peek(): T | undefined;
    /**
     * Get the size of the current queue
     * @returns {number} The size of the current queue
     */
    size(): number;
}
//# sourceMappingURL=queue.d.ts.map