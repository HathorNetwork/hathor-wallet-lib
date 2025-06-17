/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import leb128Util from '../../../utils/leb128';
import { BufferROExtract } from '../../types';

export function encode_unsigned(value: bigint | number, maxBytes: number | null = null) {
  return leb128Util.encodeUnsigned(value, maxBytes);
}

export function decode_unsigned(
  value: Buffer,
  maxBytes: number | null = null
): BufferROExtract<bigint> {
  return leb128Util.decodeUnsigned(value, maxBytes);
}

export function encode_signed(value: bigint | number, maxBytes: number | null = null) {
  return leb128Util.encodeSigned(value, maxBytes);
}

export function decode_signed(
  value: Buffer,
  maxBytes: number | null = null
): BufferROExtract<bigint> {
  return leb128Util.decodeSigned(value, maxBytes);
}
