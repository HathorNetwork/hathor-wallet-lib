/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Queue from '../../src/models/queue';

test('Queue operations', () => {
  const q = new Queue();
  expect(q.size()).toEqual(0);
  const elements = [1, 2, 3];
  // Enqueue elements
  elements.forEach(el => q.enqueue(el));
  expect(q.size()).toEqual(3);
  // dequeued elements should in the same order as they were enqueued
  let expectedSize = 3;
  elements.forEach(expected => {
    // Peek should return the next element without dequeing
    const peekedEl = q.peek();
    expect(q.size()).toEqual(expectedSize);
    expect(peekedEl).toEqual(expected);

    // Dequeue should return the next element
    const el = q.dequeue();
    expect(el).toEqual(expected);
    expectedSize--;
    expect(q.size()).toEqual(expectedSize);
  });
  expect(q.size()).toEqual(0);

  // Next dequeue should return undefined
  expect(q.dequeue()).toBeUndefined();
  expect(q.size()).toEqual(0);

  // The queue should work even after it is depleted
  q.enqueue(123);
  expect(q.peek()).toEqual(123);
  expect(q.size()).toEqual(1);
  q.enqueue(456);
  expect(q.peek()).toEqual(123);
  expect(q.size()).toEqual(2);
  q.enqueue(789);
  expect(q.peek()).toEqual(123);
  expect(q.size()).toEqual(3);
  expect(q.dequeue()).toEqual(123);
  expect(q.dequeue()).toEqual(456);
  expect(q.dequeue()).toEqual(789);
  expect(q.size()).toEqual(0);
});
