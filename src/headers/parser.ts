/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { VertexHeaderId } from './types';
import { HeaderStaticType } from './base';
import NanoContractHeader from '../nano_contracts/header';
import FeeHeader from './fee';
import ShieldedOutputsHeader from './shielded_outputs';
import UnshieldBalanceHeader from './unshield_balance';
import { MintHeader } from './mint_melt';
import { MeltHeader } from './melt_header';

export default class HeaderParser {
  static getSupportedHeaders(): Record<VertexHeaderId, HeaderStaticType> {
    return {
      [VertexHeaderId.NANO_HEADER]: NanoContractHeader,
      [VertexHeaderId.FEE_HEADER]: FeeHeader,
      [VertexHeaderId.SHIELDED_OUTPUTS_HEADER]: ShieldedOutputsHeader,
      [VertexHeaderId.UNSHIELD_BALANCE_HEADER]: UnshieldBalanceHeader,
      [VertexHeaderId.MINT_HEADER]: MintHeader,
      [VertexHeaderId.MELT_HEADER]: MeltHeader,
    };
  }

  static getHeader(id: string): HeaderStaticType {
    const headers = HeaderParser.getSupportedHeaders();
    if (!(id in headers)) {
      throw new Error(`Header id not supported: ${id}`);
    }

    return headers[id];
  }
}
