/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * MeltHeader (id 0x15). Symmetric to MintHeader: declares per-token
 * supply DESTROYED by an otherwise-shielded transaction. See
 * `mint_melt.ts` for the shared wire format and rationale.
 */

import { getVertexHeaderIdBuffer, getVertexHeaderIdFromBuffer, VertexHeaderId } from './types';
import Header from './base';
import Network from '../models/network';
import {
  IMintMeltEntry,
  serializeMintMeltEntries,
  deserializeMintMeltEntries,
  MAX_MINT_MELT_ENTRIES,
  validateMintMeltEntry,
} from './mint_melt';

export class MeltHeader extends Header {
  static HEADER_NAME = 'MeltHeader';

  entries: IMintMeltEntry[];

  constructor(entries: IMintMeltEntry[]) {
    super();
    if (entries.length === 0) {
      throw new Error(`${MeltHeader.HEADER_NAME} requires at least 1 entry`);
    }
    if (entries.length > MAX_MINT_MELT_ENTRIES) {
      throw new Error(
        `${MeltHeader.HEADER_NAME}: too many entries: ${entries.length} exceeds maximum ${MAX_MINT_MELT_ENTRIES}`
      );
    }
    const seen = new Set<number>();
    for (const entry of entries) {
      validateMintMeltEntry(entry, MeltHeader.HEADER_NAME);
      if (seen.has(entry.tokenIndex)) {
        throw new Error(`${MeltHeader.HEADER_NAME}: duplicate token_index ${entry.tokenIndex}`);
      }
      seen.add(entry.tokenIndex);
    }
    this.entries = entries;
  }

  private serializeAll(array: Buffer[]) {
    array.push(getVertexHeaderIdBuffer(VertexHeaderId.MELT_HEADER));
    array.push(serializeMintMeltEntries(this.entries));
  }

  serializeFields(array: Buffer[]) {
    this.serializeAll(array);
  }

  serialize(array: Buffer[]) {
    this.serializeAll(array);
  }

  serializeSighash(array: Buffer[]) {
    this.serializeAll(array);
  }

  static deserialize(srcBuf: Buffer, _network: Network): [Header, Buffer] {
    let buf = Buffer.from(srcBuf);
    if (getVertexHeaderIdFromBuffer(buf) !== VertexHeaderId.MELT_HEADER) {
      throw new Error('Invalid vertex header id for melt header.');
    }
    buf = buf.subarray(1);
    const [entries, leftover] = deserializeMintMeltEntries(buf, MeltHeader.HEADER_NAME);
    return [new MeltHeader(entries), leftover];
  }
}

export default MeltHeader;
