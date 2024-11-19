"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
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
class Queue {
  constructor() {
    _defineProperty(this, "head", void 0);
    _defineProperty(this, "last", void 0);
    _defineProperty(this, "length", void 0);
    this.length = 0;
  }

  /**
   * Add to the queue.
   * @param {T} value An item to enqueue
   */
  enqueue(value) {
    const node = {
      value,
      next: undefined
    };
    if (this.head) {
      if (this.last === undefined || this.last.next !== undefined) {
        // This shouldn't happen
        throw new Error('Queue: last element in bad state');
      }
      this.last.next = node;
    } else {
      this.head = node;
    }
    this.last = node;
    this.length++;
  }

  /**
   * Remove the first item and return it.
   * @returns {T|undefined} The first element on the queue if there is any.
   */
  dequeue() {
    if (!this.head) {
      return undefined;
    }
    const first = this.head.value;
    this.head = this.head.next;
    this.length--;
    return first;
  }

  /**
   * Peek the first element on queue without dequeuing.
   * @returns {T|undefined} The first element on queue if there is any.
   */
  peek() {
    return this.head?.value;
  }

  /**
   * Get the size of the current queue
   * @returns {number} The size of the current queue
   */
  size() {
    return this.length;
  }
}
exports.default = Queue;