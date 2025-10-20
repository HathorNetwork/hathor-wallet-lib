/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface Leb128DecodeResult {
  value: bigint;
  rest: Buffer;
  bytesRead: number;
}

/**
 * Encode a number into a leb128 encoded buffer.
 * @param value The actual value to encode.
 * @param [signed=true] Differentiate signed and unsigned encoded numbers.
 * @param [maxBytes=null] Max allowed size of the output buffer.
 */
export function encodeLeb128(
  value: bigint | number,
  signed: boolean = true,
  maxBytes: number | null = null
) {
  let val = BigInt(value);
  if (!signed && val < 0n) {
    throw new Error('Cannot encode an unsigned negative value');
  }
  const result: bigint[] = [];
  while (true) {
    const byte = val & 0b0111_1111n;
    val >>= 7n;
    let isLastByte = false;
    if (signed) {
      // signed check for last byte
      isLastByte =
        (val === 0n && (byte & 0b0100_0000n) === 0n) ||
        (val === -1n && (byte & 0b0100_0000n) !== 0n);
    } else {
      // unsigned check for last byte
      isLastByte = val === 0n && (byte & 0b1000_0000n) === 0n;
    }
    if (isLastByte) {
      result.push(byte);
      if (maxBytes !== null && result.length > maxBytes) {
        throw new Error(`Cannot encode more than ${maxBytes} bytes`);
      }
      // Need to convert the bigint values of `result` into Number to use with Buffer.
      // This is a safe operation since the value of the elements can only go up to 0xFF
      return Buffer.from(result.map(b => Number(b)));
    }

    // Add 7 bits + first bit indicating the existence of the next block.
    result.push(byte | 0b1000_0000n);
    if (maxBytes !== null && result.length > maxBytes) {
      throw new Error(`Cannot encode more than ${maxBytes} bytes`);
    }
  }
}

/**
 * Decode a leb128 buffer into a number if possible.
 * @param buf The buffer with the actual data.
 * @param [signed=true] Differentiate signed and unsigned encoded numbers.
 * @param [maxBytes=null] Max allowed size of the output buffer.
 */
export function decodeLeb128(
  buf: Buffer,
  signed: boolean = true,
  maxBytes: number | null = null
): Leb128DecodeResult {
  const byte_list = Array.from(buf.values()).map(v => BigInt(v));
  let result = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (true) {
    bytesRead += 1;
    const byte = byte_list.shift();
    if (byte === undefined) {
      throw new Error('Buffer is not valid leb128, cannot read from empty buffer');
    }
    result |= (byte & 0b0111_1111n) << shift;
    shift += 7n;
    if (shift % 7n !== 0n)
      throw new Error(`AssertionError: shift is ${shift} and is not divisible by 7`);

    if (maxBytes !== null && shift / 7n > maxBytes) {
      throw new Error(`Cannot decode more than the max ${maxBytes} bytes`);
    }

    if ((byte & 0b1000_0000n) === 0n) {
      // Last byte
      if (signed && (byte & 0b0100_0000n) !== 0n) {
        // Negative sign
        return {
          value: result | -(1n << shift),
          rest: Buffer.from(byte_list.map(b => Number(b))),
          bytesRead,
        };
      }

      return {
        value: result,
        rest: Buffer.from(byte_list.map(b => Number(b))),
        bytesRead,
      };
    }
  }
}

/**
 * Encode signed leb128 number
 */
export function encodeSigned(value: bigint | number, maxBytes: number | null = null): Buffer {
  return encodeLeb128(value, true, maxBytes);
}

/**
 * Decode signed leb128 number
 */
export function decodeSigned(buf: Buffer, maxBytes: number | null = null): Leb128DecodeResult {
  return decodeLeb128(buf, true, maxBytes);
}

/**
 * Encode unsigned leb128 number
 */
export function encodeUnsigned(value: bigint | number, maxBytes: number | null = null): Buffer {
  return encodeLeb128(value, false, maxBytes);
}

/**
 * Decode unsigned leb128 number
 */
export function decodeUnsigned(buf: Buffer, maxBytes: number | null = null): Leb128DecodeResult {
  return decodeLeb128(buf, false, maxBytes);
}

export default {
  encodeLeb128,
  decodeLeb128,

  encodeSigned,
  decodeSigned,
  encodeUnsigned,
  decodeUnsigned,
};
