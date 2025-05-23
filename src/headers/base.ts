/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Network from '../models/network';

export interface HeaderStaticType {
  deserialize(srcBuf: Buffer, network: Network): [Header, Buffer];
}

export default abstract class Header {
  abstract serialize(array: Buffer[]): void;

  abstract serializeSighash(array: Buffer[]): void;

  // XXX In typescript we can't have an abstract and static method
  static deserialize(srcBuf: Buffer, network: Network): [Header, Buffer] {
    throw new Error('Not implemented: deserialize must be implemented in subclass');
  }
}
