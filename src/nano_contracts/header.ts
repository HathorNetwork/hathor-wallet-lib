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
import helpersUtils from '../utils/helpers';
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
  // Used to create serialization versioning (hard coded as NANO_CONTRACTS_INFO_VERSION for now)
  nc_info_version: number;

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
  address: Address | null;

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
    address: Address | null,
    script: Buffer | null = null
  ) {
    super();
    this.nc_info_version = NANO_CONTRACTS_INFO_VERSION;
    this.id = id;
    this.method = method;
    this.args = args;
    this.actions = actions;
    this.address = address;
    this.script = script;
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
    // Info version
    array.push(intToBytes(this.nc_info_version, 1));

    // nano contract id
    array.push(hexToBuffer(this.id));

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
      array.push(intToBytes(this.script.length, 2));
      array.push(this.script);
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

    // Create empty header to fill with the deserialization
    const header = new NanoContractHeader('', '', Buffer.alloc(0), [], null, null);

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // nc info version
    [header.nc_info_version, buf] = unpackToInt(1, false, buf);

    if (header.nc_info_version !== NANO_CONTRACTS_INFO_VERSION) {
      throw new Error('Invalid info version for nano header.');
    }

    // NC ID is 32 bytes in hex
    let ncIdBuffer: Buffer;
    [ncIdBuffer, buf] = unpackLen(32, buf);
    header.id = ncIdBuffer.toString('hex');

    // nc method
    let methodLen: number;
    let methodBuffer: Buffer;
    [methodLen, buf] = unpackToInt(1, false, buf);

    [methodBuffer, buf] = unpackLen(methodLen, buf);
    header.method = methodBuffer.toString('ascii');

    // nc args
    let argsLen: number;
    let argsBuf: Buffer;
    [argsLen, buf] = unpackToInt(2, false, buf);
    [argsBuf, buf] = unpackLen(argsLen, buf);
    header.args = argsBuf;

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

      header.actions.push({ type: actionType, tokenIndex, amount });
    }

    // nc address
    let addressBytes: Buffer;
    [addressBytes, buf] = unpackLen(25, buf);
    header.address = helpersUtils.validateAddressBytes(addressBytes, network);

    // nc script
    let scriptLen: number;
    [scriptLen, buf] = unpackToInt(2, false, buf);

    if (scriptLen !== 0) {
      // script might be null
      [header.script, buf] = unpackLen(scriptLen, buf);
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
