/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Shared base class for the Mint (0x14) and Melt (0x15) headers. The two
 * headers are identical except for their VertexHeaderId and display name,
 * so the construction, validation, and serialization logic lives here once;
 * `mint_header.ts` and `melt_header.ts` only bind the id + name. Mirrors
 * hathor-core's `_MintMeltHeaderBase`. The entry codec itself lives in
 * `mint_melt_entry.ts`.
 */

import { getVertexHeaderIdBuffer, getVertexHeaderIdFromBuffer, VertexHeaderId } from './types';
import Header from './base';
import {
  IMintMeltEntry,
  serializeMintMeltEntries,
  deserializeMintMeltEntries,
  validateMintMeltEntries,
} from './mint_melt_entry';

export abstract class MintMeltHeaderBase extends Header {
  entries: IMintMeltEntry[];

  protected readonly headerName: string;

  protected readonly headerId: VertexHeaderId;

  constructor(entries: IMintMeltEntry[], headerName: string, headerId: VertexHeaderId) {
    super();
    validateMintMeltEntries(entries, headerName);
    this.entries = entries;
    this.headerName = headerName;
    this.headerId = headerId;
  }

  private serializeAll(array: Buffer[]) {
    // Re-validate at the serialize boundary: `this.entries` is a public
    // mutable field that captures the caller-supplied array by reference,
    // so a constructor-validated header can be mutated afterwards
    // (`header.entries.push(...)`, etc.) and silently emit malformed wire
    // bytes that the fullnode then rejects with a confusing remote error.
    // Re-running the check here is O(n ≤ 16) of primitive comparisons.
    validateMintMeltEntries(this.entries, this.headerName);
    array.push(getVertexHeaderIdBuffer(this.headerId));
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
}

/**
 * Shared deserialize for both headers. TypeScript can't make a static method
 * abstract/inherited (see `Header.deserialize`), so each subclass keeps a
 * one-line static `deserialize` that delegates here, passing its id, name,
 * error phrase, and constructor.
 */
export function deserializeMintMeltHeader<T>(
  srcBuf: Buffer,
  expectedId: VertexHeaderId,
  headerName: string,
  errorPhrase: string,
  construct: (entries: IMintMeltEntry[]) => T
): [T, Buffer] {
  let buf = Buffer.from(srcBuf);
  if (getVertexHeaderIdFromBuffer(buf) !== expectedId) {
    throw new Error(`Invalid vertex header id for ${errorPhrase}.`);
  }
  buf = buf.subarray(1);
  const [entries, leftover] = deserializeMintMeltEntries(buf, headerName);
  return [construct(entries), leftover];
}
