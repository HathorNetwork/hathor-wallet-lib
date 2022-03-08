/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import P2PKH from '../../src/models/p2pkh';
import Address from '../../src/models/address';
import Network from '../../src/models/network';

test('createScript', () => {
  const testnet = new Network('testnet');
  const mainnet = new Network('mainnet');

  // Testnet p2sh
  const addr1 = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', {network: testnet});
  // Mainnet p2sh
  const addr2 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb', {network: mainnet});

  const timestamp = 775796400;
  const scriptTestnet = '76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';
  const scriptTestnetTimelocked = '042e3db6b06f76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';
  const scriptMainnet = '76a914abca4eadc059d324ce46995c41065d71860ad7b088ac';
  const scriptMainnetTimelocked = '042e3db6b06f76a914abca4eadc059d324ce46995c41065d71860ad7b088ac';

  // TESTNET
  const st1 = new P2PKH(addr1);
  const st2 = new P2PKH(addr1, {timelock: 775796400});
  expect(st1.createScript().toString('hex')).toBe(scriptTestnet);
  expect(st2.createScript().toString('hex')).toBe(scriptTestnetTimelocked);

  // MAINNET
  const sm1 = new P2PKH(addr2);
  const sm2 = new P2PKH(addr2, {timelock: 775796400});
  expect(sm1.createScript().toString('hex')).toBe(scriptMainnet);
  expect(sm2.createScript().toString('hex')).toBe(scriptMainnetTimelocked);
});
