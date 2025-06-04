/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { NATIVE_TOKEN_UID } from '../../constants';
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import { sizedBytes } from './encoding';

const TokenUidSchema = z.union([z.literal('00'), z.string().regex(/^[a-fA-F0-9]{64}$/)]);

export class TokenUidField extends NCFieldBase<string, string> {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  static new(value: string = NATIVE_TOKEN_UID): TokenUidField {
    return new TokenUidField(value);
  }

  fromBuffer(buf: Buffer): BufferROExtract<string> {
    if (buf[0] === 0x00) {
      this.value = NATIVE_TOKEN_UID;
      return {
        value: NATIVE_TOKEN_UID,
        bytesRead: 1,
      };
    }
    if (buf[0] === 0x01) {
      const parsed = sizedBytes.decode(32, buf.subarray(1));
      const value = parsed.value.toString('hex');
      this.value = value;
      return {
        value,
        bytesRead: 33,
      };
    }
    throw new Error('Invalid TokenUid tag');
  }

  toBuffer(): Buffer {
    TokenUidSchema.parse(this.value);
    if (this.value === NATIVE_TOKEN_UID) {
      return Buffer.from([0]);
    }
    return Buffer.concat([Buffer.from([1]), Buffer.from(this.value, 'hex')]);
  }

  fromUser(data: unknown): TokenUidField {
    const value = TokenUidSchema.parse(data);
    this.value = value;
    return this;
  }

  toUser(): string {
    return this.value;
  }
}
