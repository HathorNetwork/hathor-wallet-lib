/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Network from '../../src/models/network';


test('Get and set network', () => {
  const versionBytes = {
    'mainnet': {
      'p2pkh': 0x28,
      'p2sh': 0x64,
    },
    'testnet': {
      'p2pkh': 0x49,
      'p2sh': 0x87,
    },
  }

  // Default network is testnet
  const network = new Network('testnet');
  expect(network.bitcoreNetwork['name']).toBe('htr-testnet');
  // Must use toEqual and not toBe
  // https://jestjs.io/docs/en/expect#toequalvalue
  // Use .toEqual to compare recursively all properties of object instances (also known as "deep" equality).
  expect(network.versionBytes).toEqual(versionBytes['testnet']);

  const mainnet = new Network('mainnet');
  expect(mainnet.bitcoreNetwork['name']).toBe('htr-mainnet');
  expect(mainnet.versionBytes).toEqual(versionBytes['mainnet']);

  // Test constructor parameter
  expect(() => {
    // Invalid network
    const network2 = new Network('abc');
  }).toThrowError();
})
