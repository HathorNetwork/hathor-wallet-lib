import buffer from 'buffer';
import { OutputValueError, ParseError } from '../errors';
import { OutputValueType } from '../types';
import { MAX_OUTPUT_VALUE, MAX_OUTPUT_VALUE_32 } from '../constants';
import { prettyValue } from './numbers';

const isHexa = (value: string): boolean => {
  // test if value is string?
  return /^[0-9a-fA-F]*$/.test(value);
};

/**
 * Transform int to bytes
 *
 * @param {number} value Integer to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 *
 * @return {Buffer} number in bytes
 * @inner
 */
export function intToBytes(value: number, bytes: number): Buffer {
  const arr = new ArrayBuffer(bytes);
  const view = new DataView(arr);
  if (bytes === 1) {
    // byteOffset = 0;
    view.setUint8(0, value);
  } else if (bytes === 2) {
    // byteOffset = 0; isLittleEndian = false
    view.setUint16(0, value, false);
  } else if (bytes === 4) {
    // byteOffset = 0; isLittleEndian = false
    view.setUint32(0, value, false);
  }
  return buffer.Buffer.from(arr);
}

/**
 * Transform signed int to bytes (1, 2, or 4 bytes)
 *
 * @param {number} value Integer to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 *
 * @return {Buffer} number in bytes
 * @inner
 */
export function signedIntToBytes(value: number, bytes: number): Buffer {
  const arr = new ArrayBuffer(bytes);
  const view = new DataView(arr);
  if (bytes === 1) {
    // byteOffset = 0
    view.setInt8(0, value);
  } else if (bytes === 2) {
    // byteOffset = 0; isLittleEndian = false
    view.setInt16(0, value, false);
  } else if (bytes === 4) {
    view.setInt32(0, value, false);
  }
  return buffer.Buffer.from(arr);
}

/**
 * Transform a signed `bigint` to bytes (4 or 8 bytes).
 *
 * @param {bigint} value BigInt to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 */
export function bigIntToBytes(value: bigint, bytes: 4 | 8): Buffer {
  const arr = new ArrayBuffer(bytes);
  const view = new DataView(arr);
  switch (bytes) {
    case 4:
      if (value < -(2n ** 31n) || 2n ** 31n - 1n < value) {
        throw new Error(`value too large for 4 bytes: ${value}`);
      }
      view.setInt32(0, Number(value), false);
      break;
    case 8:
      if (value < -(2n ** 63n) || 2n ** 63n - 1n < value) {
        throw new Error(`value too large for 8 bytes: ${value}`);
      }
      view.setBigInt64(0, value, false);
      break;
    default:
      throw new Error(`invalid bytes size: ${bytes}`);
  }
  return buffer.Buffer.from(arr);
}

/**
 * Transform float to bytes
 *
 * @param {number} value Integer to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 *
 * @return {Buffer} number in bytes
 * @inner
 */
export function floatToBytes(value: number, bytes: number): Buffer {
  const arr = new ArrayBuffer(bytes);
  const view = new DataView(arr);
  if (bytes === 8) {
    // byteOffset = 0; isLitteEndian = false
    view.setFloat64(0, value, false);
  }
  return buffer.Buffer.from(arr);
}

export const hexToBuffer = (value: string): Buffer => {
  console.log('hex to buffer: ', value);
  if (!isHexa(value)) {
    throw new Error('hexToBuffer: argument must be a strict hex string.');
  }
  return Buffer.from(value, 'hex');
};

/**
 * Validates if buffer has enough bytes to unpack
 *
 * @param {number} n The size to unpack
 * @param {Buffer} buff The buffer to unpack
 *
 * @throws ParseError when requests to unpack more bytes than the buffer size
 */
const validateLenToUnpack = (n: number, buff: Buffer) => {
  if (buff.length < n) {
    throw new ParseError(
      `Don't have enough bytes to unpack. Requested ${n} and buffer has ${buff.length}`
    );
  }
};

/**
 * Unpacks a buffer size
 *
 * @param {number} n The size of the buffer to unpack
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[Buffer, Buffer]} The unpacked buffer followed by the rest of the buffer
 */
export const unpackLen = (n: number, buff: Buffer): [Buffer, Buffer] => {
  validateLenToUnpack(n, buff);

  return [buff.subarray(0, n), buff.subarray(n)];
};

/**
 * Unpacks an integer from a buffer
 *
 * @param {number} n The size of the number in bytes
 * @param {boolean} signed If the number is signed
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[number, Buffer]} The unpacked number followed by the rest of the buffer
 */
