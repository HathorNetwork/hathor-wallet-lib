/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Networks } from 'bitcore-lib';

/**
 * Class to define the network used by the library
 *
 * @class
 * @name Network
 */
class Network {
  constructor() {
    // Default network
    // If want to use mainnet, should update this variable
    this.network = 'testnet';

    // Version bytes for address generation
    // Mainnet: P2PKH will start with H and P2SH will start with h
    // Testnet: P2PKH will start with W and P2SH will start with w
    this.versionBytes = {
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
    // networkMagic: used to send messages through the network (not used by us)
    // port: used to connect to the network (not used by us)
    // dnsSeed: list of dns to connect (not used by us)

    const mainnet = Networks.add({
      name: 'mainnet',
      alias: 'production',
      pubkeyhash: this.versionBytes['mainnet']['p2pkh'],
      privatekey: 0x80,
      scripthash: this.versionBytes['mainnet']['p2sh'],
      xpubkey: 0x0488b21e,
      xprivkey: 0x0488ade4,
      networkMagic: 0xf9beb4d9,
      port: 8333,
      dnsSeeds: []
    });

    const testnet = Networks.add({
      name: 'testnet',
      alias: 'test',
      pubkeyhash: this.versionBytes['testnet']['p2pkh'],
      privatekey: 0x80,
      scripthash: this.versionBytes['testnet']['p2sh'],
      xpubkey: 0x0488b21e,
      xprivkey: 0x0488ade4,
      networkMagic: 0xf9beb4d9,
      port: 8333,
      dnsSeeds: []
    });

    this.networkOptions = {
      testnet,
      mainnet
    }
  }

  /**
   * Set the network
   *
   * @param {string} network The new network
   */
  setNetwork(network) {
    if (!(network in this.networkOptions)) {
      throw new Error(`${network} is an invalid option for network.`);
    }
    this.network = network;
  }

  /**
   * Get network object from bitcore-lib depending on the selected network ('mainnet', 'testnet')
   *
   * @return {Networks} Networks object from bitcore-lib
   */
  getNetwork() {
    return this.networkOptions[this.network];
  }

  /**
   * Get object of version bytes of the selected network ('mainnet', 'testnet')
   *
   * @return {Object} Object with {'p2pkh': versionByte, 'p2sh': versionByte}
   */
  getVersionBytes() {
    return this.versionBytes[this.network];
  }
}

const instance = new Network();

export default instance;
