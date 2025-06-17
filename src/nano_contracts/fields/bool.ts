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
import { bool } from './encoding';

export class BoolField extends NCFieldBase<boolean | string, boolean> {
  value: boolean;

  constructor(value: boolean) {
    super();
    this.value = value;
  }

  getType() {
    return 'bool';
  }

  static new(): BoolField {
    return new BoolField(false);
  }

  createNew() {
    return BoolField.new();
  }

  fromBuffer(buf: Buffer): BufferROExtract<boolean> {
    if (buf.length === 0) {
      throw new Error('No data left to read');
    }
    const result = bool.decode(buf);
    this.value = result.value;
    return result;
  }

  toBuffer(): Buffer {
    return bool.encode(this.value);
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
