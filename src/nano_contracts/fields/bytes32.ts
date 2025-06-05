/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getType"] }] */

import { z } from 'zod';
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import { sizedBytes } from './encoding';

export class Bytes32Field extends NCFieldBase<string, Buffer> {
  value: Buffer;

  constructor(value: Buffer) {
    super();
    this.value = value;
  }

  static new(value: Buffer | null = null): Bytes32Field {
    if (value === null) {
      return new Bytes32Field(Buffer.alloc(0));
    }
    return new Bytes32Field(value);
  }

  getType() {
    return 'bytes32';
  }

  fromBuffer(buf: Buffer): BufferROExtract<Buffer> {
    const parsed = sizedBytes.decode(32, buf);
    this.value = parsed.value;
    return parsed;
  }

  toBuffer(): Buffer {
    return sizedBytes.encode(32, this.value);
  }

  fromUser(data: unknown): Bytes32Field {
    const value = z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .parse(data);
    this.value = Buffer.from(value, 'hex');
    return this;
  }

  toUser(): string {
    return this.value.toString('hex');
  }
}
