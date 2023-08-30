/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { intToBytes, floatToBytes, signedIntToBytes } from '../utils/buffer';

// Number of bytes used to serialize the size of the value
const SERIALIZATION_SIZE_LEN = 2;


class Serializer {
  pushLenValue(buf: Buffer[], len: number) {
    buf.push(intToBytes(len, SERIALIZATION_SIZE_LEN));
  }

  serializeFromType(value: any, type: string): Buffer {
    switch (type) {
      case 'string':
        return this.fromString(value);
      case 'byte':
        return this.fromBytes(value);
      case 'int':
        return this.fromInt(value);
      case 'float':
        return this.fromFloat(value);
      case 'bool':
        return this.fromBool(value);
      default:
        throw new Error('Invalid type.');
    }
  }

  fromString(value: string): Buffer {
    return Buffer.from(value, 'utf8');
  }

  fromBytes(value: Buffer): Buffer {
    return Buffer.from(value)
  }

  fromInt(value: number): Buffer {
    return signedIntToBytes(value, 4);
  }

  fromFloat(value: number): Buffer {
    return floatToBytes(value, 8);
  }

  fromBool(value: boolean): Buffer {
    if (value) {
      return Buffer.from([1]);
    } else {
      return Buffer.from([0]);
    }
  }

  fromList(value: any[], type: string): Buffer {
    const ret: Buffer[] = [];
    this.pushLenValue(ret, value.length);
    for (const v of value) {
      const serialized = this.serializeFromType(v, type);
      ret.push(serialized);
    }
    return Buffer.concat(ret);
  }

  fromOptional(isEmpty: boolean, value?: any, type?: string) {
    // We are not supporting List optional for now
    if (isEmpty) {
      return Buffer.from([0]);
    }

    if (!value || !type) {
      throw new Error('Missing value or type in non empty optional.');
    }

    const ret: Buffer[] = [];
    ret.push(Buffer.from([1]));

    const serialized = this.serializeFromType(value, type);
    ret.push(serialized);
    return Buffer.concat(ret);
  }

  fromSigned(inputData: Buffer, value: any, type: string) {
    const ret: Buffer[] = [];

    // [len(serializedResult)][serializedResult][inputData]
    const serialized = this.serializeFromType(value, type);
    this.pushLenValue(ret, serialized.length);
    ret.push(serialized);

    ret.push(this.fromBytes(inputData));
    return Buffer.concat(ret);
  }
}

export default Serializer;