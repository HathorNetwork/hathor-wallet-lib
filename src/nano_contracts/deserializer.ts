/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { bufferToHex, unpackToFloat, unpackToInt } from '../utils/buffer';

// Number of bytes used to serialize the size of the value
const SERIALIZATION_SIZE_LEN = 2;


class Deserializer {
  deserializeFromType(value: Buffer, type: string): any {
    switch (type) {
      case 'str':
        return this.toString(value);
      case 'bytes':
        return this.toBytes(value);
      case 'int':
        return this.toInt(value);
      case 'float':
        return this.toFloat(value);
      case 'bool':
        return this.toBool(value);
      default:
        throw new Error('Invalid type.');
    }
  }

  toString(value: Buffer): string {
    return value.toString('utf8');
  }

  toBytes(value: Buffer): Buffer {
    return value;
  }

  toInt(value: Buffer): number {
    return unpackToInt(4, true, value)[0];
  }

  toFloat(value: Buffer): number {
    return unpackToFloat(value)[0];
  }

  toBool(value: Buffer): boolean {
    if (value[0]) {
      return true;
    } else {
      return false;
    }
  }

  toSigned(signedData: Buffer, type: string): string {
    let signedBuffer: Buffer;
    let size: number;
    // [len(serializedResult)][serializedResult][inputData]
    [size, signedBuffer] = unpackToInt(2, false, signedData);
    const parsed = this.deserializeFromType(signedBuffer.slice(0, size), type);
    signedBuffer = signedBuffer.slice(size);
    return `${bufferToHex(signedBuffer)},${parsed},${type}`;
  }
}

export default Deserializer;