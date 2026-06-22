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
 * both inherit all logic from `mint_melt_header_base.ts` and the entry codec
 * from `mint_melt_entry.ts`, binding only their id + name below.
 *
 * Wire format:
 *   header_id(1) | num_entries(1) | entries[token_index(1) | amount(8 BE)]
 */

import { VertexHeaderId } from './types';
import { MintMeltHeaderBase } from './mint_melt_header_base';

export class MintHeader extends MintMeltHeaderBase {
  static HEADER_NAME = 'MintHeader';

  static HEADER_ID = VertexHeaderId.MINT_HEADER;
}

export default MintHeader;
