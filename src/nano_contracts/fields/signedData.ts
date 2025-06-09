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
import { BytesField } from './bytes';

export interface ISignedData {
  type: string;
  signature: Buffer;
  value: unknown;
}

export interface IUserSignedData {
  type: string;
  signature: string;
  value: unknown;
}

/**
 * A schema to validate that the user sent unknown data is a valid IUserSignedData.
 */
export const UserSignedDataSchema: z.ZodType<IUserSignedData, z.ZodTypeDef, unknown> = z
  .object({
    type: z.string(),
    signature: z.string().regex(/^[a-fA-F0-9]*$/),
    value: z.unknown(),
  })
  .transform(data => ({ ...data, value: data.value === undefined ? null : data.value }));

export class SignedDataField extends NCFieldBase<IUserSignedData, ISignedData> {
  value: ISignedData;

  inner: NCFieldBase;

  constructor(inner: NCFieldBase, type: string, signature: Buffer, value: unknown) {
    super();
    this.value = {
      type,
      signature,
      value,
    };
    this.inner = inner;
  }

  getType() {
    return 'SignedData';
  }

  static new(inner: NCFieldBase, type: string): SignedDataField {
    return new SignedDataField(inner, type, Buffer.alloc(0), undefined);
  }

  createNew() {
    return SignedDataField.new(this.inner.createNew(), this.value.type);
  }

  fromBuffer(buf: Buffer): BufferROExtract<ISignedData> {
    const result = this.inner.fromBuffer(buf);
    const sigBuf = buf.subarray(result.bytesRead);
    const sigResult = BytesField.new().fromBuffer(sigBuf);

    this.value.signature = sigResult.value;
    this.value.value = result.value;
    return {
      value: { ...this.value },
      bytesRead: result.bytesRead + sigResult.bytesRead,
    };
  }

  toBuffer(): Buffer {
    const signature = new BytesField(this.value.signature);

    return Buffer.concat([this.inner.toBuffer(), signature.toBuffer()]);
  }

  fromUser(data: unknown): SignedDataField {
    const parsed = UserSignedDataSchema.parse(data);
    if (parsed.type !== this.value.type) {
      throw new Error(`Expected ${this.value.type} but received ${parsed.type}`);
    }
    this.inner.fromUser(parsed.value);

    const signature = z
      .string()
      .regex(/^[a-fA-F0-9]*$/)
      .transform(s => Buffer.from(s, 'hex'))
      .parse(parsed.signature);

    this.value = {
      type: parsed.type,
      signature,
      value: this.inner.value,
    };
    return this;
  }

  toUser(): IUserSignedData {
    return {
      type: this.value.type,
      signature: this.value.signature.toString('hex'),
      value: this.inner.toUser(),
    };
  }
}
