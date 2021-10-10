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
      'xpriv': 0x03523b05,
      'xpub': 0x0488b21e,
    },
    'testnet': {
      'p2pkh': 0x49,
      'p2sh': 0x87,
      'xpriv': 0x0434c8c4,
      'xpub': 0x0488b21e,
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
});

test("register new network successfully", () => {
  Network.registerNetwork({
    name: 'jestnet',
    alias: 'jestnet',
    pubkeyhash: 0x70,
    privatekey: 0x80,
    scripthash: 0x93,
    bech32prefix: 'tn',
    xpubkey: 0x0488b21e,
    xprivkey: 0x0434c8c4,
    networkMagic: 0xf9beb4d9,
    port: 8333,
    dnsSeeds: []
  });

  // This shouldn't throw error
  const network = new Network('jestnet');

  expect(network.getVersionBytes()).toEqual({
    'p2pkh': 0x70,
    'p2sh': 0x93,
    'xpub': 0x0488b21e,
    'xpriv': 0x0434c8c4
  })
});

const getNetworkConfig = (override) => {
  return Object.assign({
    name: 'jestnet',
    alias: 'jestnet',
    pubkeyhash: 0x70,
    privatekey: 0x80,
    scripthash: 0x93,
    bech32prefix: 'tn',
    xpubkey: 0x0488b21e,
    xprivkey: 0x0434c8c4,
    networkMagic: 0xf9beb4d9,
    port: 8333,
    dnsSeeds: []
  }, override);
}

test("register invalid network config", () => {
  Object.entries({
    'name': undefined,
    'alias': undefined,
    'pubkeyhash': undefined,
    'pubkeyhash': 'abc',
    'pubkeyhash': 0x111,
    'privatekey': undefined,
    'privatekey': 'abc',
    'privatekey': 0x111,
    'scripthash': undefined,
    'bech32prefix': undefined,
    'xpubkey': undefined,
    'xpubkey': 'abc',
    'xprivkey': undefined,
    'xprivkey': 'abc',
    'networkMagic': undefined,
    'networkMagic': 'abc',
    'port': undefined,
    'port': 'abc',
    'dnsSeeds': undefined,
    'dnsSeeds': 'abc',
    'dnsSeeds': 123
  }).forEach(([key, value]) => {
    expect(() => {
      Network.registerNetwork(
        getNetworkConfig({
          [key]: value,
        })
      );
    }).toThrowError(`Validation errors in network definition: Error: ${key} is invalid.`)
  })
});