export const unpackToInt = (n: number, signed: boolean, buff: Buffer): [number, Buffer] => {
  validateLenToUnpack(n, buff);

  let retInt;
  const slicedBuff = buff.slice(0, n);
  if (n === 1) {
    if (signed) {
      retInt = slicedBuff.readInt8(0);
    } else {
      retInt = slicedBuff.readUInt8(0);
    }
  } else if (n === 2) {
    if (signed) {
      retInt = slicedBuff.readInt16BE(0);
    } else {
      retInt = slicedBuff.readUInt16BE(0);
    }
  } else if (n === 4) {
    if (signed) {
      retInt = slicedBuff.readInt32BE(0);
    } else {
      retInt = slicedBuff.readUInt32BE(0);
    }
  } else {
    throw new ParseError('Invalid value for n.');
  }

  return [retInt, buff.slice(n)];
};

/**
 * Unpacks a `bigint` from a buffer, used for 64-bit integers.
 *
 * @param {8} n The size of the number in bytes, should always be 8
 * @param {boolean} signed If the number is signed
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[bigint, Buffer]} The unpacked `bigint` followed by the rest of the buffer
 */
export const unpackToBigInt = (n: 8, signed: boolean, buff: Buffer): [bigint, Buffer] => {
  validateLenToUnpack(n, buff);
  const [buf, rest] = [buff.subarray(0, n), buff.subarray(n)];

  if (n !== 8) {
    throw new Error(`invalid bytes size: ${n}`);
  }

  const value = signed ? buf.readBigInt64BE(0) : buf.readBigUInt64BE(0);
  return [value, rest];
};

/**
 * Unpacks a float from a buffer
 *
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[number, Buffer]} The unpacked float followed by the rest of the buffer
 */
export const unpackToFloat = (buff: Buffer): [number, Buffer] => {
  const n = 8;
  validateLenToUnpack(n, buff);

  const retFloat = buff.slice(0, n).readDoubleBE(0);
  return [retFloat, buff.slice(n)];
};

/**
 * Unpacks a hex from a buffer
 *
 * @param {number} n The size of the hex to unpack
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[string, Buffer]} The unpacked hex followed by the rest of the buffer
 */
export const unpackToHex = (n: number, buff: Buffer): [string, Buffer] => {
  const unpackedRet = unpackLen(n, buff);
  const unpackedHex = bufferToHex(unpackedRet[0]);

  return [unpackedHex, unpackedRet[1]];
};

/**
 * Transforms buffer to hex
 *
 * @param {Buffer} buff The buffer to be transformed to hex
 *
 * @return {string} Hexadecimal of the buffer
 */
export const bufferToHex = (buff: Buffer): string => {
  return buff.toString('hex');
};

/**
 * Transforms buffer to output value
 * First we get the highByte value to check if it was a 8-byte or 4-byte value
 * Then we unpack the integer and multiply by the sign.
 *
 * @param srcBuf The buffer to unpack the value
 *
 * @return Output value and rest of buffer after unpacking
 */
export const bytesToOutputValue = (srcBuf: Buffer): [OutputValueType, Buffer] => {
  // Copies buffer locally, not to change the original parameter
  let buff = Buffer.from(srcBuf);

  const [highByte] = unpackToInt(1, true, buff);
  let sign: OutputValueType;
  let value: OutputValueType;
  if (highByte < 0) {
    // 8 bytes
    sign = -1n;
    [value, buff] = unpackToBigInt(8, true, buff);
  } else {
    // 4 bytes
    sign = 1n;
    let numberValue: number;
    [numberValue, buff] = unpackToInt(4, true, buff);
    value = BigInt(numberValue);
  }

  return [value * sign, buff];
};

/**
 * Get the bytes from the value
 * If value is above the maximum for 32 bits we get from 8 bytes, otherwise only 4 bytes
 *
 * @throws {OutputValueError} Will throw an error if output value is invalid
 */
export const outputValueToBytes = (value: OutputValueType): Buffer => {
  if (value <= 0) {
    throw new OutputValueError('Output value must be positive');
  }
  if (value > MAX_OUTPUT_VALUE) {
    throw new OutputValueError(`Maximum value is ${prettyValue(MAX_OUTPUT_VALUE)}`);
  }
  if (value > MAX_OUTPUT_VALUE_32) {
    return bigIntToBytes(-value, 8);
  }
  return bigIntToBytes(value, 4);
};
