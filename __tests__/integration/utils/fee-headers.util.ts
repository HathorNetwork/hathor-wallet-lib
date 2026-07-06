/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import FeeHeader from '../../../src/headers/fee';
import Header from '../../../src/headers/base';

/**
 * Asserts that the headers list has exactly one fee header charging the given
 * amount on the native token (tokenIndex 0 — fee-based tokens always pay fees in HTR).
 */
export function expectFeeAmount(headers: Header[], expectedFee: bigint) {
  const feeHeaders = headers.filter(h => h instanceof FeeHeader);
  expect(feeHeaders).toHaveLength(1);
  const { entries } = feeHeaders[0] as FeeHeader;
  expect(entries).toHaveLength(1);
  expect(entries[0].tokenIndex).toBe(0);
  expect(entries[0].amount).toBe(expectedFee);
}
