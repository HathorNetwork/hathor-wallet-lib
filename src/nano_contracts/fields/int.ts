/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getType", "createNew"] }] */

import { z } from 'zod';
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import { leb128 } from './encoding';

export class IntField extends NCFieldBase<number | bigint | string, bigint> {
  value: bigint;

  schema = z.coerce.bigint();

  constructor(value: bigint) {
    super();
    this.value = value;
  }

  getType() {
    return 'int';
  }

  static new(): IntField {
    return new IntField(0n);
  }

  createNew() {
    return IntField.new();
  }

  fromBuffer(buf: Buffer): BufferROExtract<bigint> {
    const parsed = leb128.decode_signed(buf);
    this.value = parsed.value;
    return parsed;
  }

  toBuffer(): Buffer {
    return leb128.encode_signed(this.value);
  }

  fromUser(data: unknown): IntField {
    const value = this.schema.parse(data);
    this.value = value;
    return this;
  }

  toUser(): string {
    return String(this.value);
  }
}
