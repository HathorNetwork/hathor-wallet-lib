/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../src/new/wallet';

export default class FakeHathorWallet {
  constructor() {
    // Will bind all methods to this instance
    for (const method of Object.getOwnPropertyNames(HathorWallet.prototype)) {
      if (method === 'constructor' || !(method && HathorWallet.prototype[method])) {
        // Skip methods not in prototype
        continue;
      }
      // All methods can be spied on and mocked.
      this[method] = jest.fn().mockImplementation(HathorWallet.prototype[method].bind(this));
    }
  }
}
