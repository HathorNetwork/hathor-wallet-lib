/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Address from '../models/address';
import Network from '../models/network';
import { signedIntToBytes, bigIntToBytes } from '../utils/buffer';
import {
  NanoContractArgumentSingleTypeName,
  NanoContractArgumentSingleTypeNameSchema,
  NanoContractArgumentType,
  NanoContractSignedData,
} from './types';
import { OutputValueType } from '../types';
import leb128Util from '../utils/leb128';
import { getContainerInternalType, getContainerType } from './utils';
import { NATIVE_TOKEN_UID } from '../constants';

/* eslint-disable class-methods-use-this -- XXX: Methods that do not use `this` should be made static */
class Serializer {
  network: Network;

  constructor(network: Network) {
    this.network = network;
  }

  /**
   * Helper method to serialize any value from its type
   * We receive these type from the full node, so we
   * use the python syntax
   *
   * @param value Value to serialize
   * @param type Type of the value to be serialized
   *
   * @memberof Serializer
   * @inner
   */
  serializeFromType(value: NanoContractArgumentType, type: string): Buffer {
    const isContainerType = getContainerType(type) !== null;
    if (isContainerType) {
      return this.serializeContainerType(value, type);
    }

    switch (NanoContractArgumentSingleTypeNameSchema.parse(type)) {
      case 'str':
        return this.fromString(value as string);
      case 'bytes':
      case 'TxOutputScript':
        return this.fromBytes(value as Buffer);
      case 'BlueprintId':
      case 'ContractId':
      case 'VertexId':
        return this.fromSizedBytes(value as Buffer);
      case 'TokenUid':
        return this.fromTokenUid(value as Buffer);
      case 'Address':
        return this.fromAddress(value as string);
      case 'int':
      case 'Timestamp':
        return this.fromInt(value as number);
      case 'Amount':
        return this.fromAmount(value as OutputValueType);
      case 'bool':
        return this.fromBool(value as boolean);
      case 'VarInt':
        return this.fromVarInt(value as bigint);
      default:
        throw new Error(`Invalid type. ${type}.`);
    }
  }

  serializeContainerType(value: NanoContractArgumentType, type: string) {
    const [containerType, innerType] = getContainerInternalType(type);

    switch (containerType) {
      case 'Optional':
        return this.fromOptional(value, NanoContractArgumentSingleTypeNameSchema.parse(innerType));
      case 'RawSignedData':
      case 'SignedData':
        return this.fromSignedData(
          value as NanoContractSignedData,
          NanoContractArgumentSingleTypeNameSchema.parse(innerType)
        );
      case 'Tuple':
        return this.fromTuple(
          value as NanoContractArgumentType[],
          NanoContractArgumentSingleTypeNameSchema.array().parse(innerType)
        );
      default:
        throw new Error('Invalid type');
    }
  }

  /**
   * Serialize string value.
   * - length (leb128 integer)
   * - string in utf8
   *
   * @param value Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromString(value: string): Buffer {
    const buf = Buffer.from(value, 'utf8');
    return Buffer.concat([leb128Util.encodeUnsigned(buf.length), buf]);
  }

  /**
   * Serialize base58 address into bytes.
   *
   * @param value base58 address to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromAddress(value: string): Buffer {
    const address = new Address(value, { network: this.network });
    address.validateAddress();
    return this.fromBytes(address.decode());
  }

  /**
   * Serialize bytes value
   *
   * @param value Value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromBytes(value: Buffer): Buffer {
    return Buffer.concat([leb128Util.encodeUnsigned(value.length), Buffer.from(value)]);
  }

  fromSizedBytes(value: Buffer): Buffer {
    return Buffer.from(value);
  }

  fromTokenUid(value: Buffer): Buffer {
    if (value.length === 1 && value[0] === 0x00) {
      return Buffer.from([0]);
    } else {
      return Buffer.concat([Buffer.from([1]), Buffer.from(value)]);
    }
  }

  /**
   * Serialize integer value
   *
   * @param value Value to serialize
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
   * @param value Value to serialize
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
   * Serialize boolean value
   *
   * @param value Value to serialize
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
   * Serialize a bigint value as a variable length integer.
   * The serialization will use leb128.
   *
   * @param {bigint} value
   *
   * @memberof Serializer
   */
  fromVarInt(value: bigint): Buffer {
    return leb128Util.encodeSigned(value);
  }
  /* eslint-disable class-methods-use-this */

  /**
   * Serialize an optional value
   *
   * If value is null, then it's a buffer with 0 only. If it's not null,
   * we create a buffer with 1 in the first byte and the serialized value
   * in the sequence.
   *
   * @param value Value to serialize. If not, the optional is empty
   * @param type Type of the value to serialize
   *
   * @memberof Serializer
   * @inner
   */
  fromOptional(value: NanoContractArgumentType, type: NanoContractArgumentSingleTypeName): Buffer {
    if (value === null) {
      return Buffer.from([0]);
    }

    if (value === undefined || !type) {
      throw new Error('Missing value or type in non empty optional.');
    }

    return Buffer.concat([
      Buffer.from([1]), // Indicator of having value
      this.serializeFromType(value, type), // Actual value serialized
    ]);
  }

  /**
   * Serialize a signed value
   * We expect the value as a string separated by comma (,)
   * with 3 elements (inputData, value, type)
   *
   * The serialization will be
   * [len(serializedValue)][serializedValue][inputData]
   *
   * @param signedValue String value with inputData, value, and type separated by comma
   *
   * @memberof Serializer
   * @inner
   */
  fromSignedData(signedValue: NanoContractSignedData, type: string): Buffer {
    const ret: Buffer[] = [];
    if (signedValue.type !== type) {
      throw new Error('type mismatch');
    }

    const serialized = this.serializeFromType(signedValue.value, signedValue.type);
    ret.push(serialized);
    const signature = this.serializeFromType(signedValue.signature, 'bytes');
    ret.push(signature);

    return Buffer.concat(ret);
  }

  /**
   * Serialize a tuple of values
   *
   * @param value List of values to serialize
   * @param typeArr List of types to serialize the values
   *
   * @example
   * ```
   * const serializer = Serializer(new Network('testnet'));
   *
   * const type = 'Tuple[str,int]';
   * const typeArr = ['str', 'int'];
   * const buf = serializer.fromTuple(['1x0', 5], typeStr);
   * ```
   *
   * @memberof Serializer
   * @inner
   */
  fromTuple(
    value: NanoContractArgumentType[],
    typeArr: NanoContractArgumentSingleTypeName[]
  ): Buffer {
    const serialized: Buffer[] = [];
    if (typeArr.length !== value.length) {
      throw new Error('Tuple value with length mismatch, required ');
    }
    for (const [index, type] of typeArr.entries()) {
      serialized.push(this.serializeFromType(value[index], type));
    }
    return Buffer.concat(serialized);
  }
}

export default Serializer;
