/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Signed examples from the DWARF 5 standard, section 7.6, table 7.8.
 * https://dwarfstd.org/doc/DWARF5.pdf
 */
export const DWARF5SignedTestCases: [bigint, Buffer][] = [
  [2n, Buffer.from([2])],
  [-2n, Buffer.from([0x7e])],
  [127n, Buffer.from([127 + 0x80, 0])],
  [-127n, Buffer.from([1 + 0x80, 0x7f])],
  [128n, Buffer.from([0 + 0x80, 1])],
  [-128n, Buffer.from([0 + 0x80, 0x7f])],
  [129n, Buffer.from([1 + 0x80, 1])],
  [-129n, Buffer.from([0x7f + 0x80, 0x7e])],
];

/**
 * Unsigned examples from the DWARF 5 standard, section 7.6, table 7.7.
 * https://dwarfstd.org/doc/DWARF5.pdf
 */
export const DWARF5UnsignedTestCases: [bigint, Buffer][] = [
  [2n, Buffer.from([2])],
  [127n, Buffer.from([127])],
  [128n, Buffer.from([0x80, 1])],
  [129n, Buffer.from([1 + 0x80, 1])],
  [12857n, Buffer.from([57 + 0x80, 100])],
];
