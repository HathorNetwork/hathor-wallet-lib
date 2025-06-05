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
import { signedIntToBytes, unpackToInt } from '../../utils/buffer';

export class TimestampField extends NCFieldBase<number, number> {
  value: number;

  constructor(value: number) {
    super();
    this.value = value;
  }

  static new(): TimestampField {
    return new TimestampField(0);
  }

  getType() {
    return 'Timestamp';
  }

  clone() {
    return TimestampField.new();
  }

  fromBuffer(buf: Buffer): BufferROExtract<number> {
    const value = unpackToInt(4, true, buf)[0];
    this.value = value;
    return {
      value,
      bytesRead: 4,
    };
  }

  toBuffer(): Buffer {
    return signedIntToBytes(this.value, 4);
  }

  fromUser(data: unknown): TimestampField {
    const value = z.number().parse(data);
    this.value = value;
    return this;
  }

  toUser(): number {
    return this.value;
  }
}
