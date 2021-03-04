/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Networks } from 'bitcore-lib';

// Version bytes for address generation
// Mainnet: P2PKH will start with H and P2SH will start with h
// Testnet: P2PKH will start with W and P2SH will start with w
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

// Networks is an object of the bitcore-lib
// Some of it's parameters are not used by us (network parameters), so I just kept their default
// name: network name
// alias: another name we can use as the network name
// pubkeyhash: prefix for p2pkh addresses
// scripthash: prefix for p2sh addresses
// privatekey: prefix for private key WIF (Wallet Import Format)
// xpubkey: prefix for xpubkeys (we will use 'xpub' for both mainnet and testnet)
// xprivkey: prefix for xprivkeys (we will use 'xprv' for both mainnet and testnet)
// networkMagic: used to send messages through the network (not used by us but it's important to set for bitcore-lib, so we use the same as bitcoin)
// port: used to connect to the network (not used by us but it's important to set for bitcore-lib, so we use the same as bitcoin)
// dnsSeed: list of dns to connect (not used by us but it's important to set for bitcore-lib, so we use the same as bitcoin)
const mainnet = Networks.add({
  name: 'mainnet',
  alias: 'production',
  pubkeyhash: versionBytes['mainnet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['mainnet']['p2sh'],
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});

const testnet = Networks.add({
  name: 'testnet',
  alias: 'test',
  pubkeyhash: versionBytes['testnet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['testnet']['p2sh'],
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});

const networkOptions = {
  testnet,
  mainnet
}

type versionBytesType = {
  p2pkh: number,
  p2sh: number,
}


class Network {
  // Network name (currently supports only 'testnet' and 'mainnet')
  name: string;

  // Version bytes of the network for the p2pkh and p2sh addresses
  versionBytes: versionBytesType;

  // bitcore-lib Networks object with all network options
  bitcoreNetwork: Networks;

  constructor(name: string) {
    this.name = name;
    this.validateNetwork();
    this.versionBytes = versionBytes[name];
    this.bitcoreNetwork = networkOptions[name];
  }

  /**
   * Validate the network name is valid
   */
  validateNetwork() {
    if (this.name !== 'testnet' && this.name !== 'mainnet') {
      throw Error('We currently support only mainnet and testnet as network.');
    }
  }

  /**
   * Method created to keep compatibility with old Network class
   */
  getNetwork(): Networks {
    return this.bitcoreNetwork;
  }

  /**
   * Method created to keep compatibility with old Network class
   */
  getVersionBytes(): versionBytesType {
    return this.versionBytes;
  }

  /**
   * Method created to keep compatibility with old Network class
   */
  setNetwork(name: string) {
    this.name = name;
    this.validateNetwork();
    this.versionBytes = versionBytes[name];
    this.bitcoreNetwork = networkOptions[name];
  }
}

export default Network;

