'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.OP_PUSHDATA1 = exports.OP_CHECKSIG = exports.OP_EQUALVERIFY = exports.OP_HASH160 = exports.OP_DUP = exports.OP_GREATERTHAN_TIMESTAMP = undefined;

var _bitcoreLib = require('bitcore-lib');

/**
 * Opcodes used to generate output script
 * @module Opcodes
 */

/**
 * Checks if timestamp is greater than a value
 */
var OP_GREATERTHAN_TIMESTAMP = exports.OP_GREATERTHAN_TIMESTAMP = _bitcoreLib.util.buffer.hexToBuffer('6f');

/**
 * Duplicates value
 */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var OP_DUP = exports.OP_DUP = _bitcoreLib.util.buffer.hexToBuffer('76');

/**
 * Calculates hash160 of value
 */
var OP_HASH160 = exports.OP_HASH160 = _bitcoreLib.util.buffer.hexToBuffer('a9');

/**
 * Verifies if values are equal
 */
var OP_EQUALVERIFY = exports.OP_EQUALVERIFY = _bitcoreLib.util.buffer.hexToBuffer('88');

/**
 * Verifies signature
 */
var OP_CHECKSIG = exports.OP_CHECKSIG = _bitcoreLib.util.buffer.hexToBuffer('ac');

/**
 * Shows that pushdata will need length value
 */
var OP_PUSHDATA1 = exports.OP_PUSHDATA1 = _bitcoreLib.util.buffer.hexToBuffer('4c');