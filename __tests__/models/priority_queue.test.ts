/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import PriorityQueue from '../../src/models/priority_queue';

test('PriorityQueue operations', () => {
  const q = new PriorityQueue<string>();
  expect(q.size).toEqual(0);
  // method: makeNode
  expect(PriorityQueue.makeNode(123, 'foobar')).toMatchObject({
    priority: 123,
    value: 'foobar',
  });

  // methods: push and pop
  q.push(PriorityQueue.makeNode(10, 'foobar1'));
  expect(q.size).toEqual(1);
  expect(q.isEmpty()).toBeFalsy();
  expect(q.pop()).toEqual('foobar1');
  expect(q.isEmpty()).toBeTruthy();

  // method: add
  const elements = [
    { priority: 10, value: 'foo' },
    { priority: 1,  value: 'baz' },
    { priority: 5,  value: 'bar' },
  ].map(el => PriorityQueue.makeNode(el.priority, el.value));
  q.add(...elements);
  expect(q.size).toEqual(3);
  expect(q.isEmpty()).toBeFalsy();
  expect(q.pop()).toEqual('foo');
  expect(q.size).toEqual(2);
  expect(q.isEmpty()).toBeFalsy();
  expect(q.peek()).toEqual('bar');
  expect(q.pop()).toEqual('bar');
  expect(q.size).toEqual(1);
  expect(q.isEmpty()).toBeFalsy();
  expect(q.peek()).toEqual('baz');
  expect(q.pop()).toEqual('baz');
  expect(q.size).toEqual(0);
  expect(q.isEmpty()).toBeTruthy();
});

