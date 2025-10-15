/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getVertexHeaderIdBuffer, getVertexHeaderIdFromBuffer, VertexHeaderId } from './types';
import Header from './base';
import Network from '../models/network';
import { IFeeEntry, OutputValueType } from '../types';
import { bytesToOutputValue, intToBytes, outputValueToBytes, unpackToInt } from '../utils/buffer';
import { MAX_FEE_HEADER_ENTRIES } from '../constants';

/**
 * FeeHeader represents the fee payment information in a transaction.
 * It explicitly indicates which tokens and amounts are being used to pay transaction fees.
 *
 * @class FeeHeader
 * @extends {Header}
 */
class FeeHeader extends Header {
  /**
   * Array of fee entries, each specifying a token and amount used for fee payment
   */
  entries: IFeeEntry[];

  /**
   * Creates an instance of FeeHeader.
   *
   * @param {IFeeEntry[]} entries - Array of fee entries
   * @memberof FeeHeader
   */
  constructor(entries: IFeeEntry[]) {
    super();
    this.entries = entries;
  }

  /**
   * Serialize the fee header fields to a buffer array.
   * Format:
   *   [num_entries: 1 byte]
   *   For each entry:
   *     [tokenIndex: 1 byte]
   *     [amount: encoded output value, variable bytes]
   *
   * @param {Buffer[]} array - Array of buffers to push the serialized fields
   * @memberof FeeHeader
   * @inner
   */
  serializeFields(array: Buffer[]) {
    // Number of entries
    array.push(intToBytes(this.entries.length, 1));

    // Serialize each entry
    for (const entry of this.entries) {
      array.push(intToBytes(entry.tokenIndex, 1));
      array.push(outputValueToBytes(entry.amount));
    }
  }

  /**
   * Serialize the header for signature hash calculation.
   * This is the same as serializeFields for FeeHeader since there are no scripts/signatures.
   *
   * @param {Buffer[]} array - Array of buffers to push the serialized fields
   * @memberof FeeHeader
   * @inner
   */
  serializeSighash(array: Buffer[]) {
    this.serializeFields(array);
  }

  /**
   * Serialize the complete header including the header ID.
   * Format: [Header ID: 1 byte][serialized fields]
   *
   * @param {Buffer[]} array - Array of buffers to push the serialized header
   * @memberof FeeHeader
   * @inner
   */
  serialize(array: Buffer[]) {
    // First add the header ID
    array.push(getVertexHeaderIdBuffer(VertexHeaderId.FEE_HEADER));

    // Then the serialized fields
    this.serializeFields(array);
  }

  /**
   * Deserialize a buffer into a FeeHeader object.
   *
   * @param {Buffer} srcBuf - Buffer containing the serialized header data
   * @param {Network} _ - Network parameter (not used for FeeHeader, but required by interface)
   * @returns {[Header, Buffer]} Tuple of [deserialized FeeHeader, remaining buffer]
   * @throws {Error} If the header ID is invalid
   * @memberof FeeHeader
   * @static
   * @inner
   */
  static deserialize(srcBuf: Buffer, _: Network): [Header, Buffer] {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Validate header ID
    if (getVertexHeaderIdFromBuffer(buf) !== VertexHeaderId.FEE_HEADER) {
      throw new Error('Invalid vertex header id for fee header.');
    }

    // Skip the header ID byte
    buf = buf.subarray(1);

    const entries: IFeeEntry[] = [];

    // Read number of entries
    const [numEntries, bufAfterNumEntries] = unpackToInt(1, false, buf);
    buf = bufAfterNumEntries;

    // Read each entry
    for (let i = 0; i < numEntries; i++) {
      // Token Index (1 byte)
      let tokenIndex: number;
      [tokenIndex, buf] = unpackToInt(1, false, buf);

      // Amount (variable length, variable bytes)
      let amount: OutputValueType;
      [amount, buf] = bytesToOutputValue(buf);

      entries.push({
        tokenIndex,
        amount,
      });
    }

    const header = new FeeHeader(entries);
    return [header, buf];
  }

  /**
   * Get the fee amount for a specific token index.
   *
   * @param {number} tokenIndex - The token index to search for
   * @returns {OutputValueType | null} The fee amount for the token, or null if not found
   * @memberof FeeHeader
   * @inner
   */
  getFeeForTokenIndex(tokenIndex: number): OutputValueType | null {
    const entry = this.entries.find(e => e.tokenIndex === tokenIndex);
    return entry ? entry.amount : null;
  }

  /**
   * Check if the fee header has an entry for a specific token index.
   *
   * @param {number} tokenIndex - The token index to check
   * @returns {boolean} True if the token index is present, false otherwise
   * @memberof FeeHeader
   * @inner
   */
  hasTokenIndex(tokenIndex: number): boolean {
    return this.entries.some(e => e.tokenIndex === tokenIndex);
  }

  /**
   * Get all token indexes from the fee header entries.
   *
   * @returns {number[]} Array of token indexes
   * @memberof FeeHeader
   * @inner
   */
  getTokenIndexes(): number[] {
    return this.entries.map(e => e.tokenIndex);
  }

  /**
   * Get the fee header from a transaction's header list.
   * Assumes there is at most one fee header per transaction.
   *
   * @param {Transaction} tx - Transaction object
   * @returns {FeeHeader | null} The fee header if found, null otherwise
   * @memberof FeeHeader
   * @static
   * @inner
   */
  static getHeadersFromTx(tx: { headers: Header[] }): FeeHeader | null {
    for (const header of tx.headers) {
      if (header instanceof FeeHeader) {
        return header;
      }
    }
    return null;
  }

  /**
   * Validate the fee header entries.
   * Checks:
   * - Number of entries does not exceed maximum (16)
   * - No duplicate token indexes
   * - All amounts are positive
   * - Token indexes are non-negative
   *
   * @throws {Error} If validation fails
   * @memberof FeeHeader
   * @inner
   */
  validate(): void {
    // Check maximum number of entries
    if (this.entries.length > MAX_FEE_HEADER_ENTRIES) {
      throw new Error(
        `Fee header can have at most ${MAX_FEE_HEADER_ENTRIES} entries, got ${this.entries.length}`
      );
    }

    const seenIndexes = new Set<number>();

    for (const entry of this.entries) {
      // Check for duplicate token index
      if (seenIndexes.has(entry.tokenIndex)) {
        throw new Error(`Duplicate token index in fee header: ${entry.tokenIndex}`);
      }
      seenIndexes.add(entry.tokenIndex);

      // Check token index is non-negative
      if (entry.tokenIndex < 0) {
        throw new Error(`Invalid token index in fee header: ${entry.tokenIndex}`);
      }

      // Check amount is positive
      if (entry.amount <= 0n) {
        throw new Error(`Fee amount must be positive for token index ${entry.tokenIndex}`);
      }
    }
  }
}

export default FeeHeader;
