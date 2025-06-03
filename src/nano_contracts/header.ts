/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
import helpersUtils from '../utils/helpers';
import leb128Util from '../utils/leb128';
import {
  getVertexHeaderIdBuffer,
  getVertexHeaderIdFromBuffer,
  VertexHeaderId,
} from '../headers/types';
import Header from '../headers/base';
import Address from '../models/address';
import Network from '../models/network';
import { OutputValueType } from '../types';

class NanoContractHeader extends Header {
  // It's the blueprint id when this header is calling a initialize method
  // and it's the nano contract id when it's executing another method of a nano
  id: string;

  // Name of the method to be called. When creating a new Nano Contract, it must be equal to 'initialize'
  method: string;

  // Serialized arguments to the method being called
  args: Buffer;

  // List of actions for this nano
  actions: NanoContractActionHeader[];

  // Address of the transaction owner(s)/caller(s)
  address: Address;

  // Sequential number for the nano header
  seqnum: number;

  /**
   * script with signature(s) of the transaction owner(s)/caller(s).
   * Supports P2PKH and P2SH
   */
  script: Buffer | null;

  constructor(
    id: string,
    method: string,
    args: Buffer,
    actions: NanoContractActionHeader[],
    seqnum: number,
    address: Address,
    script: Buffer | null = null
  ) {
    super();
    this.id = id;
    this.method = method;
    this.args = args;
    this.actions = actions;
    this.address = address;
    this.script = script;
    this.seqnum = seqnum;
  }

  /**
   * Serialize funds fields
   * Add the serialized fields to the array parameter
   *
   * @param array Array of buffer to push the serialized fields
   * @param addScript If should add the script with the signature(s) when serializing it
   *
   * @memberof NanoContract
   * @inner
   */
  serializeFields(array: Buffer[], addScript: boolean) {
    // nano contract id
    array.push(hexToBuffer(this.id));

    // Seqnum
    array.push(encodeUnsigned(this.seqnum));

    const methodBytes = Buffer.from(this.method, 'ascii');
    array.push(intToBytes(methodBytes.length, 1));
    array.push(methodBytes);

    array.push(intToBytes(this.args.length, 2));
    array.push(this.args);

    array.push(intToBytes(this.actions.length, 1));
    for (const action of this.actions) {
      const arrAction: Buffer[] = [];
      arrAction.push(intToBytes(action.type, 1));
      arrAction.push(intToBytes(action.tokenIndex, 1));
      arrAction.push(outputValueToBytes(action.amount));
      array.push(Buffer.concat(arrAction));
    }

    if (!this.address) {
      throw new Error('Header caller address was not provided');
    }
    const addressBytes = this.address.decode();
    array.push(addressBytes);

    if (addScript && this.script !== null) {
      array.push(leb128Util.encodeUnsigned(this.script.length, 2));
      array.push(this.script);
    } else {
      // Script with length 0 indicates there is no script.
      array.push(leb128Util.encodeUnsigned(0, 2));
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
    array.push(getVertexHeaderIdBuffer(VertexHeaderId.NANO_HEADER));

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
  static deserialize(srcBuf: Buffer, network: Network): [Header, Buffer] {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    if (getVertexHeaderIdFromBuffer(buf) !== VertexHeaderId.NANO_HEADER) {
      throw new Error('Invalid vertex header id for nano header.');
    }

    buf = buf.subarray(1);

    let ncId: string;
    let method: string;
    let args: Buffer;
    const actions: NanoContractActionHeader[] = [];
    let address: Address;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */

    // NC ID is 32 bytes in hex
    let ncIdBuffer: Buffer;
    [ncIdBuffer, buf] = unpackLen(32, buf);
    ncId = ncIdBuffer.toString('hex');

    // Seqnum has variable length with maximum of 8 bytes
    const {
      value: seqnum,
      rest: buf,
    } = leb128Util.decodeUnsigned(buf, 8);
    header.seqnum = seqnum;

    // nc method
    let methodLen: number;
    let methodBuffer: Buffer;
    [methodLen, buf] = unpackToInt(1, false, buf);

    [methodBuffer, buf] = unpackLen(methodLen, buf);
    method = methodBuffer.toString('ascii');

    // nc args
    let argsLen: number;
    [argsLen, buf] = unpackToInt(2, false, buf);
    [args, buf] = unpackLen(argsLen, buf);

    // nc actions
    let actionsLen: number;
    [actionsLen, buf] = unpackToInt(1, false, buf);

    for (let i = 0; i < actionsLen; i++) {
      let actionTypeBytes: Buffer;
      let actionType: number;
      let tokenIndex: number;
      let amount: OutputValueType;
      [actionTypeBytes, buf] = [buf.subarray(0, 1), buf.subarray(1)];
      [actionType] = unpackToInt(1, false, actionTypeBytes);
      [tokenIndex, buf] = unpackToInt(1, false, buf);
      [amount, buf] = bytesToOutputValue(buf);

      actions.push({ type: actionType, tokenIndex, amount });
    }

    // nc address
    let addressBytes: Buffer;
    [addressBytes, buf] = unpackLen(25, buf);
    address = helpersUtils.getAddressFromBytes(addressBytes, network);

    // nc script
    let scriptLen: number;
    ({
      value: scriptLen,
      rest: buf,
    } = leb128Util.decodeUnsigned(buf, 2));

    const header = new NanoContractHeader(ncId, method, args, actions, address);

    if (scriptLen !== 0) {
      // script might be null
      [header.script, buf] = unpackLen(Number(scriptLen), buf);
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
