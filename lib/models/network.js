"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Version bytes for address generation
// Mainnet: P2PKH will start with H and P2SH will start with h
// Testnet: P2PKH will start with W and P2SH will start with w
const versionBytes = {
  mainnet: {
    p2pkh: 0x28,
    p2sh: 0x64,
    xpriv: 0x03523b05,
    // htpr
    xpub: 0x0488b21e // xpub // 0x03523a9c -> htpb
  },
  testnet: {
    p2pkh: 0x49,
    p2sh: 0x87,
    xpriv: 0x0434c8c4,
    // tnpr
    xpub: 0x0488b21e // xpub // 0x0434c85b -> tnpb
  },
  privatenet: {
    p2pkh: 0x49,
    p2sh: 0x87,
    xpriv: 0x0434c8c4,
    // tnpr
    xpub: 0x0488b21e // xpub // 0x0434c85b -> tnpb
  }
};

/* Networks is an object of the bitcore-lib
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
const mainnet = _bitcoreLib.Networks.add({
  name: 'htr-mainnet',
  alias: 'production',
  pubkeyhash: versionBytes.mainnet.p2pkh,
  privatekey: 0x80,
  scripthash: versionBytes.mainnet.p2sh,
  bech32prefix: 'ht',
  xpubkey: versionBytes.mainnet.xpub,
  xprivkey: versionBytes.mainnet.xpriv,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});
const testnet = _bitcoreLib.Networks.add({
  name: 'htr-testnet',
  alias: 'test',
  pubkeyhash: versionBytes.testnet.p2pkh,
  privatekey: 0x80,
  scripthash: versionBytes.testnet.p2sh,
  bech32prefix: 'tn',
  xpubkey: versionBytes.testnet.xpub,
  xprivkey: versionBytes.testnet.xpriv,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});
const privatenet = _bitcoreLib.Networks.add({
  name: 'htr-privatenet',
  alias: 'privatenet',
  pubkeyhash: versionBytes.privatenet.p2pkh,
  privatekey: 0x80,
  scripthash: versionBytes.privatenet.p2sh,
  bech32prefix: 'tn',
  xpubkey: versionBytes.privatenet.xpub,
  xprivkey: versionBytes.privatenet.xpriv,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});
const networkOptions = {
  testnet,
  mainnet,
  privatenet
};
class Network {
  constructor(name) {
    // Network name (currently supports only 'testnet' and 'mainnet')
    _defineProperty(this, "name", void 0);
    // Version bytes of the network for the p2pkh and p2sh addresses
    _defineProperty(this, "versionBytes", void 0);
    // bitcore-lib Networks object with all network options
    _defineProperty(this, "bitcoreNetwork", void 0);
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
    if (possibleNetworks.indexOf(this.name) < 0) {
      throw new Error(`We currently support only [${possibleNetworks}] as network.`);
    }
  }

  /**
   * Method created to keep compatibility with old Network class
   */
  getNetwork() {
    return this.bitcoreNetwork;
  }

  /**
   * Method created to keep compatibility with old Network class
   */
  getVersionBytes() {
    return this.versionBytes;
  }

  /**
   * Method to check that a version byte is valid
   */
  isVersionByteValid(version) {
    const instanceVersionBytes = this.getVersionBytes();
    return version === instanceVersionBytes.p2pkh || version === instanceVersionBytes.p2sh;
  }

  /**
   * Method created to keep compatibility with old Network class
   */
  setNetwork(name) {
    this.name = name;
    this.validateNetwork();
    this.versionBytes = versionBytes[name];
    this.bitcoreNetwork = networkOptions[name];
  }
}
var _default = exports.default = Network;