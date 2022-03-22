/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {parseP2PKH, parseP2SH, parseScriptData} from '../../src/utils/scripts';
import Network from '../../src/models/network';

test('parseP2PKH', () => {
  const testnet = new Network('testnet');
  const mainnet = new Network('mainnet');
  const timestamp = 775796400;

  // Testnet p2pkh
  const addr1 = 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo';
  const scriptTestnet = '76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';
  const scriptTestnetTimelocked = '042e3db6b06f76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';

  const p2pkhTestnet = parseP2PKH(Buffer.from(scriptTestnet, 'hex'), testnet);
  expect(p2pkhTestnet.address.base58).toBe(addr1);
  expect(p2pkhTestnet.timelock).toBe(null);

  const p2pkhTestnetTimelocked = parseP2PKH(Buffer.from(scriptTestnetTimelocked, 'hex'), testnet);
  expect(p2pkhTestnetTimelocked.address.base58).toBe(addr1);
  expect(p2pkhTestnetTimelocked.timelock).toBe(timestamp);

  // Mainnet p2pkh
  const addr2 = 'HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb';
  const scriptMainnet = '76a914abca4eadc059d324ce46995c41065d71860ad7b088ac';
  const scriptMainnetTimelocked = '042e3db6b06f76a914abca4eadc059d324ce46995c41065d71860ad7b088ac';

  const p2pkhMainnet = parseP2PKH(Buffer.from(scriptMainnet, 'hex'), mainnet);
  expect(p2pkhMainnet.address.base58).toBe(addr2);
  expect(p2pkhMainnet.timelock).toBe(null);

  const p2pkhMainnetTimelocked = parseP2PKH(Buffer.from(scriptMainnetTimelocked, 'hex'), mainnet);
  expect(p2pkhMainnetTimelocked.address.base58).toBe(addr2);
  expect(p2pkhMainnetTimelocked.timelock).toBe(timestamp);
});

test('parseP2SH', () => {
  const testnet = new Network('testnet');
  const mainnet = new Network('mainnet');

  const script = 'a914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';
  const scriptTimelocked = '042e3db6b06fa914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';
  const timestamp = 775796400;

  // Testnet p2sh
  const addr1 = 'wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ';

  const p2shTestnet = parseP2SH(Buffer.from(script, 'hex'), testnet);
  expect(p2shTestnet.address.base58).toBe(addr1);
  expect(p2shTestnet.timelock).toBe(null);

  const p2shTestnetTimelocked = parseP2SH(Buffer.from(scriptTimelocked, 'hex'), testnet);
  expect(p2shTestnetTimelocked.address.base58).toBe(addr1);
  expect(p2shTestnetTimelocked.timelock).toBe(timestamp);

  // Mainnet p2sh
  const addr2 = 'hXRpjKbgVVGF1ioYtscCRavnzvGbsditXn';

  const p2shMainnetTimelocked = parseP2SH(Buffer.from(scriptTimelocked, 'hex'), mainnet);
  expect(p2shMainnetTimelocked.address.base58).toBe(addr2);
  expect(p2shMainnetTimelocked.timelock).toBe(timestamp);
});

test('parseScriptData', () => {
  const data = 'hathor://test';
  const script = '0d686174686f723a2f2f74657374ac';
  expect(parseScriptData(Buffer.from(script, 'hex')).data).toBe(data);
});
