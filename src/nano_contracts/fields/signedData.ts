/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import { BytesField } from './bytes';

interface ISignedData {
  type: string;
  signature: Buffer;
  value: unknown;
}

export class SignedData extends NCFieldBase<ISignedData, ISignedData> {
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

  static new(inner: NCFieldBase, type: string): SignedData {
    return new SignedData(inner, type, Buffer.alloc(0), undefined);
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

  fromUser(data: ISignedData): SignedData {
    this.inner.fromUser(data.value);

    this.value = {
      ...data,
      value: this.inner.value,
    };
    return this;
  }

  toUser(): ISignedData {
    return {
      signature: this.value.signature,
      type: this.value.type,
      value: this.inner.value,
    };
  }
}
