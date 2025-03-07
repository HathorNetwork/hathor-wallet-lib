/* eslint-disable max-classes-per-file */

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import zlib from 'zlib';
import { ON_CHAIN_BLUEPRINTS_INFO_VERSION, ON_CHAIN_BLUEPRINTS_VERSION } from '../constants';
import Transaction from '../models/transaction';
import { intToBytes } from '../utils/buffer';

export enum CodeKind {
  PYTHON_GZIP = 'python+gzip',
}

export class Code {
  kind: CodeKind;

  content: Buffer;

  constructor(kind: CodeKind, content: Buffer) {
    this.kind = kind;
    this.content = content;
  }

  serialize(): Buffer {
    // Code serialization format: [kind:variable bytes][null byte][data:variable bytes]
    const arr: Buffer[] = [];
    if (this.kind !== CodeKind.PYTHON_GZIP) {
      throw new Error('Invalid code kind value');
    }

    const zcode = zlib.deflateSync(this.content);
    arr.push(Buffer.from(this.kind, 'utf8'));
    arr.push(intToBytes(0, 1));
    arr.push(zcode);
    return Buffer.concat(arr);
  }
}

/**
 * The OnChainBlueprint class inherits the Transaction class, so it has all its attributes.
 *
 * We currently don't have support for creating an ocb object with inputs/outputs, so we receive as
 * parameters in the constructor only the data related to the ocb class itself.
 *
 * The code and the public key that will be used as caller to sign the transaction (just like the nano contract class).
 */
class OnChainBlueprint extends Transaction {
  // Code object with content
  code: Code;

  pubkey: Buffer;

  signature: Buffer | null;

  constructor(code: Code, pubkey: Buffer, signature: Buffer | null = null) {
    super([], []);
    this.version = ON_CHAIN_BLUEPRINTS_VERSION;

    this.code = code;
    this.pubkey = pubkey;
    this.signature = signature;
  }

  /**
   * Serialize funds fields
   * Add the serialized fields to the array parameter
   *
   * @param {array} Array of buffer to push the serialized fields
   * @param {addInputData} If should add input data or signature when serializing it
   *
   * @memberof OnChainBlueprint
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    super.serializeFundsFields(array, addInputData);

    // Info version
    array.push(intToBytes(ON_CHAIN_BLUEPRINTS_INFO_VERSION, 1));

    // Code
    const serializedCode = this.code.serialize();
    array.push(intToBytes(serializedCode.length, 4));
    array.push(serializedCode);

    // Pubkey and signature
    array.push(intToBytes(this.pubkey.length, 1));
    array.push(this.pubkey);

    if (this.signature !== null && addInputData) {
      array.push(intToBytes(this.signature.length, 1));
      array.push(this.signature);
    } else {
      array.push(intToBytes(0, 1));
    }
  }

  /**
   * Serialize tx to bytes
   *
   * @memberof OnChainBlueprint
   * @inner
   */
  toBytes(): Buffer {
    const arr: Buffer[] = [];
    // Serialize first the funds part
    this.serializeFundsFields(arr, true);

    // Graph fields
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

    return Buffer.concat(arr);
  }
}

export default OnChainBlueprint;
