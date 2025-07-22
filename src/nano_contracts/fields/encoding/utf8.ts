/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { BufferROExtract } from '../../types';
import * as bytes from './bytes';

export function encode(value: string) {
  return bytes.encode(Buffer.from(value, 'utf-8'));
}

export function decode(buf: Buffer): BufferROExtract<string> {
  const { value, bytesRead } = bytes.decode(buf);

  return {
    value: value.toString('utf-8'),
    bytesRead,
  };
}
