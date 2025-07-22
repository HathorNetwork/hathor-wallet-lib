/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getType"] }] */

import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import { leb128 } from './encoding';

export class CollectionField extends NCFieldBase<unknown[], unknown[]> {
  value: unknown[];

  kind: NCFieldBase;

  inner: NCFieldBase[];

  constructor(kind: NCFieldBase) {
    super();
    this.kind = kind;
    this.value = [];
    this.inner = [];
  }

  getType() {
    return 'Collection';
  }

  static new(kind: NCFieldBase): CollectionField {
    return new CollectionField(kind);
  }

  createNew() {
    return CollectionField.new(this.kind.createNew());
  }

  fromBuffer(buf: Buffer): BufferROExtract<unknown[]> {
    const values: unknown[] = [];
    let bytesReadTotal = 0;
    const lenRead = leb128.decode_unsigned(buf);
    const len = lenRead.value;

    let listBuf = buf.subarray(lenRead.bytesRead);
    for (let i = 0n; i < len; i++) {
      const field = this.kind.createNew();
      const result = field.fromBuffer(listBuf);
      values.push(result.value);
      bytesReadTotal += result.bytesRead;
      listBuf = listBuf.subarray(result.bytesRead);
      this.inner.push(field);
    }

    this.value = values;
    return {
      value: values,
      bytesRead: bytesReadTotal,
    };
  }

  toBuffer(): Buffer {
    const serialized: Buffer[] = [leb128.encode_unsigned(this.inner.length)];
    for (const el of this.inner) {
      serialized.push(el.toBuffer());
    }
    return Buffer.concat(serialized);
  }

  fromUser(data: unknown): CollectionField {
    function isIterable(d: unknown): d is Iterable<unknown> {
      return d != null && typeof d[Symbol.iterator] === 'function';
    }
    if (!isIterable(data)) {
      throw new Error('Provided data is not iterable, so it cannot be a list.');
    }
    const values: unknown[] = [];
    for (const el of data) {
      const field = this.kind.createNew();
      field.fromUser(el);
      values.push(field.value);
      this.inner.push(field);
    }
    this.value = values;
    return this;
  }

  toUser(): unknown[] {
    return this.inner.map(el => el.toUser());
  }
}
