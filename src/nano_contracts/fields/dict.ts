/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getType"] }] */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import { leb128 } from './encoding';

export class DictField extends NCFieldBase<Record<any, unknown>, Record<any, unknown>> {
  value: unknown;

  keyField: NCFieldBase;

  valueField: NCFieldBase;

  // Save inner fields as entries array.
  inner: [NCFieldBase, NCFieldBase][];

  constructor(keyField: NCFieldBase, valueField: NCFieldBase) {
    super();
    this.value = undefined;
    this.keyField = keyField;
    this.valueField = valueField;
    this.inner = [];
  }

  static new(key: NCFieldBase, value: NCFieldBase): DictField {
    return new DictField(key, value);
  }

  getType() {
    return 'Dict';
  }

  clone() {
    return DictField.new(this.keyField, this.valueField);
  }

  fromBuffer(buf: Buffer): BufferROExtract<Record<any, unknown>> {
    this.inner = [];
    let bytesReadTotal = 0;
    const lenRead = leb128.decode_unsigned(buf);
    bytesReadTotal += lenRead.bytesRead;
    const len = lenRead.value;
    const values: Record<any, unknown> = {};
    let dictBuf = buf.subarray(lenRead.bytesRead);

    for (let i = 0n; i < len; i++) {
      const keyF = this.keyField.clone();
      const valueF = this.valueField.clone();

      const key = keyF.fromBuffer(dictBuf);
      dictBuf = dictBuf.subarray(key.bytesRead);
      bytesReadTotal += key.bytesRead;
      const val = valueF.fromBuffer(dictBuf);
      dictBuf = dictBuf.subarray(val.bytesRead);
      bytesReadTotal += val.bytesRead;

      values[key.value as any] = val.value;
      this.inner.push([keyF, valueF]);
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
      serialized.push(el[0].toBuffer());
      serialized.push(el[1].toBuffer());
    }
    return Buffer.concat(serialized);
  }

  fromUser(data: Record<any, unknown>): DictField {
    this.inner = [];
    const value: Record<any, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const keyF = this.keyField.clone();
      const valueF = this.valueField.clone();

      const key = keyF.fromUser(k);
      const val = valueF.fromUser(v);
      value[key.value as any] = val.value;
      this.inner.push([keyF, valueF]);
    }

    this.value = value;
    return this;
  }

  toUser(): Record<any, unknown> {
    return Object.fromEntries(this.inner.map(el => [el[0].toUser(), el[1].toUser()]));
  }
}
