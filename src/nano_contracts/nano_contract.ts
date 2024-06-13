/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NANO_CONTRACTS_INFO_VERSION, NANO_CONTRACTS_VERSION } from '../constants';
import Transaction from '../models/transaction';
import Input from '../models/input';
import Output from '../models/output';
import { hexToBuffer, intToBytes } from '../utils/buffer';

class NanoContract extends Transaction {
  id: string;
  method: string;
  args: Buffer[];
  pubkey: Buffer;
  signature: Buffer | null;

  constructor(
    inputs: Input[],
    outputs: Output[],
    tokens: string[],
    id: string,
    method: string,
    args: Buffer[],
    pubkey: Buffer,
    signature: Buffer | null = null
  ) {
    super(inputs, outputs, { tokens });
    this.version = NANO_CONTRACTS_VERSION;

    this.id = id;
    this.method = method;
    this.args = args;
    this.pubkey = pubkey;
    this.signature = signature;
  }

  /**
   * Serialize funds fields
   * Add the serialized fields to the array parameter
   *
   * @param {array} Array of buffer to push the serialized fields
   * @param {addInputData} If should add input data when serializing it
   *
   * @memberof NanoContract
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    super.serializeFundsFields(array, addInputData);

    // Info version
    array.push(intToBytes(NANO_CONTRACTS_INFO_VERSION, 1));

    // nano contract id
    array.push(hexToBuffer(this.id));

    const methodBytes = Buffer.from(this.method, 'utf8');
    array.push(intToBytes(methodBytes.length, 1));
    array.push(methodBytes);

    const argsArray: Buffer[] = [];
    for (const arg of this.args) {
      argsArray.push(intToBytes(arg.length, 2));
      argsArray.push(arg);
    }

    const argsConcat: Buffer = Buffer.concat(argsArray);
    array.push(intToBytes(argsConcat.length, 2));
    array.push(argsConcat);

    array.push(intToBytes(this.pubkey.length, 1));
    array.push(this.pubkey);

    if (addInputData && this.signature !== null) {
      array.push(intToBytes(this.signature.length, 1));
      array.push(this.signature);
    } else {
      array.push(intToBytes(0, 1));
    }
  }

  /**
   * Serialize tx to bytes
   *
   * @memberof NanoContract
   * @inner
   */
  toBytes(): Buffer {
    let arr: any = [];
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Graph fields
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

    return Buffer.concat(arr);
  }
}

export default NanoContract;
