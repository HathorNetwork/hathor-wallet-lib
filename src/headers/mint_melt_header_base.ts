/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Shared base class for the Mint (0x14) and Melt (0x15) headers. They are
 * identical except for their VertexHeaderId and name, so all construction,
 * validation, and (de)serialization lives here; each subclass only declares
 * its `HEADER_NAME` + `HEADER_ID` statics. Mirrors hathor-core's
 * `_MintMeltHeaderBase`. The entry codec lives in `mint_melt_entry.ts`.
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

/**
 * The static surface every concrete Mint/Melt header exposes. Used to type
 * `this` inside the inherited static `deserialize` so it can read the
 * subclass's id/name and `new this(entries)` the right class.
 */
interface MintMeltHeaderClass {
  HEADER_NAME: string;
  HEADER_ID: VertexHeaderId;
  new (entries: IMintMeltEntry[]): MintMeltHeaderBase;
}

export abstract class MintMeltHeaderBase extends Header {
  static HEADER_NAME: string;

  static HEADER_ID: VertexHeaderId;

  entries: IMintMeltEntry[];

  constructor(entries: IMintMeltEntry[]) {
    super();
    this.entries = entries;
  }

  /** The concrete subclass's static HEADER_NAME, via the runtime constructor. */
  private get headerName(): string {
    return (this.constructor as typeof MintMeltHeaderBase).HEADER_NAME;
  }

  /** The concrete subclass's static HEADER_ID, via the runtime constructor. */
  private get headerId(): VertexHeaderId {
    return (this.constructor as typeof MintMeltHeaderBase).HEADER_ID;
  }

  /**
   * Validate the entries: count in [1, MAX_MINT_MELT_ENTRIES], each
   * token_index in [1, 16], each amount in [1, 2^64), and no duplicate
   * token_index. Following the FeeHeader convention this is NOT run from the
   * constructor — callers validate explicitly; `serialize` calls it so
   * malformed bytes never reach the wire.
   */
  validate(): void {
    validateMintMeltEntries(this.entries, this.headerName);
  }

  serialize(array: Buffer[]) {
    // Validate at the serialize boundary: `this.entries` is a public mutable
    // field captured by reference, so a header can be mutated after
    // construction (`header.entries.push(...)`, etc.) and would otherwise
    // emit malformed wire bytes the fullnode rejects with a confusing error.
    this.validate();
    array.push(getVertexHeaderIdBuffer(this.headerId));
    array.push(serializeMintMeltEntries(this.entries));
  }

  serializeFields(array: Buffer[]) {
    this.serialize(array);
  }

  serializeSighash(array: Buffer[]) {
    this.serialize(array);
  }

  /**
   * One deserialize for both headers. Inherited by the subclasses, so at the
   * call site `this` is the concrete class (MintHeader / MeltHeader): it reads
   * that class's HEADER_ID / HEADER_NAME and `new this(...)` builds the right
   * instance. The `this` parameter is typed (not a real argument) so `new
   * this(...)` resolves to a concrete constructor.
   */
  static deserialize(
    this: MintMeltHeaderClass,
    srcBuf: Buffer,
    _network: Network
  ): [Header, Buffer] {
    let buf = Buffer.from(srcBuf);
    if (getVertexHeaderIdFromBuffer(buf) !== this.HEADER_ID) {
      throw new Error(`Invalid vertex header id for ${this.HEADER_NAME}.`);
    }
    buf = buf.subarray(1);
    const [entries, leftover] = deserializeMintMeltEntries(buf, this.HEADER_NAME);
    return [new this(entries), leftover];
  }
}
