import assert from 'assert';
import buffer from 'buffer';

const nodeMajorVersion = process.versions.node.split('.')[0];

const isHexa = (value: string): boolean => {
  // test if value is string?
  return /^[0-9a-fA-F]*$/.test(value);
};

export const hexToBuffer = (value: string): Buffer => {
  if (!isHexa(value)) {
    throw new Error("hexToBuffer: argument must be a strict hex string.");
  }
  return Buffer.from(value, 'hex');
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
  return [
    buff.slice(0, n),
    buff.slice(n)
  ];
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
  let retInt;
  const slicedBuff = buff.slice(0, n);
  if (n === 1) {
    if (signed) {
      retInt = slicedBuff.readInt8();
    } else {
      retInt = slicedBuff.readUInt8();
    }
  } else if (n === 2) {
    if (signed) {
      retInt = slicedBuff.readInt16BE();
    } else {
      retInt = slicedBuff.readUInt16BE();
    }
  } else if (n === 4) {
    if (signed) {
      retInt = slicedBuff.readInt32BE();
    } else {
      retInt = slicedBuff.readUInt32BE();
    }
  } else if (n === 8) {
    // We have only signed ints here
    if (parseInt(nodeMajorVersion) > 8) {
      retInt = Number(slicedBuff.readBigInt64BE());
    } else {
      retInt = slicedBuff.readIntBE(0, 8);
    }

  }

  return [
    retInt,
    buff.slice(n)
  ];
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
  const retFloat = buff.slice(0, n).readDoubleBE();
  return [
    retFloat,
    buff.slice(n)
  ];
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

  return [
    unpackedHex,
    unpackedRet[1]
  ];
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
 * @param {Buffer} buff The buffer to unpack the value
 *
 * @return {[number, Buffer]} Output value and rest of buffer after unpacking
 */
export const bytesToOutputValue = (buff: Buffer): [number, Buffer] => {
  const [highByte, _] = unpackToInt(1, true, buff);
  let sign, value;
  if (highByte < 0) {
    // 8 bytes
    sign = -1;
    [value, buff] = unpackToInt(8, true, buff);
  } else {
    // 4 bytes
    sign = 1;
    [value, buff] = unpackToInt(4, true, buff);
  }

  return [value*sign, buff];
};
