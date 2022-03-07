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

  // Invalid checksum
  const addr5 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSc', {network: mainnetNetwork});
  expect(addr5.isValid()).toBe(false);
})

test('Address getType', () => {

  // Testnet p2pkh
  const addr1 = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  expect(addr1.getType()).toBe('p2pkh');

  // Testnet p2sh
  const addr2 = new Address('wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ');
  expect(addr2.getType()).toBe('p2sh');

  const mainnetNetwork = new Network('mainnet')

  // Mainnet p2pkh
  const addr3 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb', {network: mainnetNetwork});
  expect(addr3.getType()).toBe('p2pkh');

  // Mainnet p2sh
  const addr4 = new Address('hXRpjKbgVVGF1ioYtscCRavnzvGbsditXn', {network: mainnetNetwork});
  expect(addr4.getType()).toBe('p2sh');
});
