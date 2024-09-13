/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["parent", "left", "right", "comparator"] }] */

interface PriorityQueueNode<T> {
  value: T;
  priority: number;
}

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
export default class PriorityQueue<T = unknown> {
  #heap: PriorityQueueNode<T>[];

  readonly #top: number;

  constructor() {
    this.#heap = [];
    this.#top = 0;
  }

  /**
   * Utility to create a node from a value and priority.
   * @example
   * // returns { value: 'foobar', 'priority': 10 }
   * prioQueue.makeNode(10, 'foobar');
   */
  static makeNode<N>(priority: number, value: N): PriorityQueueNode<N> {
    return { value, priority };
  }

  /**
   * Get the number of elements on the priority queue.
   */
  public get size() {
    return this.#heap.length;
  }

  /**
   * Check if the priority queue is empty
   */
  public isEmpty() {
    return this.size === 0;
  }

  /**
   * Get the top value of the queue without removing it from the queue.
   */
  public peek() {
    if (this.size === 0) {
      // Heap is empty
      return undefined;
    }
    return this.#heap[this.#top].value;
  }

  /**
   * Add a node to the priority queue and maintain the priority order.
   */
  public push(value: PriorityQueueNode<T>) {
    this.#heap.push(value);
    this._siftUp();
  }

  /**
   * Add multiple values to the priority queue while maintaining the priority order.
   */
  public add(...values: PriorityQueueNode<T>[]) {
    values.forEach(value => {
      this.push(value);
    });
    return this.size;
  }

  /**
   * Get the node with highest priority and remove it from the priority queue.
   */
  public pop() {
    const poppedValue = this.peek();
    // Check if poppedValue is null or undefined, meaning the queue is empty
    if (!(poppedValue ?? false)) {
      return undefined;
    }
    const bottom = this.size - 1;
    if (bottom > this.#top) {
      this._swap(this.#top, bottom);
    }
    this.#heap.pop();
    this._siftDown();
    return poppedValue;
  }

  /** Compare 2 nodes and return true if the left one has higher priority. */
  private comparator(a: PriorityQueueNode<T>, b: PriorityQueueNode<T>): boolean {
    return a.priority > b.priority;
  }

  /** Given a node index on the heap get the parent index */
  private parent(i: number) {
    return ((i + 1) >>> 1) - 1;
  }

  /** Given a node index on the heap get the left child index */
  private left(i: number) {
    return (i << 1) + 1;
  }

  /** Given a node index on the heap get the right child index */
  private right(i: number) {
    return (i + 1) << 1;
  }

  /**
   * Compare the nodes at index `i`, `j` on the heap
   * Return true if the node at `i` is higher priority than the node at `j`
   * Return false otherwise.
   */
  private _greater(i: number, j: number) {
    return this.comparator(this.#heap[i], this.#heap[j]);
  }

  /** swap the nodes at index `i` and `j` on the heap */
  private _swap(i: number, j: number) {
    [this.#heap[i], this.#heap[j]] = [this.#heap[j], this.#heap[i]];
  }

  /**
   * The last node of the heap will work its way up the heap until it meets a node
   * of higher priority or reaches the top of the heap.
   */
  private _siftUp() {
    // Start from the last index and work our way up the heap
    let node = this.size - 1;
    // While the current node is not at the top and the priority is greater
    // than the parent we continue sifting up
    while (node > this.#top && this._greater(node, this.parent(node))) {
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
  private _siftDown() {
    // Start from the top index and work our way down the heap
    let node = this.#top;
    // If a child is in the heap and has higher priority, swap with parent and go down
    while (
      (this.left(node) < this.size && this._greater(this.left(node), node)) ||
      (this.right(node) < this.size && this._greater(this.right(node), node))
    ) {
      // Get the child with higher priority
      const maxChild =
        this.right(node) < this.size && this._greater(this.right(node), this.left(node))
          ? this.right(node)
          : this.left(node);
      // Swap with parent and continue sifting down from the child
      this._swap(node, maxChild);
      // Start from the child
      node = maxChild;
    }
  }
}
