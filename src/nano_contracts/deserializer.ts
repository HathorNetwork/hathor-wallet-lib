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
  NanoContractArgumentSingleTypeName,
  NanoContractArgumentSingleTypeNameSchema,
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
   * @param buf Value to deserialize
   * @param type Type of the value to be deserialized
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
      case 'RawSignedData':
      case 'SignedData':
        return this.toSignedData(buf, internalType);
      case 'Tuple':
        return this.toTuple(buf, internalType);
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
    const parsed = this.toBytes(buf);
    return {
      value: parsed.value.toString('utf8'),
      bytesRead: parsed.bytesRead,
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
    // INFO: maxBytes is set to 3 because the max allowed length in bytes for a string is
    // NC_ARGS_MAX_BYTES_LENGTH which is encoded as 3 bytes in leb128 unsigned.
    // If we read a fourth byte we are definetely reading a higher number than allowed.
    const {
      value: lengthBN,
      rest,
      bytesRead: bytesReadForLength,
    } = leb128Util.decodeUnsigned(buf, 3);
    if (lengthBN > BigInt(NC_ARGS_MAX_BYTES_LENGTH)) {
      throw new Error('length in bytes is higher than max allowed');
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
   * An Address is serialized as:
   * - leb128 unsigned length (should always be 25, using 1 byte)
   * - 1 Network version byte
   * - 20 bytes for hash160 (hash of either pubkey[P2PKH] or script[P2SH])
   * - 4 bytes of checksum
   * Totaling 26 bytes.
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
    // The actual address bytes are the 25 bytes after the initial length
    const addressBytes = buf.subarray(1);
    // First we get the 20 bytes (hash) of the address without the version byte and checksum
    const hashBytes = addressBytes.subarray(1, 21);
    const address = helpersUtils.encodeAddress(hashBytes, this.network);
    address.validateAddress();
    const decoded = address.decode();
    // We need to check that the metadata of the address received match the one we generated
    // Check network version
    if (decoded[0] !== addressBytes[0]) {
      throw new Error(
        `Asked to deserialize an address with version byte ${addressBytes[0]} but the network from the deserializer object has version byte ${decoded[0]}.`
      );
    }
    // Check checksum bytes
    const calcChecksum = decoded.subarray(21, 25);
    const recvChecksum = addressBytes.subarray(21, 25);
    if (!calcChecksum.equals(recvChecksum)) {
      // Checksum value generated does not match value from fullnode
      throw new Error(
        `When parsing and Address(${address.base58}) we calculated checksum(${calcChecksum.toString('hex')}) but it does not match the checksum it came with ${recvChecksum.toString('hex')}.`
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
  toOptional(buf: Buffer, type: NanoContractArgumentSingleTypeName): BufferROExtract<NanoContractArgumentType> {
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
   * @param type Type of the signed value, e.g., For SignedData[str] this would receive str
   *
   * @memberof Deserializer
   * @inner
   */
  toSignedData(signedData: Buffer, type: NanoContractArgumentSingleTypeName): BufferROExtract<NanoContractSignedData> {
    // The SignedData is serialized as `data+Signature`

    // Reading argument
    const parseResult = this.deserializeFromType(signedData, type);
    const parsed = parseResult.value;
    const bytesReadFromValue = parseResult.bytesRead;

    const buf = signedData.subarray(bytesReadFromValue);

    // Reading signature as bytes
    const { value: parsedSignature, bytesRead: bytesReadFromSignature } = this.deserializeFromType(
      buf,
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
   * Deserialize tuple of values.
   * It does not support chained container types, meaning Tuple[Dict[str,str]] should not happen.
   *
   * @param buf Value to deserialize
   * @param type Comma separated types, e.g. `str,int,VarInt`
   *
   * @memberof Deserializer
   * @inner
   */
  toTuple(buf: Buffer, type: string): BufferROExtract<NanoContractArgumentSingleType[]> {
    const typeArr = type.split(',').map(s => NanoContractArgumentSingleTypeNameSchema.parse(s.trim()));
    const tupleValues: NanoContractArgumentSingleType[] = [];
    let bytesReadTotal = 0;
    let tupleBuf = buf.subarray();
    for (const t of typeArr) {
      const result = this.deserializeFromType(tupleBuf, t);
      tupleValues.push(result.value as NanoContractArgumentSingleType);
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
