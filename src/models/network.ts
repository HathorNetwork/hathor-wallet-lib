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
    'xpriv': 0x03523b05, // htpr
    'xpub': 0x0488b21e,  // xpub // 0x03523a9c -> htpb
  },
  'testnet': {
    'p2pkh': 0x49,
    'p2sh': 0x87,
    'xpriv': 0x0434c8c4, // tnpr
    'xpub': 0x0488b21e,  // xpub // 0x0434c85b -> tnpb
  },
  'privatenet': {
    'p2pkh': 0x49,
    'p2sh': 0x87,
    'xpriv': 0x0434c8c4, // tnpr
    'xpub': 0x0488b21e,  // xpub // 0x0434c85b -> tnpb
  },
}

/*Networks is an object of the bitcore-lib
  Some of it's parameters are not used by us (network parameters)
  Parameters:
    name: network name
    alias: another name we can use as the network name
    pubkeyhash: prefix for p2pkh addresses
    scripthash: prefix for p2sh addresses
    privatekey: prefix for private key WIF (Wallet Import Format)
    bech32prefix: prefix for bech32 addresses (we will use 'bc' for both mainnet and testnet)
    xpubkey: prefix for xpubkeys (we will use 'xpub' for both mainnet and testnet)
    xprivkey: prefix for xprivkeys (we will use 'xprv' for both mainnet and testnet)
    networkMagic: used to send messages through the network (not used by us but it's important to set for bitcore-lib, so we use the same as bitcoin)
    port: used to connect to the network (not used by us but it's important to set for bitcore-lib, so we use the same as bitcoin)
    dnsSeed: list of dns to connect (not used by us but it's important to set for bitcore-lib, so we use the same as bitcoin)

  Bitcore internally maps these parameters to the networks, so having the same parameters as bitcoin's could pose an issue
  Ideally we would remove bitcoin networks as to not have any conflicts, but the remove itself is having some issues https://github.com/bitpay/bitcore/issues/2400
  # xprivkey
    it's used as a metadata on the serialized HDPrivateKey, it does not affect the privateKey and derivated private keys (public keys as well)
    internally, bitcore uses this to bind a HDPrivateKey to a network, since we have parameters in common with bitcoin's network, we are having some issues with bitcore
    not keeping our networks on the HDPrivateKey object when deriving or instantiating from the seed.
  # xpubkey
    Very similar to xprivkey but for HDPublicKey
  # privatekey
    The privateKey works very similarly to xprivkey but for private keys, the first byte on the WIF format is this number.
    This also does not appear to affect generated addresses (if we specify the network when generating the address)

  # WARNING
    Our primary concern is that the generated addresses would be affected, but our address util (hathor.walletUtils.getAddresses on utils/wallet.ts) instantiate the address with our network
    this keeps the generated addresses as ours even if the network changes on the original HDPrivateKey object (or any other).
    So remember to pass our network when changing to addresses (i.e. pubkey.toAddress(hathorNetwork)) or use our address util.
    If you need to use the serialized format of the HDPrivateKey or HDPublicKey be aware that later we may stop using bitcoin's prefix in favor of hathor's prefix
*/
const mainnet = Networks.add({
  name: 'htr-mainnet',
  alias: 'production',
  pubkeyhash: versionBytes['mainnet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['mainnet']['p2sh'],
  bech32prefix: 'ht',
  xpubkey: versionBytes['mainnet']['xpub'],
  xprivkey: versionBytes['mainnet']['xpriv'],
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});

const testnet = Networks.add({
  name: 'htr-testnet',
  alias: 'test',
  pubkeyhash: versionBytes['testnet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['testnet']['p2sh'],
  bech32prefix: 'tn',
  xpubkey: versionBytes['testnet']['xpub'],
  xprivkey: versionBytes['testnet']['xpriv'],
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});

const privatenet = Networks.add({
  name: 'htr-privatenet',
  alias: 'privatenet',
  pubkeyhash: versionBytes['privatenet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['privatenet']['p2sh'],
  bech32prefix: 'tn',
  xpubkey: versionBytes['privatenet']['xpub'],
  xprivkey: versionBytes['privatenet']['xpriv'],
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
})

const networkOptions = {
  testnet,
  mainnet,
  privatenet
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
    const possibleNetworks = Object.keys(networkOptions);

    if (!possibleNetworks.includes(this.name)) {
      throw Error(`We currently support only ${possibleNetworks} as network.`);
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

