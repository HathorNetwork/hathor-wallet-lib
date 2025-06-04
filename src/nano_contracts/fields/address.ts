/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { BufferROExtract } from '../types';
import { NCFieldBase } from './base';
import Address from '../../models/address';
import Network from '../../models/network';
import helpersUtils from '../../utils/helpers';

export const AddressSchema = z
  .string()
  .regex(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{34,35}$/);

export class AddressField extends NCFieldBase<string, Address> {
  value: Address | null;

  network: Network;

  constructor(network: Network, value: Address | null = null) {
    super();
    this.value = value;
    this.network = network;
  }

  /**
   * Create an instance of AddressField, may be empty to allow reading from other sources.
   * @example
   * ```ts
   * const testnet = new Network('testnet');
   * const buf = Buffer.from('4969ffb1549f2e00f30bfc0cf0b9207ed96f7f33ba578d4852', 'hex');
   *
   * const field = AddressField.new(testnet);
   * const parseData = field.fromBuffer(buf);
   * const fieldFromUser = AddressField.new(testnet).fromUser('WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT');
   * ```
   */
  static new(network: Network, value: Address | null = null): AddressField {
    return new AddressField(network, value);
  }

  fromBuffer(buf: Buffer): BufferROExtract<Address> {
    if (buf.length < 25) {
      throw new Error('Not enough bytes to read address');
    }
    // First we get the 20 bytes (hash) of the address without the version byte and checksum
    const hashBytes = buf.subarray(1, 21);
    const address = helpersUtils.encodeAddress(hashBytes, this.network);
    address.validateAddress();
    const decoded = address.decode();
    // We need to check that the metadata of the address received match the one we generated
    // Check network version
    if (decoded[0] !== buf[0]) {
      throw new Error(
        `Asked to deserialize an address with version byte ${buf[0]} but the network from the deserializer object has version byte ${decoded[0]}.`
      );
    }
    // Check checksum bytes
    const calcChecksum = decoded.subarray(21, 25);
    const recvChecksum = buf.subarray(21, 25);
    if (!calcChecksum.equals(recvChecksum)) {
      // Checksum value generated does not match value from fullnode
      throw new Error(
        `When parsing and Address(${address.base58}) we calculated checksum(${calcChecksum.toString('hex')}) but it does not match the checksum it came with ${recvChecksum.toString('hex')}.`
      );
    }
    this.value = address;
    return {
      value: address,
      bytesRead: 25,
    };
  }

  toBuffer(): Buffer {
    if (this.value === null) {
      throw new Error('No value to encode');
    }
    this.value.validateAddress();
    // Address has fixed 25 byte serialization, so no need to add length
    return this.value.decode();
  }

  fromUser(data: unknown): AddressField {
    // Value is a valid base58 string
    const value = AddressSchema.parse(data);
    const address = new Address(value, { network: this.network });
    address.validateAddress();
    this.value = address;
    return this;
  }

  toUser(): string {
    if (this.value === null) {
      throw new Error('No value to encode');
    }
    this.value.validateAddress();
    return this.value.base58;
  }
}
