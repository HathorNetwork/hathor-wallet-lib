/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface Leb128DecodeResult {
  value: bigint,
  rest: Buffer,
}

export function encodeSigned(value: bigint | number, maxBytes: number | null = null): Buffer {
  const errMessage = `Cannot encode more than ${maxBytes} bytes`;
  let val = BigInt(value);
  const result: bigint[] = [];
  while (true) {
    const byte = val & 0b0111_1111n;
    val = val >> 7n;
    if ((val === 0n && (byte & 0b0100_0000n) === 0n) || (val === -1n && (byte & 0b0100_0000n) !== 0n)) {
      result.push(byte);
      if (maxBytes !== null && result.length > maxBytes) {
        throw new Error(errMessage);
      }
      // Need to convert the bigint values of `result` into Number to use with Buffer.
      // This is a safe operation since the value of the elements can only go up to 0xFF
      return Buffer.from(result.map(b => Number(b)));
    }

    // Add 7 bits + first bit indicating the existence of the next block.
    result.push(byte | 0b1000_0000n);
    if (maxBytes !== null && result.length > maxBytes) {
      throw new Error(errMessage);
    }
  }
}

export function decodeSigned(buf: Buffer, maxBytes: number | null = null): Leb128DecodeResult {
  let byte_list = Array.from(buf.values()).map(v => BigInt(v));
  let result = 0n;
  let shift = 0n;
  while (true) {
    const byte = byte_list.shift();
    if (byte === undefined) {
      throw new Error('finished buffer and have no data to read anymore');
    }
    result = result | (byte & 0b0111_1111n) << shift;
    shift += 7n;
    // assert shift % 7n === 0
    if (shift % 7n !== 0n) throw new Error();

    if (maxBytes !== null && (shift / 7n > maxBytes)) {
      throw new Error('Passed max bytes');
    }

    if ((byte & 0b1000_0000n) === 0n) {
      // Last byte
      if ((byte & 0b0100_0000n) !== 0n) {
        // Negative sign
        return {
          value: result | -(1n << shift),
          rest: Buffer.from(byte_list.map(b => Number(b))),
        };
      }

      return {
        value: result,
        rest: Buffer.from(byte_list.map(b => Number(b))),
      }
    }
  }
}

export default {
  encodeSigned,
  decodeSigned,
};
