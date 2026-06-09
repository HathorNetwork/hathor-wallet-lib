/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * MeltHeader (id 0x15). Symmetric to MintHeader: declares per-token supply
 * DESTROYED by an otherwise-shielded transaction. Inherits all logic from
 * `mint_melt_header_base.ts` and the entry codec from `mint_melt_entry.ts`,
 * binding only its id + name below.
 */

import { VertexHeaderId } from './types';
import { MintMeltHeaderBase } from './mint_melt_header_base';

export class MeltHeader extends MintMeltHeaderBase {
  static HEADER_NAME = 'MeltHeader';

  static HEADER_ID = VertexHeaderId.MELT_HEADER;
}

export default MeltHeader;
