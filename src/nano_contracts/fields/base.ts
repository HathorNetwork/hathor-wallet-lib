/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { BufferROExtract } from '../types';

export abstract class NCFieldBase<U = unknown, T = unknown> {
  value: unknown;

  abstract toBuffer(): Buffer;

  /**
   * Read an instance of the field from a buffer
   */
  abstract fromBuffer(buffer: Buffer, options?: unknown): BufferROExtract<T>;

  abstract toUser(): U;

  abstract fromUser(data: unknown): NCFieldBase;

  // abstract validate(value: T);
  // abstract validateFromUser(value: U);
}
