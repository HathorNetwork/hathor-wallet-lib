/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * MintHeader (id 0x14). When a shielded transaction (one with shielded
 * inputs and/or outputs) creates new supply for a non-HTR token, the
 * wallet MUST publicly declare the per-token amount via a `MintHeader`.
 * The declared scalars enter the augmented Pedersen balance equation as
 * unblinded terms — recipient set stays hidden, no-inflation guarantee is
 * preserved. The symmetric `MeltHeader` (0x15) declares supply destroyed;
 * both share the entry wire format defined in `mint_melt_entry.ts`.
 *
 * Wire format:
 *   header_id(1) | num_entries(1) | entries[token_index(1) | amount(8 BE)]
 */

import { getVertexHeaderIdBuffer, getVertexHeaderIdFromBuffer, VertexHeaderId } from './types';
import Header from './base';
import Network from '../models/network';
import {
  IMintMeltEntry,
  serializeMintMeltEntries,
  deserializeMintMeltEntries,
  validateMintMeltEntries,
} from './mint_melt_entry';

export class MintHeader extends Header {
  static HEADER_NAME = 'MintHeader';

  entries: IMintMeltEntry[];

  constructor(entries: IMintMeltEntry[]) {
    super();
    validateMintMeltEntries(entries, MintHeader.HEADER_NAME);
    this.entries = entries;
  }

  private serializeAll(array: Buffer[]) {
    // Re-validate at the serialize boundary: `this.entries` is a public
    // mutable field that captures the caller-supplied array by reference,
    // so a constructor-validated header can be mutated afterwards
    // (`header.entries.push(...)`, etc.) and silently emit malformed wire
    // bytes that the fullnode then rejects with a confusing remote error.
    // Re-running the check here is O(n ≤ 16) of primitive comparisons.
    validateMintMeltEntries(this.entries, MintHeader.HEADER_NAME);
    array.push(getVertexHeaderIdBuffer(VertexHeaderId.MINT_HEADER));
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
    if (getVertexHeaderIdFromBuffer(buf) !== VertexHeaderId.MINT_HEADER) {
      throw new Error('Invalid vertex header id for mint header.');
    }
    buf = buf.subarray(1);
    const [entries, leftover] = deserializeMintMeltEntries(buf, MintHeader.HEADER_NAME);
    return [new MintHeader(entries), leftover];
  }
}

export default MintHeader;
