/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { BufferROExtract } from '../../types';

export function encode(value: boolean) {
  return Buffer.from([value ? 1 : 0]);
}

export function decode(buf: Buffer): BufferROExtract<boolean> {
  switch (buf[0]) {
    case 0:
      return {
        value: false,
        bytesRead: 1,
      };
    case 1:
      return {
        value: true,
        bytesRead: 1,
      };
    default:
      throw new Error();
  }
}
