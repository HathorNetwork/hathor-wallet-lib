/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Network from './models/network';

// Default network for the lib is testnet
const instance = new Network('testnet');

export default instance;
