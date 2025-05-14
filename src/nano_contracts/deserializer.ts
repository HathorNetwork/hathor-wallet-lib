/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { unpackToInt } from '../utils/buffer';
import helpersUtils from '../utils/helpers';
import leb128Util from '../utils/leb128';
import Network from '../models/network';
import {
  NanoContractArgumentType,
  BufferROExtract,
  NanoContractSignedData,
  NanoContractArgumentSingleType,
  NanoContractRawSignedData,
} from './types';
import { OutputValueType } from '../types';
import { NC_ARGS_MAX_BYTES_LENGTH } from '../constants';
import { getContainerInternalType, getContainerType } from './utils';

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
  deserializeFromType(buf: Buffer, type: string): BufferROExtract<NanoContractArgumentType | null> {
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
  ): BufferROExtract<NanoContractArgumentType | null> {
    const [containerType, internalType] = getContainerInternalType(type);

    switch (containerType) {
      case 'Optional':
        return this.toOptional(buf, internalType);
      case 'SignedData':
        return this.toSignedData(buf, internalType);
      case 'RawSignedData':
      case 'Tuple':
        throw new Error('Not implemented yet');
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
  toString(buf: Buffer): BufferROExtract<string> {
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
  toBytes(buf: Buffer): BufferROExtract<Buffer> {
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
  toInt(buf: Buffer): BufferROExtract<number> {
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
  toAmount(buf: Buffer): BufferROExtract<OutputValueType> {
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
  toBool(buf: Buffer): BufferROExtract<boolean> {
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
  toVarInt(buf: Buffer): BufferROExtract<bigint> {
    const { value, bytesRead } = leb128Util.decodeSigned(buf);
    return { value, bytesRead };
  }

  /* eslint-enable class-methods-use-this */

  /**
   * Deserialize a value decoded in bytes to a base58 string
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAddress(buf: Buffer): BufferROExtract<string> {
    const lenReadResult = leb128Util.decodeUnsigned(buf, 1);
    if (lenReadResult.value !== 25n) {
      // Address should be exactly 25 bytes long
      throw new Error('Address should be 25 bytes long');
    }
    // First we get the 20 bytes of the address without the version byte and checksum
    const addressBytes = buf.subarray(2, 22);
    const address = helpersUtils.encodeAddress(addressBytes, this.network);
    address.validateAddress();
    const decoded = address.decode();
    if (decoded[0] !== buf[1]) {
      throw new Error(
        `Asked to deserialize an address with version byte ${buf[0]} but the network from the deserializer object has version byte ${decoded[0]}.`
      );
    }
    if (decoded.subarray(21, 25).toString('hex') !== buf.subarray(22, 26).toString('hex')) {
      // Checksum value generated does not match value from fullnode
      throw new Error(
        `When parsing and Address(${address.base58}) we calculated checksum(${decoded.subarray(21, 25).toString('hex')}) but it does not match the checksum it came with ${buf.subarray(22, 26).toString('hex')}.`
      );
    }
    return {
      value: address.base58,
      bytesRead: 26, // 1 for length + 25 address bytes
    };
  }

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
  toOptional(buf: Buffer, type: string): BufferROExtract<NanoContractArgumentType> {
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

  toSignedData(signedData: Buffer, type: string): BufferROExtract<NanoContractSignedData> {
    // The SignedData is serialized as `ContractId+data+Signature`

    // Reading ContractId
    const ncIdResult = this.deserializeFromType(signedData, 'ContractId');
    const ncId = ncIdResult.value as Buffer;
    const bytesReadFromContractId = ncIdResult.bytesRead;

    const buf = signedData.subarray(bytesReadFromContractId);

    // Reading argument
    const parseResult = this.deserializeFromType(buf, type);
    const parsed = parseResult.value;
    const bytesReadFromValue = parseResult.bytesRead;

    // Reading signature as bytes
    const { value: parsedSignature, bytesRead: bytesReadFromSignature } = this.deserializeFromType(
      buf.subarray(bytesReadFromValue),
      'bytes'
    );

    return {
      value: {
        type,
        ncId,
        value: parsed as NanoContractArgumentSingleType,
        signature: parsedSignature as Buffer,
      },
      bytesRead: bytesReadFromContractId + bytesReadFromValue + bytesReadFromSignature,
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
  toRawSignedData(signedData: Buffer, type: string): BufferROExtract<NanoContractRawSignedData> {
    // RawSignData[T] is serialized as Serialize(T)+Serialize(sign(T)) where sign() returns a byte str
    // Which means we can parse the T argument, then read the bytes after.

    // Reading argument
    const parseResult = this.deserializeFromType(signedData, type);
    const parsed = parseResult.value;
    const bytesReadFromValue = parseResult.bytesRead;

    // Reading signature
    const { value: parsedSignature, bytesRead: bytesReadFromSignature } = this.deserializeFromType(
      signedData.subarray(bytesReadFromValue),
      'bytes'
    );

    return {
      value: {
        type,
        value: parsed as NanoContractArgumentSingleType,
        signature: parsedSignature as Buffer,
      },
      bytesRead: bytesReadFromValue + bytesReadFromSignature,
    };
  }

  /**
   * Deserialize string value
   *
   * @param {Buffer} buf Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toTuple(buf: Buffer, type: string): BufferROExtract<Array<unknown>> {
    const typeArr = type.split(',').map(s => s.trim());
    const tupleValues: NanoContractArgumentType[] = [];
    let bytesReadTotal = 0;
    let tupleBuf = buf.subarray();
    for (const t of typeArr) {
      const result = this.deserializeFromType(tupleBuf, t);
      tupleValues.push(result.value);
      bytesReadTotal += result.bytesRead;
      tupleBuf = tupleBuf.subarray(result.bytesRead);
    }
    return {
      value: tupleValues,
      bytesRead: bytesReadTotal,
    };
  }
}

export default Deserializer;
