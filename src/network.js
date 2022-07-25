/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import config from './config';
import Network from './models/network';

/**
 * Extend the network to be able to set config when setNetwork is called on the singleton
 */
class ExtendedNetwork extends Network {
  constructor(name) {
    super(name);
  }

  /* Until we replace the network singleton with the new config singleton, we need to
   * maintain reverse compatibility as there are multiple use cases using the lib with
   * this network singleton
   *
   * Since config.setNetwork also calls networkInstance.setNetwork, we need the skipConfig
   * parameter to avoid a cyclic call
   *
   * TODO: Remove this when the network singleton is completely deprecated
   */
  setNetwork(name, skipConfig = false) {
    super.setNetwork(name);

    if (!skipConfig) {
      config.setNetwork(name);
    }
  }
}

// Default network for the lib is testnet
const instance = new ExtendedNetwork('testnet');

export default instance;
