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
import { bytes } from './encoding';

export class BytesField extends NCFieldBase<string, Buffer> {
  value: Buffer;

  constructor(value: Buffer) {
    super();
    this.value = value;
  }

  static new(): BytesField {
    return new BytesField(Buffer.alloc(0));
  }

  getType() {
    return 'bytes';
  }

  clone() {
    return BytesField.new();
  }

  fromBuffer(buf: Buffer): BufferROExtract<Buffer> {
    const parsed = bytes.decode(buf);
    this.value = parsed.value;
    return parsed;
  }

  toBuffer(): Buffer {
    return bytes.encode(this.value);
  }

  fromUser(data: unknown): BytesField {
    const value = z
      .string()
      .regex(/^[a-fA-F0-9]*$/)
      .parse(data);
    this.value = Buffer.from(value, 'hex');
    return this;
  }

  toUser(): string {
    return this.value.toString('hex');
  }
}
