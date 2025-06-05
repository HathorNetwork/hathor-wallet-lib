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
import { leb128 } from './encoding';

export class AmountField extends NCFieldBase<number | bigint | string, bigint> {
  value: bigint;

  constructor(value: bigint) {
    super();
    this.value = value;
  }

  static new(value: bigint = 0n): AmountField {
    return new AmountField(value);
  }

  getType() {
    return 'Amount';
  }

  fromBuffer(buf: Buffer): BufferROExtract<bigint> {
    const parsed = leb128.decode_unsigned(buf);
    this.value = parsed.value;
    return parsed;
  }

  toBuffer(): Buffer {
    return leb128.encode_unsigned(this.value);
  }

  fromUser(data: unknown): AmountField {
    const value = z.coerce.bigint().positive().parse(data);
    this.value = value;
    return this;
  }

  toUser(): string {
    return String(this.value);
  }
}
