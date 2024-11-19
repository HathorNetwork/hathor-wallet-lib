"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
function _classPrivateFieldGet(s, a) { return s.get(_assertClassBrand(s, a)); }
function _classPrivateFieldSet(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }
function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); }
var _heap = /*#__PURE__*/new WeakMap();
var _top = /*#__PURE__*/new WeakMap();
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["parent", "left", "right", "comparator"] }] */

/**
 * Priority queue implementation using an underlying heap for performance.
 * @example
 * const prioQ = new PriorityQueue<string>();
 * prioQ.push(prioQ.makeNode(0, 'lower prio'));
 * prioQ.push(prioQ.makeNode(10, 'higher prio'));
 * prioQ.push(prioQ.makeNode(5, 'medium prio'));
 * // Returns 'higher prio'
 * prioQ.pop()
 * // Returns 'medium prio'
 * prioQ.pop()
 * // Returns 'lower prio'
 * prioQ.pop()
 *
 * @template [T=unknown]
 */
class PriorityQueue {
  constructor() {
    _classPrivateFieldInitSpec(this, _heap, void 0);
    _classPrivateFieldInitSpec(this, _top, void 0);
    _classPrivateFieldSet(_heap, this, []);
    _classPrivateFieldSet(_top, this, 0);
  }

  /**
   * Utility to create a node from a value and priority.
   * @example
   * // returns { value: 'foobar', 'priority': 10 }
   * prioQueue.makeNode(10, 'foobar');
   */
  static makeNode(priority, value) {
    return {
      value,
      priority
    };
  }

  /**
   * Get the number of elements on the priority queue.
   */
  get size() {
    return _classPrivateFieldGet(_heap, this).length;
  }

  /**
   * Check if the priority queue is empty
   */
  isEmpty() {
    return this.size === 0;
  }

  /**
   * Get the top value of the queue without removing it from the queue.
   */
  peek() {
    if (this.size === 0) {
      // Heap is empty
      return undefined;
    }
    return _classPrivateFieldGet(_heap, this)[_classPrivateFieldGet(_top, this)].value;
  }

  /**
   * Add a node to the priority queue and maintain the priority order.
   */
  push(value) {
    _classPrivateFieldGet(_heap, this).push(value);
    this._siftUp();
  }

  /**
   * Add multiple values to the priority queue while maintaining the priority order.
   */
  add(...nodes) {
    nodes.forEach(node => {
      this.push(node);
    });
    return this.size;
  }

  /**
   * Get the node with highest priority and remove it from the priority queue.
   */
  pop() {
    if (this.isEmpty()) {
      // Queue is empty
      return undefined;
    }
    // This may be undefined if the queue is empty, but we already checked for that.
    const poppedValue = this.peek();
    const bottom = this.size - 1;
    if (bottom > _classPrivateFieldGet(_top, this)) {
      this._swap(_classPrivateFieldGet(_top, this), bottom);
    }
    _classPrivateFieldGet(_heap, this).pop();
    this._siftDown();
    return poppedValue;
  }

  /** Compare 2 nodes and return true if the left one has higher priority. */
  comparator(a, b) {
    return a.priority > b.priority;
  }

  /** Given a node index on the heap get the parent index */
  parent(i) {
    return (i + 1 >>> 1) - 1;
  }

  /** Given a node index on the heap get the left child index */
  left(i) {
    return (i << 1) + 1;
  }

  /** Given a node index on the heap get the right child index */
  right(i) {
    return i + 1 << 1;
  }

  /**
   * Compare the nodes at index `i`, `j` on the heap
   * Return true if the node at `i` is higher priority than the node at `j`
   * Return false otherwise.
   */
  _greater(i, j) {
    return this.comparator(_classPrivateFieldGet(_heap, this)[i], _classPrivateFieldGet(_heap, this)[j]);
  }

  /** swap the nodes at index `i` and `j` on the heap */
  _swap(i, j) {
    [_classPrivateFieldGet(_heap, this)[i], _classPrivateFieldGet(_heap, this)[j]] = [_classPrivateFieldGet(_heap, this)[j], _classPrivateFieldGet(_heap, this)[i]];
  }

  /**
   * The last node of the heap will work its way up the heap until it meets a node
   * of higher priority or reaches the top of the heap.
   */
  _siftUp() {
    // Start from the last index and work our way up the heap
    let node = this.size - 1;
    // While the current node is not at the top and the priority is greater
    // than the parent we continue sifting up
    while (node > _classPrivateFieldGet(_top, this) && this._greater(node, this.parent(node))) {
      // parent is lower priority, swap with child (current node)
      this._swap(node, this.parent(node));
      // Start from the parent
      node = this.parent(node);
    }
  }

  /**
   * The top node of the heap will work its way down until no child is of higher
   * priority or it reaches the bottom of the heap.
   */
  _siftDown() {
    // Start from the top index and work our way down the heap
    let node = _classPrivateFieldGet(_top, this);
    // If a child is in the heap and has higher priority, swap with parent and go down
    while (this.left(node) < this.size && this._greater(this.left(node), node) || this.right(node) < this.size && this._greater(this.right(node), node)) {
      // Get the child with higher priority
      const maxChild = this.right(node) < this.size && this._greater(this.right(node), this.left(node)) ? this.right(node) : this.left(node);
      // Swap with parent and continue sifting down from the child
      this._swap(node, maxChild);
      // Start from the child
      node = maxChild;
    }
  }
}
exports.default = PriorityQueue;