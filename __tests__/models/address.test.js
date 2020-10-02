/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Address from '../../src/models/address';
import Network from '../../src/models/network';


test('Validate address', () => {
  // Invalid address
  const addr1 = new Address('abc');
  expect(addr1.isValid()).toBe(false);

  // Mainnet address
  const addr2 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb');
  // It will be invalid because the default network is testnet
  expect(addr2.isValid()).toBe(false);

  // Testnet address
  const addr3 = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  expect(addr3.isValid()).toBe(true);

  // Mainnet address with mainnet network
  const mainnetNetwork = new Network('mainnet')
  const addr4 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb', {network: mainnetNetwork});
  expect(addr4.isValid()).toBe(true);
})
