/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

type QueueNode<T> = {
  value: T,
  next?: QueueNode<T>;
};

/**
 * This is a simple queue using an underlying linked list for O(1) enqueue and dequeue operations.
 * 
 * @template [T=Object]
 */
export default class Queue<T=Object> {
  private head?: QueueNode<T>;
  private last?: QueueNode<T>;
  constructor() {
    this.head;
    this.last;
  }

  /**
   * Add to the queue.
   * @param {T} value An item to enqueue
   */
  enqueue(value: T) {
    const node: QueueNode<T> = { value, next: undefined };
    if (this.head) {
      if (this.last === undefined) {
        // This shouldn't happen
        throw new Error('Queue: queue has a start but no end');
      }
      this.last.next = node;
    } else {
      this.head = node;
    }
    this.last = node;
  }

  /**
   * Remove the first item and return it.
   * @returns {T|undefined} The first element on the queue if there is any.
   */
  dequeue(): T|undefined {
    if (this.head) {
      const first: T = this.head.value;
      this.head = this.head.next;
      return first;
    }
  }

  /**
   * Peek the first element on queue without dequeuing.
   * @returns {T|undefined} The first element on queue if there is any.
   */
  peek(): T|undefined {
    return this.head?.value;
  }
}