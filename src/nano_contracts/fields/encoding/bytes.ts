/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NC_ARGS_MAX_BYTES_LENGTH } from '../../../constants';
import { BufferROExtract } from '../../types';
import * as leb128 from './leb128'; 

export function encode(buf: Buffer) {
  return Buffer.concat([leb128.encode_unsigned(buf.length), Buffer.from(buf)]);
}

export function decode(buf: Buffer): BufferROExtract<Buffer> {
  // INFO: maxBytes is set to 3 because the max allowed length in bytes for a string is
  // NC_ARGS_MAX_BYTES_LENGTH which is encoded as 3 bytes in leb128 unsigned.
  // If we read a fourth byte we are definetely reading a higher number than allowed.
  const {
    value: lengthBN,
    bytesRead: bytesReadForLength,
  } = leb128.decode_unsigned(buf, 3);

  const rest = buf.subarray(bytesReadForLength);
  if (lengthBN > BigInt(NC_ARGS_MAX_BYTES_LENGTH)) {
    throw new Error('length in bytes is higher than max allowed');
  }
  // If lengthBN is lower than 64 KiB than its safe to convert to Number
  const length = Number(lengthBN);
  if (rest.length < length) {
    throw new Error('Do not have enough bytes to read the expected length');
  }
  return {
    value: rest.subarray(0, length),
    bytesRead: length + bytesReadForLength,
  };
}

