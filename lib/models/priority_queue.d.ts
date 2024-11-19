/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
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
    #private;
    constructor();
    /**
     * Utility to create a node from a value and priority.
     * @example
     * // returns { value: 'foobar', 'priority': 10 }
     * prioQueue.makeNode(10, 'foobar');
     */
    static makeNode<N>(priority: number, value: N): PriorityQueueNode<N>;
    /**
     * Get the number of elements on the priority queue.
     */
    get size(): number;
    /**
     * Check if the priority queue is empty
     */
    isEmpty(): boolean;
    /**
     * Get the top value of the queue without removing it from the queue.
     */
    peek(): T | undefined;
    /**
     * Add a node to the priority queue and maintain the priority order.
     */
    push(value: PriorityQueueNode<T>): void;
    /**
     * Add multiple values to the priority queue while maintaining the priority order.
     */
    add(...nodes: PriorityQueueNode<T>[]): number;
    /**
     * Get the node with highest priority and remove it from the priority queue.
     */
    pop(): T | undefined;
    /** Compare 2 nodes and return true if the left one has higher priority. */
    private comparator;
    /** Given a node index on the heap get the parent index */
    private parent;
    /** Given a node index on the heap get the left child index */
    private left;
    /** Given a node index on the heap get the right child index */
    private right;
    /**
     * Compare the nodes at index `i`, `j` on the heap
     * Return true if the node at `i` is higher priority than the node at `j`
     * Return false otherwise.
     */
    private _greater;
    /** swap the nodes at index `i` and `j` on the heap */
    private _swap;
    /**
     * The last node of the heap will work its way up the heap until it meets a node
     * of higher priority or reaches the top of the heap.
     */
    private _siftUp;
    /**
     * The top node of the heap will work its way down until no child is of higher
     * priority or it reaches the bottom of the heap.
     */
    private _siftDown;
}
export {};
//# sourceMappingURL=priority_queue.d.ts.map