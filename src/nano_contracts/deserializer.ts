/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { bufferToHex, unpackToFloat, unpackToInt } from '../utils/buffer';
import helpersUtils from '../utils/helpers';
import Network from '../models/network';
import { NanoContractArgumentType } from './types';
import { OutputValueType } from '../types';

class Deserializer {
  network: Network;

  constructor(network: Network) {
    this.network = network;
  }

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
  deserializeFromType(value: Buffer, type: string): NanoContractArgumentType | null {
    if (type.endsWith('?')) {
      // It's an optional
      const optionalType = type.slice(0, -1);
      return this.toOptional(value, optionalType);
    }

    if (type.startsWith('SignedData[')) {
      return this.toSigned(value, type);
    }

    switch (type) {
      case 'str':
        return this.toString(value);
      case 'bytes':
      case 'TxOutputScript':
      case 'TokenUid':
      case 'VertexId':
        return this.toBytes(value);
      case 'Address':
        return this.toAddress(value);
      case 'int':
      case 'Timestamp':
        return this.toInt(value);
      case 'Amount':
        return this.toAmount(value);
      case 'float':
        return this.toFloat(value);
      case 'bool':
        return this.toBool(value);
      default:
        throw new Error('Invalid type.');
    }
  }

  /* eslint-disable class-methods-use-this -- XXX: Methods that don't use `this` should be made static */

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
   * Deserialize amount value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAmount(value: Buffer): OutputValueType {
    return this.toInt(value);
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
    }
    return false;
  }
  /* eslint-enable class-methods-use-this */

  /**
   * Deserialize an optional value
   *
   * First we check the first byte. If it's 0, then we return null.
   *
   * Otherwise, we deserialize the rest of the buffer to the type.
   *
   * @param {value} Buffer with the optional value
   * @param {type} Type of the optional without the ?
   *
   * @memberof Deserializer
   * @inner
   */
  toOptional(value: Buffer, type: string): NanoContractArgumentType | null {
    if (value[0] === 0) {
      // It's an empty optional
      return null;
    }

    // Remove the first byte to deserialize the value, since it's not empty
    const valueToDeserialize = value.slice(1);
    return this.deserializeFromType(valueToDeserialize, type);
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
    // Get signed data type inside []
    const match = type.match(/\[(.*?)\]/);
    const valueType = match ? match[1] : null;
    if (!valueType) {
      throw new Error('Unable to extract type');
    }

    let signedBuffer: Buffer;
    let size: number;
    // [len(serializedResult)][serializedResult][inputData]
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [size, signedBuffer] = unpackToInt(2, false, signedData);
    let parsed = this.deserializeFromType(signedBuffer.slice(0, size), valueType);
    if (valueType === 'bytes') {
      // If the value is bytes, we should transform into hex to return the string
      parsed = (parsed as Buffer).toString('hex');
    }
    signedBuffer = signedBuffer.slice(size);
    return `${bufferToHex(signedBuffer)},${parsed},${valueType}`;
  }

  /**
   * Deserialize a value decoded in bytes to a base58 string
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAddress(value: Buffer): string {
    // First we get the 20 bytes of the address without the version byte and checksum
    const addressBytes = value.slice(1, 21);
    const address = helpersUtils.encodeAddress(addressBytes, this.network);
    const decoded = address.decode();
    if (decoded[0] !== value[0]) {
      throw new Error(`Asked to deserialize an address with version byte ${value[0]} but the network from the deserializer object has version byte ${decoded[0]}.`);
    }
    return address.base58;
  }
}

export default Deserializer;
