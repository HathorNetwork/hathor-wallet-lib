/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  NanoContractArgumentSingleType,
  NanoContractArgumentType,
  NanoContractParsedArgument,
  NanoContractRawSignedData,
  NanoContractSignedData,
  BufferROExtract,
  NanoContractArgumentApiInputType,
} from './types';
import Serializer from './serializer';
import Deserializer from './deserializer';
import { getContainerInternalType, getContainerType } from './utils';

export class NanoContractMethodArgument {
  name: string;

  type: string;

  value: NanoContractArgumentType;

  _serialized: Buffer;

  constructor(name: string, type: string, value: NanoContractArgumentType) {
    this.name = name;
    this.type = type;
    this.value = value;
    this._serialized = Buffer.alloc(0);
  }

  serialize(serializer: Serializer): Buffer {
    if (this._serialized.length === 0) {
      this._serialized = serializer.serializeFromType(this.value, this.type);
    }

    return this._serialized;
  }

  static fromSerialized(
    name: string,
    type: string,
    buf: Buffer,
    deserializer: Deserializer
  ): BufferROExtract<NanoContractMethodArgument> {
    const parseResult = deserializer.deserializeFromType(buf, type);
    return {
      value: new NanoContractMethodArgument(name, type, parseResult.value),
      bytesRead: parseResult.bytesRead,
    };
  }

  /**
   * User input and api serialized input may not be encoded in the actual value type.
   *
   * ## SignedData
   * We expect the value as a string separated by comma (,) with 4 elements
   * (signature, ncID, value, type)
   * Since the value is encoded as a string some special cases apply:
   * - bool: 'true' or 'false'.
   * - bytes (and any bytes encoded value): hex encoded string of the byte value.
   *
   * While the value should be the NanoContractSignedDataSchema
   *
   * ## RawSignedData
   * We expect the value as a string separated by comma (,) with 3 elements
   * (signature, value, type)
   *
   * While the value should be the NanoContractRawSignedDataSchema
   */
  static fromApiInput(
    name: string,
    type: string,
    value: NanoContractArgumentApiInputType
  ): NanoContractMethodArgument {
    const isContainerType = getContainerType(type) !== null;
    if (isContainerType) {
      const [containerType, innerType] = getContainerInternalType(type);
      if (containerType === 'SignedData') {
        // Parse string SignedData into NanoContractSignedData
        const splittedValue = (value as string).split(',');
        if (splittedValue.length !== 4) {
          throw new Error();
        }
        const [signature, ncId, val, valType] = splittedValue;
        if (valType.trim() !== innerType.trim()) {
          throw new Error();
        }

        let finalValue: NanoContractArgumentSingleType = val;
        if (innerType === 'bytes') {
          finalValue = Buffer.from(val, 'hex');
        } else if (innerType === 'bool') {
          // If the result is expected as boolean, it will come here as a string true/false
          finalValue = val === 'true';
        } else if (innerType === 'int') {
          finalValue = Number.parseInt(val, 10);
        } else if (innerType === 'VarInt') {
          finalValue = BigInt(val);
        } else {
          // For the other types
          finalValue = val;
        }

        const data: NanoContractSignedData = {
          type: innerType,
          value: [Buffer.from(ncId, 'hex'), finalValue],
          signature: Buffer.from(signature, 'hex'),
        };
        return new NanoContractMethodArgument(name, type, data);
      }
      if (containerType === 'RawSignedData') {
        // Parse string RawSignedData into NanoContractRawSignedData
        const splittedValue = (value as string).split(',');
        if (splittedValue.length !== 3) {
          throw new Error();
        }
        const [signature, val, valType] = splittedValue;
        if (valType.trim() !== innerType.trim()) {
          throw new Error();
        }

        let finalValue: NanoContractArgumentSingleType = val;
        if (innerType === 'bytes') {
          finalValue = Buffer.from(val, 'hex');
        } else if (innerType === 'bool') {
          // If the result is expected as boolean, it will come here as a string true/false
          finalValue = val === 'true';
        } else if (innerType === 'int') {
          finalValue = Number.parseInt(val, 10);
        } else if (innerType === 'VarInt') {
          finalValue = BigInt(val);
        } else {
          // For the other types
          finalValue = val;
        }

        const data: NanoContractRawSignedData = {
          type: innerType,
          value: finalValue,
          signature: Buffer.from(signature, 'hex'),
        };
        return new NanoContractMethodArgument(name, type, data);
      }
      // XXX: Should we have a special case for Optional, Tuple?
    }

    return new NanoContractMethodArgument(name, type, value);
  }

  toApiInput(): NanoContractParsedArgument {
    function prepSingleValue(type: string, value: NanoContractArgumentSingleType) {
      switch (type) {
        case 'bytes':
          return (value as Buffer).toString('hex');
        case 'bool':
          return (value as boolean) ? 'true' : 'false';
        default:
          return value;
      }
    }

    if (this.type.startsWith('SignedData')) {
      const data = this.value as NanoContractSignedData;
      return {
        name: this.name,
        type: this.type,
        parsed: [
          data.signature.toString('hex'),
          data.value[0].toString('hex'),
          prepSingleValue(data.type, data.value[1]),
          this.type,
        ].join(','),
      };
    }

    if (this.type.startsWith('RawSignedData')) {
      const data = this.value as NanoContractRawSignedData;
      return {
        name: this.name,
        type: this.type,
        parsed: [
          data.signature.toString('hex'),
          prepSingleValue(data.type, data.value),
          this.type,
        ].join(','),
      };
    }

    return {
      name: this.name,
      type: this.type,
      parsed: this.value,
    };
  }
}
