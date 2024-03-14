/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import {
  hexToBuffer,
  intToBytes,
  floatToBytes,
  signedIntToBytes
} from '../utils/buffer';

// Number of bytes used to serialize the size of the value
const SERIALIZATION_SIZE_LEN = 2;


class Serializer {
  /**
   * Push an integer to buffer as the len of serialized element
   * Use SERIALIZATION_SIZE_LEN as the quantity of bytes to serialize
   * the integer
   *
   * @param {buf} Array of buffer to push the serialized integer
   * @param {len} Integer to serialize
   *
   * @memberof Serializer
   * @inner
   */
  pushLenValue(buf: Buffer[], len: number) {
    buf.push(intToBytes(len, SERIALIZATION_SIZE_LEN));
  }

  /**
   * Helper method to serialize any value from its type
   * We receive these type from the full node, so we
   * use the python syntax
   *
   * @param {value} Value to serialize
   * @param {type} Type of the value to be serialized
   *
   * @memberof Serializer
   * @inner
   */
  serializeFromType(value: any, type: string): Buffer {
    switch (type) {
      case 'str':
        return this.fromString(value);
      case 'bytes':
        return this.fromBytes(value);
      case 'int':
        return this.fromInt(value);
      case 'float':
        return this.fromFloat(value);
      case 'bool':
        return this.fromBool(value);
      default:
        throw new Error(`Invalid type. ${type}.`);
    }
  }

  /**
   * Serialize string value
   *
   * @param {value} Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromString(value: string): Buffer {
    return Buffer.from(value, 'utf8');
  }

  /**
   * Serialize bytes value
   *
   * @param {value} Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromBytes(value: Buffer): Buffer {
    return Buffer.from(value)
  }

  /**
   * Serialize integer value
   *
   * @param {value} Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromInt(value: number): Buffer {
    return signedIntToBytes(value, 4);
  }

  /**
   * Serialize float value
   *
   * @param {value} Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromFloat(value: number): Buffer {
    return floatToBytes(value, 8);
  }

  /**
   * Serialize boolean value
   *
   * @param {value} Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromBool(value: boolean): Buffer {
    if (value) {
      return Buffer.from([1]);
    } else {
      return Buffer.from([0]);
    }
  }

  /**
   * Serialize a list of values
   *
   * @param {value} List of values to serialize
   * @param {type} Type of the elements on the list
   *
   * @memberof Serializer
   * @inner
   */
  fromList(value: any[], type: string): Buffer {
    const ret: Buffer[] = [];
    this.pushLenValue(ret, value.length);
    for (const v of value) {
      const serialized = this.serializeFromType(v, type);
      ret.push(serialized);
    }
    return Buffer.concat(ret);
  }

  /**
   * Serialize an optional value
   *
   * @param {isEmpty} If the optional has a value or not
   * @param {value} Value to serialize (optional)
   * @param {type} Type of the value to serialize (optional)
   *
   * @memberof Serializer
   * @inner
   */
  fromOptional(isEmpty: boolean, value?: any, type?: string): Buffer {
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

  /**
   * Serialize a signed value
   * We expect the value as a string separated by comma (,)
   * with 3 elements (inputData, value, type)
   *
   * The serialization will be
   * [len(serializedValue)][serializedValue][inputData]
   *
   * @param {signedValue} String value with inputData, value, and type separated by comma
   *
   * @memberof Serializer
   * @inner
   */
  fromSigned(signedValue: string): Buffer {
    const splittedValue = signedValue.split(',');
    if (splittedValue.length !== 3) {
      throw new Error('Signed data requires 3 parameters.');
    }
    // First value must be a Buffer but comes as hex
    splittedValue[0] = hexToBuffer(splittedValue[0]);
    if (splittedValue[2] === 'bytes') {
      // If the result is expected as bytes, it will come here in the args as hex value
      splittedValue[1] = hexToBuffer(splittedValue[1]);
    } else if (splittedValue[2] === 'bool') {
      // If the result is expected as boolean, it will come here as a string true/false
      splittedValue[1] = splittedValue[1] === 'true';
    }

    const [inputData, value, type] = splittedValue;
    const ret: Buffer[] = [];

    // [len(serializedValue)][serializedValue][inputData]
    const serialized = this.serializeFromType(value, type);
    this.pushLenValue(ret, serialized.length);
    ret.push(serialized);

    ret.push(this.fromBytes(inputData));
    return Buffer.concat(ret);
  }
}

export default Serializer;