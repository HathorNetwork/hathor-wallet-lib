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
  signedIntToBytes,
  bigIntToBytes,
} from '../utils/buffer';
import { NanoContractArgumentType } from './types';
import { OutputValueType } from '../types';

// Number of bytes used to serialize the size of the value
const SERIALIZATION_SIZE_LEN = 2;

/* eslint-disable class-methods-use-this -- XXX: Methods that do not use `this` should be made static */
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
  serializeFromType(value: NanoContractArgumentType, type: string): Buffer {
    if (type.endsWith('?')) {
      // This is an optional
      const optionalType = type.slice(0, -1);
      return this.fromOptional(value, optionalType);
    }

    if (type.startsWith('SignedData[')) {
      return this.fromSigned(value as string);
    }

    switch (type) {
      case 'str':
        return this.fromString(value as string);
      case 'bytes':
      case 'Address':
      case 'VertexId':
      case 'ContractId':
      case 'TxOutputScript':
      case 'TokenUid':
        return this.fromBytes(value as Buffer);
      case 'int':
      case 'Timestamp':
        return this.fromInt(value as number);
      case 'Amount':
        return this.fromAmount(value as OutputValueType);
      case 'float':
        return this.fromFloat(value as number);
      case 'bool':
        return this.fromBool(value as boolean);
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
    return Buffer.from(value);
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
   * Serialize amount value
   *
   * @param {value} Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromAmount(value: OutputValueType): Buffer {
    // Nano `Amount` currently only supports up to 4 bytes.
    // If we change Nano to support up to 8 bytes, we must update this.
    return bigIntToBytes(value, 4);
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
    }
    return Buffer.from([0]);
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
  fromList(value: NanoContractArgumentType[], type: string): Buffer {
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
   * If value is null, then it's a buffer with 0 only. If it's not null,
   * we create a buffer with 1 in the first byte and the serialized value
   * in the sequence.
   *
   * @param {value} Value to serialize. If not, the optional is empty
   * @param {type} Type of the value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromOptional(value: NanoContractArgumentType, type: string): Buffer {
    if (value === null) {
      return Buffer.from([0]);
    }

    if (value === undefined || !type) {
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
    const inputData = hexToBuffer(splittedValue[0]);
    const type = splittedValue[2];
    let value: Buffer | string | boolean;
    if (type === 'bytes') {
      // If the result is expected as bytes, it will come here in the args as hex value
      value = hexToBuffer(splittedValue[1]);
    } else if (type === 'bool') {
      // If the result is expected as boolean, it will come here as a string true/false
      value = splittedValue[1] === 'true';
    } else {
      // For the other types
      // eslint-disable-next-line prefer-destructuring -- Destructuring would make this harder to read
      value = splittedValue[1];
    }

    const ret: Buffer[] = [];

    // [len(serializedValue)][serializedValue][inputData]
    const serialized = this.serializeFromType(value, type);
    this.pushLenValue(ret, serialized.length);
    ret.push(serialized);

    ret.push(this.fromBytes(inputData));
    return Buffer.concat(ret);
  }
}
/* eslint-disable class-methods-use-this */

export default Serializer;
