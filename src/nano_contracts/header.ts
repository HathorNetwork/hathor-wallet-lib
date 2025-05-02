/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NANO_CONTRACTS_INFO_VERSION } from '../constants';
import { NanoContractActionHeader } from './types';
import type Transaction from '../models/transaction';
import { hexToBuffer, intToBytes, outputValueToBytes } from '../utils/buffer';
import { VertexHeaderId } from '../headers/types';
import Header from '../headers/base';

class NanoContractHeader {
  // Transaction that has this header included
  tx: Transaction;

  // Used to create serialization versioning (hard coded as NANO_CONTRACTS_INFO_VERSION for now)
  nc_info_version: number;

  // It's the blueprint id when this header is calling a initialize method
  // and it's the nano contract id when it's executing another method of a nano
  id: string;

  // Name of the method to be called. When creating a new Nano Contract, it must be equal to 'initialize'
  method: string;

  // Serialized arguments to the method being called
  args: Buffer[];

  // List of actions for this nano
  actions: NanoContractActionHeader[];

  // Pubkey and signature of the transaction owner / caller
  pubkey: Buffer;

  signature: Buffer | null;

  constructor(
    tx: Transaction,
    id: string,
    method: string,
    args: Buffer[],
    actions: NanoContractActionHeader[],
    pubkey: Buffer,
    signature: Buffer | null = null
  ) {
    this.tx = tx;
    this.nc_info_version = NANO_CONTRACTS_INFO_VERSION;
    this.id = id;
    this.method = method;
    this.args = args;
    this.actions = actions;
    this.pubkey = pubkey;
    this.signature = signature;
  }

  /**
   * Serialize funds fields
   * Add the serialized fields to the array parameter
   *
   * @param {array} Array of buffer to push the serialized fields
   * @param {addSignature} If should add signature when serializing it
   *
   * @memberof NanoContract
   * @inner
   */
  serializeFields(array: Buffer[], addSignature: boolean) {
    // Info version
    array.push(intToBytes(this.nc_info_version, 1));

    // nano contract id
    array.push(hexToBuffer(this.id));

    const methodBytes = Buffer.from(this.method, 'ascii');
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

    array.push(intToBytes(this.actions.length, 1));
    for (const action of this.actions) {
      const arrAction: Buffer[] = [];
      arrAction.push(intToBytes(action.type, 1));
      arrAction.push(intToBytes(action.tokenIndex, 1));
      arrAction.push(outputValueToBytes(action.amount));
      array.push(Buffer.concat(arrAction));
    }

    array.push(intToBytes(this.pubkey.length, 1));
    array.push(this.pubkey);

    if (addSignature && this.signature !== null) {
      array.push(intToBytes(this.signature.length, 1));
      array.push(this.signature);
    } else {
      array.push(intToBytes(0, 1));
    }
  }

  serializeSighash(array: Buffer[]) {
    this.serializeFields(array, false);
  }

  /**
   * Serialize header to bytes
   *
   * @memberof NanoContractHeader
   * @inner
   */
  serialize(array: Buffer[]) {
    // First add the header ID
    array.push(Buffer.from(VertexHeaderId.NANO_HEADER, 'hex'));

    // Then the serialized header
    this.serializeFields(array, true);
  }

  static deserialize(buf: Buffer): [Header, Buffer] {
    throw new Error('Not implemented: deserialize must be implemented in subclass');
  }
}

export default NanoContractHeader;
