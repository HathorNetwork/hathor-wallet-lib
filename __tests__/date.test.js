/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import dateFormatter from '../src/date';


test('Parse timestamp', () => {
  // 2019-05-08 11:43:49
  const timestamp = 1557312229;
  const formatted = dateFormatter.parseTimestamp(timestamp);
  expect(formatted).toBe('5/8/2019 11:43:49 AM');

  const d = new Date(timestamp*1000);
  const calculatedTimestamp = dateFormatter.dateToTimestamp(d);
  expect(calculatedTimestamp).toBe(timestamp);
})

test('Parse uptime', () => {
  const seconds1 = 100;
  const result1 = dateFormatter.uptimeFormat(seconds1);
  const expected1 = '0 days, 00:01:40';
  expect(result1).toBe(expected1);

  const seconds2 = 5;
  const result2 = dateFormatter.uptimeFormat(seconds2);
  const expected2 = '0 days, 00:00:05';
  expect(result2).toBe(expected2);

  const seconds3 = 12007;
  const result3 = dateFormatter.uptimeFormat(seconds3);
  const expected3 = '0 days, 03:20:07';
  expect(result3).toBe(expected3);

  const seconds4 = 180723;
  const result4 = dateFormatter.uptimeFormat(seconds4);
  const expected4 = '2 days, 02:12:03';
  expect(result4).toBe(expected4);
})