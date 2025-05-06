/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NANO_CONTRACTS_INFO_VERSION } from '../constants';
import { NanoContractActionHeader } from './types';
import type Transaction from '../models/transaction';
import {
  bytesToOutputValue,
  hexToBuffer,
  intToBytes,
  outputValueToBytes,
  unpackLen,
  unpackToInt,
} from '../utils/buffer';
import { VertexHeaderId } from '../headers/types';
import Header from '../headers/base';

class NanoContractHeader extends Header {
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
    super();
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

  /**
   * Serialize sighash data to bytes
   *
   * @memberof NanoContractHeader
   * @inner
   */
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

  /**
   * Deserialize buffer to Header object and
   * return the rest of the buffer data
   *
   * @return Header object deserialized and the rest of buffer data
   *
   * @memberof NanoContractHeader
   * @inner
   */
  static deserialize(tx: Transaction, srcBuf: Buffer): [Header, Buffer] {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    let headerId;
    [headerId, buf] = [buf.subarray(0, 1), buf.subarray(1)];

    const headerIdHex = headerId.toString('hex');
    if (headerIdHex !== VertexHeaderId.NANO_HEADER) {
      throw new Error('Invalid vertex header id for nano header.');
    }

    // Create empty header to fill with the deserialization
    const header = new NanoContractHeader(tx, '', '', [], [], Buffer.from([]));

    // nc info version
    [header.nc_info_version, buf] = unpackToInt(1, false, buf);

    if (header.nc_info_version !== NANO_CONTRACTS_INFO_VERSION) {
      throw new Error('Invalid info version for nano header.');
    }

    // NC ID is 32 bytes in hex
    let ncIdBuffer;
    [ncIdBuffer, buf] = unpackLen(32, buf);
    header.id = ncIdBuffer.toString('hex');

    // nc method
    let methodLen;
    let methodBuffer;
    [methodLen, buf] = unpackToInt(1, false, buf);

    [methodBuffer, buf] = unpackLen(methodLen, buf);
    header.method = methodBuffer.toString('ascii');

    // nc args
    let argsLen;
    let args: Buffer[] = [];
    let argsBuf;
    [argsLen, buf] = unpackToInt(2, false, buf);
    [argsBuf, buf] = unpackLen(argsLen, buf);

    while (argsBuf.length > 0) {
      let argElementLen;
      let argElement;
      [argElementLen, argsBuf] = unpackToInt(2, false, argsBuf);
      [argElement, argsBuf] = unpackLen(argElementLen, argsBuf);
      args.push(argElement);
    }

    header.args = args;

    // nc actions
    let actionsLen;
    [actionsLen, buf] = unpackToInt(1, false, buf);

    for (let i = 0; i < actionsLen; i++) {
      let actionTypeBytes;
      let actionType;
      let tokenIndex;
      let amount;
      [actionTypeBytes, buf] = [buf.subarray(0, 1), buf.subarray(1)];
      [actionType] = unpackToInt(1, false, actionTypeBytes);
      [tokenIndex, buf] = unpackToInt(1, false, buf);
      [amount, buf] = bytesToOutputValue(buf);

      header.actions.push({ type: actionType, tokenIndex, amount });
    }

    // nc pubkey
    let pubkeyLen;
    [pubkeyLen, buf] = unpackToInt(1, false, buf);
    [header.pubkey, buf] = unpackLen(pubkeyLen, buf);

    // nc signature
    let signatureLen;
    [signatureLen, buf] = unpackToInt(1, false, buf);

    if (signatureLen !== 0) {
      // signature might be null
      [header.signature, buf] = unpackLen(signatureLen, buf);
    }
    /* eslint-enable prefer-const */

    return [header, buf];
  }

  /**
   * Get the nano contract header from the list of headers.
   *
   * @return The nano header object
   *
   * @memberof Transaction
   * @inner
   */
  static getHeadersFromTx(tx: Transaction): NanoContractHeader[] {
    const headers: NanoContractHeader[] = [];
    for (const header of tx.headers) {
      if (header instanceof NanoContractHeader) {
        headers.push(header);
      }
    }

    return headers;
  }
}

export default NanoContractHeader;
