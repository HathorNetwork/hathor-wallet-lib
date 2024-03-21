/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { bufferToHex, unpackToFloat, unpackToInt } from '../utils/buffer';


class Deserializer {
  /**
   * Helper method to deserialize any value from its type
   * We receive these types from the full node, so we
   * use the python syntax
   *
   * @param {value} Value to deserialize
   * @param {type} Type of the value to be deserialized
   *
   * @memberof Deserializer
   * @inner
   */
  deserializeFromType(value: Buffer, type: string): any {
    if (type.startsWith('SignedData[')) {
      return this.toSigned(value, type);
    }

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

  /**
   * Deserialize string value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toString(value: Buffer): string {
    return value.toString('utf8');
  }

  /**
   * Deserialize bytes value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toBytes(value: Buffer): Buffer {
    return value;
  }

  /**
   * Deserialize int value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toInt(value: Buffer): number {
    return unpackToInt(4, true, value)[0];
  }

  /**
   * Deserialize float value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toFloat(value: Buffer): number {
    return unpackToFloat(value)[0];
  }

  /**
   * Deserialize boolean value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toBool(value: Buffer): boolean {
    if (value[0]) {
      return true;
    } else {
      return false;
    }
  }

  /**
   * Deserialize a signed value
   *
   * The signedData what will be deserialized is
   * [len(serializedValue)][serializedValue][inputData]
   *
   * @param {signedData} Buffer with serialized signed value
   * @param {type} Type of the signed value, with the subtype, e.g., SignedData[str]
   *
   * @memberof Deserializer
   * @inner
   */
  toSigned(signedData: Buffer, type: string): string {
    const valueType = type.slice(0, -1).split('[')[1];

    let signedBuffer: Buffer;
    let size: number;
    // [len(serializedResult)][serializedResult][inputData]
    [size, signedBuffer] = unpackToInt(2, false, signedData);
    const parsed = this.deserializeFromType(signedBuffer.slice(0, size), valueType);
    signedBuffer = signedBuffer.slice(size);
    return `${bufferToHex(signedBuffer)},${parsed},${valueType}`;
  }
}

export default Deserializer;