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

export class BoolField extends NCFieldBase<boolean | string, boolean> {
  value: boolean;

  constructor(value: boolean) {
    super();
    this.value = value;
  }

  static new(): BoolField {
    return new BoolField(false);
  }

  getType() {
    return 'bool';
  }

  clone() {
    return BoolField.new();
  }

  fromBuffer(buf: Buffer): BufferROExtract<boolean> {
    if (buf.length === 0) {
      throw new Error('No data left to read');
    }
    switch (buf[0]) {
      case 0:
        this.value = false;
        return {
          value: false,
          bytesRead: 1,
        };
      case 1:
        this.value = true;
        return {
          value: true,
          bytesRead: 1,
        };
      default:
        throw new Error('Invalid boolean tag');
    }
  }

  toBuffer(): Buffer {
    return Buffer.from([this.value ? 1 : 0]);
  }

  fromUser(data: unknown): BoolField {
    const value = z
      .boolean()
      .or(z.union([z.literal('true'), z.literal('false')]).transform(val => val === 'true'))
      .parse(data);

    this.value = value;
    return this;
  }

  toUser(): 'true' | 'false' {
    return this.value ? 'true' : 'false';
  }
}
