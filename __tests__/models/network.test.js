/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Network from '../../src/models/network';


test('Get and set network', () => {
  // Default network is testnet
  const network = new Network('testnet');
  expect(network.getNetwork()).toBe(network.networkOptions['testnet']);
  expect(network.getNetwork()['name']).toBe('testnet');
  expect(network.getVersionBytes()).toBe(network.versionBytes['testnet']);

  // Test setNetwork
  expect(() => {
    // Invalid network
    network.setNetwork('abc');
  }).toThrowError();

  network.setNetwork('mainnet');
  expect(network.getNetwork()).toBe(network.networkOptions['mainnet']);
  expect(network.getNetwork()['name']).toBe('mainnet');
  expect(network.getVersionBytes()).toBe(network.versionBytes['mainnet']);

  // Test constructor parameter
  expect(() => {
    // Invalid network
    const network2 = new Network('abc');
  }).toThrowError();
})