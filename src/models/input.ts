/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


class Input {
  // Hash of the transaction is being spent
  hash: string;
  // Index of the outputs array from the output being spent
  index: number;
  // Optional object with input signed data
  options?: {data: Buffer}

  constructor( hash, index, options = {data = null}) {
    const { data } = options;
    if (!hash) {
      throw Error('You must provide a hash.');
    }

    if (!index) {
      throw Error('You must provide an index.');
    }

    this.hash = hash;
    this.index = index;
    this.data = data;
  }
}

export default Input;
