/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getType"] }] */

import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import Network from '../../models/network';
import { AddressField } from './address';
import { Bytes32Field, Bytes32Schema } from './bytes32';

/**
 * Enum for CallerId type discriminator
 */
export enum CallerIdType {
  ADDRESS = 'address',
  CONTRACT_ID = 'contractId',
}

/**
 * Inner field type - either AddressField or Bytes32Field
 */
type CallerIdInner =
  | { type: CallerIdType.ADDRESS; field: AddressField }
  | { type: CallerIdType.CONTRACT_ID; field: Bytes32Field };

/**
 * Discriminator tags for serialization
 */
const CALLER_ID_ADDRESS_TAG = 0x00;
const CALLER_ID_CONTRACT_TAG = 0x01;

/**
 * CallerIdField represents a union type of Address | ContractId.
 *
 * Serialization format:
 * - Tag 0x00 + 25 bytes = Address (version + 20-byte hash + 4-byte checksum)
 * - Tag 0x01 + 32 bytes = ContractId
 *
 * User format:
 * - Base58 string for Address
 * - 64-character hex string for ContractId
 */
export class CallerIdField extends NCFieldBase<string, CallerIdInner> {
  value: CallerIdInner | null;

  network: Network;

  constructor(network: Network, value: CallerIdInner | null = null) {
    super();
    this.value = value;
    this.network = network;
  }

  getType() {
    return 'CallerId';
  }

  /**
   * Create an instance of CallerIdField, may be empty to allow reading from other sources.
   * @example
   * ```ts
   * const testnet = new Network('testnet');
   * const buf = Buffer.from('...', 'hex');
   *
   * const field = CallerIdField.new(testnet);
   * const parseData = field.fromBuffer(buf);
   *
   * // From address
   * const fieldFromAddress = CallerIdField.new(testnet).fromUser('WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT');
   *
   * // From contract ID
   * const fieldFromContract = CallerIdField.new(testnet).fromUser('0000000000000000000000000000000000000000000000000000000000000001');
   * ```
   */
  static new(network: Network): CallerIdField {
    return new CallerIdField(network, null);
  }

  createNew() {
    return CallerIdField.new(this.network);
  }

  fromBuffer(buf: Buffer): BufferROExtract<CallerIdInner> {
    if (buf.length < 1) {
      throw new Error('Not enough bytes to read CallerId tag');
    }

    const tag = buf[0];

    if (tag === CALLER_ID_ADDRESS_TAG) {
      const addressField = AddressField.new(this.network);
      const parsed = addressField.fromBuffer(buf.subarray(1));
      const result: CallerIdInner = { type: CallerIdType.ADDRESS, field: addressField };
      this.value = result;
      return {
        value: result,
        bytesRead: 1 + parsed.bytesRead,
      };
    }

    if (tag === CALLER_ID_CONTRACT_TAG) {
      const contractIdField = Bytes32Field.new();
      const parsed = contractIdField.fromBuffer(buf.subarray(1));
      const result: CallerIdInner = { type: CallerIdType.CONTRACT_ID, field: contractIdField };
      this.value = result;
      return {
        value: result,
        bytesRead: 1 + parsed.bytesRead,
      };
    }

    throw new Error(`Invalid CallerId tag: ${tag}`);
  }

  toBuffer(): Buffer {
    if (this.value === null) {
      throw new Error('No value to encode');
    }

    const tag =
      this.value.type === CallerIdType.ADDRESS ? CALLER_ID_ADDRESS_TAG : CALLER_ID_CONTRACT_TAG;

    return Buffer.concat([Buffer.from([tag]), this.value.field.toBuffer()]);
  }

  /**
   * Parse user input as either an Address or ContractId.
   * - Base58 strings (34-35 chars) are parsed as Address
   * - 64-char hex strings are parsed as ContractId
   */
  fromUser(data: unknown): CallerIdField {
    // Contract ID is a 64-char hex string
    if (Bytes32Schema.safeParse(data).success) {
      const field = Bytes32Field.new();
      field.fromUser(data);
      this.value = { type: CallerIdType.CONTRACT_ID, field };
      return this;
    }

    // Otherwise treat as address
    const field = AddressField.new(this.network);
    field.fromUser(data);
    this.value = { type: CallerIdType.ADDRESS, field };
    return this;
  }

  /**
   * Return user-readable string representation.
   * - Address returns base58 string
   * - ContractId returns hex string
   */
  toUser(): string {
    if (this.value === null) {
      throw new Error('No value to encode');
    }

    return this.value.field.toUser();
  }

  /**
   * Check if the value is an address.
   */
  isAddress(): boolean {
    return this.value?.type === CallerIdType.ADDRESS;
  }

  /**
   * Check if the value is a contract ID.
   */
  isContractId(): boolean {
    return this.value?.type === CallerIdType.CONTRACT_ID;
  }
}
