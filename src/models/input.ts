/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

type optionsType = {
  data?: Buffer | null,
};

const defaultOptions = {
  data: null
}

class Input {
  // Hash of the transaction is being spent
  hash: string;
  // Index of the outputs array from the output being spent
  index: number;
  // Input signed data
  data: Buffer | null;

  constructor(hash: string, index: number, options: optionsType = defaultOptions) {
    const newOptions = Object.assign(defaultOptions, options);
    const { data } = newOptions;

    if (!hash) {
      throw Error('You must provide a hash.');
    }

    if (isNaN(index)) {
      throw Error('You must provide an index.');
    }

    this.hash = hash;
    this.index = index;
    this.data = data;
  }
}

export default Input;
