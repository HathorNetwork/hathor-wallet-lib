/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { BufferROExtract } from '../../types';

export function encode(len: number, buf: Buffer) {
  return Buffer.from(buf.subarray(0, len));
}

export function decode(len: number, buf: Buffer): BufferROExtract<Buffer> {
  if (buf.length < len) {
    throw new Error('Do not have enough bytes to read the expected length');
  }
  return {
    value: buf.subarray(0, len),
    bytesRead: len,
  };
}
