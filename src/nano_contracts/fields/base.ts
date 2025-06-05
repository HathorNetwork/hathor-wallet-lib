/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { BufferROExtract } from '../types';

export abstract class NCFieldBase<U = unknown, T = unknown> {
  value: unknown;

  /**
   * Read an instance of the field from a buffer
   */
  abstract fromBuffer(buffer: Buffer, options?: unknown): BufferROExtract<T>;

  /**
   * Serialize field value into a buffer
   */
  abstract toBuffer(): Buffer;

  /**
   * Parse field from user value.
   */
  abstract fromUser(data: unknown): NCFieldBase;

  /**
   * Show the value as user readable.
   */
  abstract toUser(): U;

  /**
   * Get an identifier for the field class.
   * This may not be the same as the field type since
   * some types use the same field, e.g. bytes, TxOutputScript are both BytesField.
   */
  abstract getType(): string;
}
