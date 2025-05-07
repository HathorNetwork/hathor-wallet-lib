/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { bufferToHex, unpackToInt } from '../utils/buffer';
import helpersUtils from '../utils/helpers';
import leb128Util from '../utils/leb128';
import Network from '../models/network';
import { NanoContractArgumentType } from './types';
import { OutputValueType } from '../types';
import { NC_ARGS_MAX_BYTES_LENGTH } from '../constants';
import { getContainerInternalType, getContainerType } from './utils';

interface DeserializeResult<T> {
  value: T;
  bytesRead: number;
}

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
   * @param {Buffer} buf Value to deserialize
   * @param {string} type Type of the value to be deserialized
   *
   * @memberof Deserializer
   * @inner
   */
  deserializeFromType(
    buf: Buffer,
    type: string
  ): DeserializeResult<NanoContractArgumentType | null> {
    const isContainerType = getContainerType(type) !== null;
    if (isContainerType) {
      return this.deserializeContainerType(buf, type);
    }

    switch (type) {
      case 'str':
        return this.toString(buf);
      case 'bytes':
      case 'BlueprintId':
      case 'ContractId':
      case 'TokenUid':
      case 'TxOutputScript':
      case 'VertexId':
        return this.toBytes(buf);
      case 'Address':
        return this.toAddress(buf);
      case 'int':
      case 'Timestamp':
        return this.toInt(buf);
      case 'Amount':
        return this.toAmount(buf);
      case 'bool':
        return this.toBool(buf);
      case 'VarInt':
        return this.toVarInt(buf);
      default:
        throw new Error('Invalid type.');
    }
  }

  deserializeContainerType(
    buf: Buffer,
    type: string
  ): DeserializeResult<NanoContractArgumentType | null> {
    const [containerType, internalType] = getContainerInternalType(type);

    switch (containerType) {
      case 'Optional':
        return this.toOptional(buf, internalType);
      case 'SignedData':
        return this.toSigned(buf, type); // XXX: change to internalType?
      default:
        throw new Error('Invalid type.');
    }
  }

  /* eslint-disable class-methods-use-this -- XXX: Methods that don't use `this` should be made static */

  /**
   * Deserialize string value
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toString(buf: Buffer): DeserializeResult<string> {
    // INFO: maxBytes is set to 3 becuase the max allowed length in bytes for a string is
    // NC_ARGS_MAX_BYTES_LENGTH which is encoded as 3 bytes in leb128 unsigned.
    // If we read a fourth byte we are definetely reading a higher number than allowed.
    const {
      value: lengthBN,
      rest,
      bytesRead: bytesReadForLength,
    } = leb128Util.decodeUnsigned(buf, 3);
    if (lengthBN > NC_ARGS_MAX_BYTES_LENGTH) {
      throw new Error('String length in bytes is higher than max allowed');
    }
    // If lengthBN is lower than 64 KiB than its safe to convert to Number
    const length = Number(lengthBN);
    if (rest.length < length) {
      throw new Error('Do not have enough bytes to read the expected length');
    }
    return {
      value: rest.subarray(0, length).toString('utf8'),
      bytesRead: length + bytesReadForLength,
    };
  }

  /**
   * Deserialize bytes value
   *
   * @param buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toBytes(buf: Buffer): DeserializeResult<Buffer> {
    // INFO: maxBytes is set to 3 becuase the max allowed length in bytes for a string is
    // NC_ARGS_MAX_BYTES_LENGTH which is encoded as 3 bytes in leb128 unsigned.
    // If we read a fourth byte we are definetely reading a higher number than allowed.
    const {
      value: lengthBN,
      rest,
      bytesRead: bytesReadForLength,
    } = leb128Util.decodeUnsigned(buf, 3);
    if (lengthBN > BigInt(NC_ARGS_MAX_BYTES_LENGTH)) {
      throw new Error('String length in bytes is higher than max allowed');
    }
    // If lengthBN is lower than 64 KiB than its safe to convert to Number
    const length = Number(lengthBN);
    if (rest.length < length) {
      throw new Error('Do not have enough bytes to read the expected length');
    }
    return {
      value: rest.subarray(0, length),
      bytesRead: length + bytesReadForLength,
    };
  }

  /**
   * Deserialize int value
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toInt(buf: Buffer): DeserializeResult<number> {
    return {
      value: unpackToInt(4, true, buf)[0],
      bytesRead: 4,
    };
  }

  /**
   * Deserialize amount value
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAmount(buf: Buffer): DeserializeResult<OutputValueType> {
    // Nano `Amount` currently only supports up to 4 bytes, so we simply use the `number` value converted to `BigInt`.
    // If we change Nano to support up to 8 bytes, we must update this.
    const { value, bytesRead } = this.toInt(buf);
    return {
      value: BigInt(value),
      bytesRead,
    };
  }

  /**
   * Deserialize boolean value
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toBool(buf: Buffer): DeserializeResult<boolean> {
    if (buf[0]) {
      return {
        value: true,
        bytesRead: 1,
      };
    }
    return {
      value: false,
      bytesRead: 1,
    };
  }

  /**
   * Deserialize a variable integer encoded as a leb128 buffer to a bigint.
   *
   * @param buf Value to deserialize
   *
   * @memberof Deserializer
   */
  toVarInt(buf: Buffer): DeserializeResult<bigint> {
    const { value, bytesRead } = leb128Util.decodeSigned(buf);
    return { value, bytesRead };
  }

  /* eslint-enable class-methods-use-this */

  /**
   * Deserialize an optional value
   *
   * First we check the first byte. If it's 0, then we return null.
   *
   * Otherwise, we deserialize the rest of the buffer to the type.
   *
   * @param {Buffer} buf Buffer with the optional value
   * @param {string} type Type of the optional without the ?
   *
   * @memberof Deserializer
   * @inner
   */
  toOptional(buf: Buffer, type: string): DeserializeResult<NanoContractArgumentType | null> {
    if (buf[0] === 0) {
      // It's an empty optional
      return {
        value: null,
        bytesRead: 1,
      };
    }

    // Remove the first byte to deserialize the value, since it's not empty
    const valueToDeserialize = buf.subarray(1);
    const result = this.deserializeFromType(valueToDeserialize, type);
    return {
      value: result.value,
      bytesRead: result.bytesRead + 1,
    };
  }

  /**
   * Deserialize a signed value
   *
   * The signedData what will be deserialized is
   * [len(serializedValue)][serializedValue][inputData]
   *
   * @param signedData Buffer with serialized signed value
   * @param type Type of the signed value, with the subtype, e.g., SignedData[str]
   *
   * @memberof Deserializer
   * @inner
   */
  toSigned(signedData: Buffer, type: string): DeserializeResult<string> {
    const [containerType, internalType] = getContainerInternalType(type);
    if (containerType !== 'SignedData') {
      throw new Error('Type is not SignedData');
    }
    if (!internalType) {
      throw new Error('Unable to extract type');
    }
    // Should we check that the valueType is valid?

    // SignData[T] is serialized as Serialize(T)+Serialize(sign(T)) where sign() returns a byte str
    // Which means we can parse the T argument, then read the bytes after.

    // Reading argument
    const parseResult = this.deserializeFromType(signedData, internalType);
    let parsed = parseResult.value;
    const bytesReadFromValue = parseResult.bytesRead;

    if (internalType === 'bytes') {
      // If the value is bytes, we should transform into hex to return the string
      parsed = bufferToHex(parsed as Buffer);
    }

    if (internalType === 'bool') {
      parsed = (parsed as boolean) ? 'true' : 'false';
    }

    // Reading signature
    const { value: parsedSignature, bytesRead: bytesReadFromSignature } = this.deserializeFromType(
      signedData.subarray(bytesReadFromValue),
      'bytes'
    );

    return {
      value: `${bufferToHex(parsedSignature as Buffer)},${parsed},${internalType}`,
      bytesRead: bytesReadFromValue + bytesReadFromSignature,
    };
  }

  /**
   * Deserialize a value decoded in bytes to a base58 string
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAddress(buf: Buffer): DeserializeResult<string> {
    // First we get the 20 bytes of the address without the version byte and checksum
    const addressBytes = buf.subarray(1, 21);
    const address = helpersUtils.encodeAddress(addressBytes, this.network);
    const decoded = address.decode();
    if (decoded[0] !== buf[0]) {
      throw new Error(
        `Asked to deserialize an address with version byte ${buf[0]} but the network from the deserializer object has version byte ${decoded[0]}.`
      );
    }
    return {
      value: address.base58,
      bytesRead: 21,
    };
  }
}

export default Deserializer;
