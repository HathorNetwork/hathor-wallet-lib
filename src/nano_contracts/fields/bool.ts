/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';

export class BoolField extends NCFieldBase<boolean | string, boolean> {
  value: boolean | null;

  constructor(value: boolean | null) {
    super();
    this.value = value;
  }

  static new(value: boolean | null = null): BoolField {
    return new BoolField(value);
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
    if (this.value === null) {
      throw new Error('Boolean cannot be null when serializing');
    }
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
    if (this.value === null) {
      throw new Error('Boolean cannot be null when serializing');
    }
    return this.value ? 'true' : 'false';
  }
}
