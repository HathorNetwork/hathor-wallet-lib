/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
/**
 * Opcodes used to generate output script
 * @module Opcodes
 */
/**
 * Checks if timestamp is greater than a value
 */
export declare const OP_GREATERTHAN_TIMESTAMP: Buffer;
/**
 * Duplicates value
 */
export declare const OP_DUP: Buffer;
/**
 * Calculates hash160 of value
 */
export declare const OP_HASH160: Buffer;
/**
 * Check if values are equal and push 1 to the stack
 * in case it is and 0 if not
 */
export declare const OP_EQUAL: Buffer;
/**
 * Verifies if values are equal
 */
export declare const OP_EQUALVERIFY: Buffer;
/**
 * Verifies signature
 */
export declare const OP_CHECKSIG: Buffer;
/**
 * Shows that pushdata will need length value
 */
export declare const OP_PUSHDATA1: Buffer;
/**
 * Verifies a list of signatures
 * Syntax: <sig1><sig2>...<m> <pub1><pub2>...<n><op_checkmultisig>
 * it will check the m signatures of the current transaction against the n pubkeys
 */
export declare const OP_CHECKMULTISIG: Buffer;
export declare const OP_0: Buffer;
//# sourceMappingURL=opcodes.d.ts.map