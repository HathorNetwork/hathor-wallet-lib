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

export default class HeaderParser {
  static getSupportedHeaders(): Record<VertexHeaderId, HeaderStaticType> {
    return {
      [VertexHeaderId.NANO_HEADER]: NanoContractHeader,
      [VertexHeaderId.FEE_HEADER]: FeeHeader,
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
