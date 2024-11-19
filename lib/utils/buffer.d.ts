/// <reference types="node" />
import buffer from 'buffer';
import { OutputValueType } from '../types';
/**
 * Transform int to bytes
 *
 * @param {number} value Integer to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 *
 * @return {Buffer} number in bytes
 * @inner
 */
export declare function intToBytes(value: number, bytes: number): Buffer;
/**
 * Transform signed int to bytes (1, 2, or 4 bytes)
 *
 * @param {number} value Integer to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 *
 * @return {Buffer} number in bytes
 * @inner
 */
export declare function signedIntToBytes(value: number, bytes: number): Buffer;
/**
 * Transform a signed `bigint` to bytes (4 or 8 bytes).
 *
 * @param {bigint} value BigInt to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 */
export declare function bigIntToBytes(value: bigint, bytes: 4 | 8): Buffer;
/**
 * Transform float to bytes
 *
 * @param {number} value Integer to be transformed to bytes
 * @param {number} bytes How many bytes this number uses
 *
 * @return {Buffer} number in bytes
 * @inner
 */
export declare function floatToBytes(value: number, bytes: number): Buffer;
export declare const hexToBuffer: (value: string) => Buffer;
/**
 * Unpacks a buffer size
 *
 * @param {number} n The size of the buffer to unpack
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[Buffer, Buffer]} The unpacked buffer followed by the rest of the buffer
 */
export declare const unpackLen: (n: number, buff: Buffer) => [Buffer, Buffer];
/**
 * Unpacks an integer from a buffer
 *
 * @param {number} n The size of the number in bytes
 * @param {boolean} signed If the number is signed
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[number, Buffer]} The unpacked number followed by the rest of the buffer
 */
export declare const unpackToInt: (n: number, signed: boolean, buff: Buffer) => [number, Buffer];
/**
 * Unpacks a `bigint` from a buffer, used for 64-bit integers.
 *
 * @param {8} n The size of the number in bytes, should always be 8
 * @param {boolean} signed If the number is signed
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[bigint, Buffer]} The unpacked `bigint` followed by the rest of the buffer
 */
export declare const unpackToBigInt: (n: 8, signed: boolean, buff: Buffer) => [bigint, Buffer];
/**
 * Unpacks a float from a buffer
 *
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[number, Buffer]} The unpacked float followed by the rest of the buffer
 */
export declare const unpackToFloat: (buff: Buffer) => [number, Buffer];
/**
 * Unpacks a hex from a buffer
 *
 * @param {number} n The size of the hex to unpack
 * @param {Buffer} buff The buffer to unpack
 *
 * @return {[string, Buffer]} The unpacked hex followed by the rest of the buffer
 */
export declare const unpackToHex: (n: number, buff: Buffer) => [string, Buffer];
/**
 * Transforms buffer to hex
 *
 * @param {Buffer} buff The buffer to be transformed to hex
 *
 * @return {string} Hexadecimal of the buffer
 */
export declare const bufferToHex: (buff: Buffer) => string;
/**
 * Transforms buffer to output value
 * First we get the highByte value to check if it was a 8-byte or 4-byte value
 * Then we unpack the integer and multiply by the sign.
 *
 * @param srcBuf The buffer to unpack the value
 *
 * @return Output value and rest of buffer after unpacking
 */
export declare const bytesToOutputValue: (srcBuf: Buffer) => [OutputValueType, Buffer];
//# sourceMappingURL=buffer.d.ts.map