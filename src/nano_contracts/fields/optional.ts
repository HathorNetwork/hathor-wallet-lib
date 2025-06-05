/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';

export class OptionalField extends NCFieldBase<unknown | null, unknown | null> {
  value: unknown | null;

  inner: NCFieldBase;

  constructor(inner: NCFieldBase, value: unknown | null) {
    super();
    this.value = value;
    this.inner = inner;
  }

  get is_null() {
    return this.value === null;
  }

  static new(inner: NCFieldBase): OptionalField {
    return new OptionalField(inner, null);
  }

  getType() {
    return 'Optional';
  }

  fromBuffer(buf: Buffer): BufferROExtract<unknown | null> {
    if (buf[0] === 0) {
      this.value = null;
      return {
        value: null,
        bytesRead: 1,
      };
    }
    const parsed = this.inner.fromBuffer(buf.subarray(1));
    this.value = parsed.value;
    return {
      value: parsed.value,
      bytesRead: parsed.bytesRead + 1,
    };
  }

  toBuffer(): Buffer {
    if (this.is_null) {
      return Buffer.from([0]);
    }
    return Buffer.concat([Buffer.from([1]), this.inner.toBuffer()]);
  }

  fromUser(data: unknown | null): OptionalField {
    if (data === null) {
      this.value = null;
      return this;
    }
    this.inner.fromUser(data);
    this.value = this.inner.value;
    return this;
  }

  toUser(): unknown | null {
    if (this.is_null) {
      return null;
    }
    return this.inner.toUser();
  }
}
