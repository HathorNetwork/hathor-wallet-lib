/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import dateFormatter from '../../src/utils/date';

test('Parse timestamp', () => {
  // 2019-05-08 10:43:49 UTC
  const timestamp = 1557312229;
  const formatted = dateFormatter.parseTimestamp(timestamp, 'UTC');
  expect(formatted).toBe('5/8/2019 10:43:49 AM');

  const d = new Date(timestamp*1000);
  const calculatedTimestamp = dateFormatter.dateToTimestamp(d);
  expect(calculatedTimestamp).toBe(timestamp);
})
