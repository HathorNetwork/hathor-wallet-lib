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
} from './types';
import Serializer from './serializer';
import Deserializer from './deserializer';
import { getContainerInternalType } from './utils';

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
      this._serialized = serializer.serializeFromType(this.value, this.type)
    }

    return this._serialized
  }

  static fromSerialized(name: string, type: string, buf: Buffer, deserializer: Deserializer): BufferROExtract<NanoContractMethodArgument> {
    const parseResult = deserializer.deserializeFromType(buf, type);
    return {
      value: new NanoContractMethodArgument(name, type, parseResult.value),
      bytesRead: parseResult.bytesRead,
    }
  }

  toHumanReadable(): NanoContractParsedArgument {
    function prepSingleValue(type: string, value: NanoContractArgumentSingleType) {
      switch(type) {
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
      }
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
      }
    }
    
    return {
      name: this.name,
      type: this.type,
      parsed: this.value,
    }
  }
}
