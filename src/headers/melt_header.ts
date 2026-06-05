/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * MeltHeader (id 0x15). Symmetric to MintHeader: declares per-token supply
 * DESTROYED by an otherwise-shielded transaction. Shares the logic in
 * `mint_melt_header_base.ts` and the entry codec in `mint_melt_entry.ts`.
 */

import { VertexHeaderId } from './types';
import Header from './base';
import Network from '../models/network';
import { IMintMeltEntry } from './mint_melt_entry';
import { MintMeltHeaderBase, deserializeMintMeltHeader } from './mint_melt_header_base';

export class MeltHeader extends MintMeltHeaderBase {
  static HEADER_NAME = 'MeltHeader';

  constructor(entries: IMintMeltEntry[]) {
    super(entries, MeltHeader.HEADER_NAME, VertexHeaderId.MELT_HEADER);
  }

  static deserialize(srcBuf: Buffer, _network: Network): [Header, Buffer] {
    return deserializeMintMeltHeader(
      srcBuf,
      VertexHeaderId.MELT_HEADER,
      MeltHeader.HEADER_NAME,
      'melt header',
      entries => new MeltHeader(entries)
    );
  }
}

export default MeltHeader;
