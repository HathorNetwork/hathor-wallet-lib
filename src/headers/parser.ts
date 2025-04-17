/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import VertexHeaderId from './types';
import Header from './base';
import NanoContractHeader from '../nano_contracts/header';

class HeaderParser {
  static getSupportedHeaders(): Record<VertexHeaderId, Header> {
    return {
      [VertexHeaderId.NANO_HEADER: VertexHeaderId]: NanoContractHeader
    };
  }

  static getHeader(id: Buffer): Header {
    headers = HeaderParser.getSupportedHeaders();
    if (!(id in headers)) {
      throw new Error(`Header id not supported: ${headers.toString('hex')}`);
    }

    return headers[id];
  }
}