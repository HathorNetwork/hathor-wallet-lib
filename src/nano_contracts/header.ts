/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NANO_CONTRACTS_INFO_VERSION, NANO_CONTRACTS_VERSION } from '../constants';
import { NanoContractActionHeader } from './types';
import Transaction from '../models/transaction';
import Input from '../models/input';
import Output from '../models/output';
import { hexToBuffer, intToBytes } from '../utils/buffer';

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
    const arr: Buffer[] = [];
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

export default NanoContractHeader;