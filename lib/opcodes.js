"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.OP_PUSHDATA1 = exports.OP_HASH160 = exports.OP_GREATERTHAN_TIMESTAMP = exports.OP_EQUALVERIFY = exports.OP_EQUAL = exports.OP_DUP = exports.OP_CHECKSIG = exports.OP_CHECKMULTISIG = exports.OP_0 = void 0;
var _buffer = require("./utils/buffer");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Opcodes used to generate output script
 * @module Opcodes
 */

/**
 * Checks if timestamp is greater than a value
 */
const OP_GREATERTHAN_TIMESTAMP = exports.OP_GREATERTHAN_TIMESTAMP = (0, _buffer.hexToBuffer)('6f');

/**
 * Duplicates value
 */
const OP_DUP = exports.OP_DUP = (0, _buffer.hexToBuffer)('76');

/**
 * Calculates hash160 of value
 */
const OP_HASH160 = exports.OP_HASH160 = (0, _buffer.hexToBuffer)('a9');

/**
 * Check if values are equal and push 1 to the stack
 * in case it is and 0 if not
 */
const OP_EQUAL = exports.OP_EQUAL = (0, _buffer.hexToBuffer)('87');

/**
 * Verifies if values are equal
 */
const OP_EQUALVERIFY = exports.OP_EQUALVERIFY = (0, _buffer.hexToBuffer)('88');

/**
 * Verifies signature
 */
const OP_CHECKSIG = exports.OP_CHECKSIG = (0, _buffer.hexToBuffer)('ac');

/**
 * Shows that pushdata will need length value
 */
const OP_PUSHDATA1 = exports.OP_PUSHDATA1 = (0, _buffer.hexToBuffer)('4c');

/**
 * Verifies a list of signatures
 * Syntax: <sig1><sig2>...<m> <pub1><pub2>...<n><op_checkmultisig>
 * it will check the m signatures of the current transaction against the n pubkeys
 */
const OP_CHECKMULTISIG = exports.OP_CHECKMULTISIG = (0, _buffer.hexToBuffer)('ae');
const OP_0 = exports.OP_0 = (0, _buffer.hexToBuffer)('50');