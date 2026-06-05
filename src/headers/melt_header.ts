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
  validateMintMeltEntries,
} from './mint_melt_entry';

export class MeltHeader extends Header {
  static HEADER_NAME = 'MeltHeader';

  entries: IMintMeltEntry[];

  constructor(entries: IMintMeltEntry[]) {
    super();
    validateMintMeltEntries(entries, MeltHeader.HEADER_NAME);
    this.entries = entries;
  }

  private serializeAll(array: Buffer[]) {
    // Re-validate at the serialize boundary; see the same guard in
    // MintHeader.serializeAll for rationale (header.entries is a public
    // mutable field that captures the caller's array by reference).
    validateMintMeltEntries(this.entries, MeltHeader.HEADER_NAME);
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
