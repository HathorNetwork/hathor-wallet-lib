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
import { utf8 } from './encoding';

export class StrField extends NCFieldBase<string, string> {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  getType() {
    return 'str';
  }

  static new(): StrField {
    return new StrField('');
  }

  createNew() {
    return StrField.new();
  }

  fromBuffer(buf: Buffer): BufferROExtract<string> {
    const parsed = utf8.decode(buf);
    this.value = parsed.value;
    return parsed;
  }

  toBuffer(): Buffer {
    return utf8.encode(this.value);
  }

  fromUser(data: unknown): StrField {
    this.value = z.string().parse(data);
    return this;
  }

  toUser(): string {
    return this.value;
  }
}
