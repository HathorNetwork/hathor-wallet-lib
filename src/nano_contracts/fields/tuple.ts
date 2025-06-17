/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getType"] }] */

import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';

export class TupleField extends NCFieldBase<unknown[], unknown[]> {
  value: unknown[];

  elements: NCFieldBase[];

  constructor(elements: NCFieldBase[], value: unknown[]) {
    super();
    this.value = value;
    this.elements = elements;
  }

  getType() {
    return 'Tuple';
  }

  static new(elements: NCFieldBase[]): TupleField {
    return new TupleField(elements, []);
  }

  createNew() {
    return TupleField.new(this.elements.map(el => el.createNew()));
  }

  fromBuffer(buf: Buffer): BufferROExtract<unknown[]> {
    const values: unknown[] = [];
    let bytesReadTotal = 0;
    let tupleBuf = buf.subarray();
    for (const el of this.elements) {
      const result = el.fromBuffer(tupleBuf);
      values.push(result.value);
      bytesReadTotal += result.bytesRead;
      tupleBuf = tupleBuf.subarray(result.bytesRead);
    }
    this.value = values;
    return {
      value: values,
      bytesRead: bytesReadTotal,
    };
  }

  toBuffer(): Buffer {
    const serialized: Buffer[] = [];
    for (const el of this.elements) {
      serialized.push(el.toBuffer());
    }
    return Buffer.concat(serialized);
  }

  fromUser(data: unknown): TupleField {
    function isArray(d: unknown): d is Array<unknown> {
      return typeof d === 'object' && d != null && Array.isArray(d);
    }
    if (!isArray(data)) {
      throw new Error('Provided data is not iterable, so it cannot be a list.');
    }
    const values: unknown[] = [];
    if (this.elements.length !== data.length) {
      throw new Error('Mismatched number of values from type');
    }
    for (const [index, el] of this.elements.entries()) {
      el.fromUser(data[index]);
      values.push(el.value);
    }
    this.value = values;
    return this;
  }

  toUser(): unknown[] {
    return this.elements.map(el => el.toUser());
  }
}
