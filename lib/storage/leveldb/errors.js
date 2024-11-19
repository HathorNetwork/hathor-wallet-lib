"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.KEY_NOT_FOUND_MESSAGE = exports.KEY_NOT_FOUND_CODE = void 0;
exports.errorCodeOrNull = errorCodeOrNull;
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const KEY_NOT_FOUND_MESSAGE = exports.KEY_NOT_FOUND_MESSAGE = 'NotFound';
const KEY_NOT_FOUND_CODE = exports.KEY_NOT_FOUND_CODE = 'LEVEL_NOT_FOUND';
function errorCodeOrNull(err) {
  if (typeof err === 'object' && err !== null && 'code' in err && err.code !== undefined) {
    return err.code;
  }
  if (err instanceof Error) {
    if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
      return KEY_NOT_FOUND_CODE;
    }
  }
  return null;
}