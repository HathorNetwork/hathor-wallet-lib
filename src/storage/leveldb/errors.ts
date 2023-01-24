/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export const KEY_NOT_FOUND_MESSAGE = 'NotFound';
export const KEY_NOT_FOUND_CODE = 'LEVEL_NOT_FOUND';

export function errorCodeOrNull(err: unknown): string|null {
  if(typeof err === 'object' && err !== null && 'code' in err && err.code !== undefined) {
    return err.code as string;
  }

  if (err instanceof Error) {
    if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
      return KEY_NOT_FOUND_CODE;
    }
  }

  return null;
}
