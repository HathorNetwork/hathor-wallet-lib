"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createOutputScriptFromAddress = createOutputScriptFromAddress;
exports.deriveAddressFromDataP2SH = deriveAddressFromDataP2SH;
exports.deriveAddressFromXPubP2PKH = deriveAddressFromXPubP2PKH;
exports.deriveAddressP2PKH = deriveAddressP2PKH;
exports.deriveAddressP2SH = deriveAddressP2SH;
exports.getAddressFromPubkey = getAddressFromPubkey;
exports.getAddressType = getAddressType;
var _bitcoreLib = require("bitcore-lib");
var _address = _interopRequireDefault(require("../models/address"));
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _p2sh = _interopRequireDefault(require("../models/p2sh"));
var _network = _interopRequireDefault(require("../models/network"));
var _buffer = require("./buffer");
var _scripts = require("./scripts");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Parse address and return the address type
 *
 * @param {string} address
 * @param {Network} network
 *
 * @returns {string} output type of the address (p2pkh or p2sh)
 */
function getAddressType(address, network) {
  const addressObj = new _address.default(address, {
    network
  });
  return addressObj.getType();
}
function deriveAddressFromXPubP2PKH(xpubkey, index, networkName) {
  const network = new _network.default(networkName);
  const hdpubkey = new _bitcoreLib.HDPublicKey(xpubkey);
  const key = hdpubkey.deriveChild(index);
  return {
    base58: new _bitcoreLib.Address(key.publicKey, network.bitcoreNetwork).toString(),
    bip32AddressIndex: index,
    publicKey: key.publicKey.toString('hex')
  };
}
async function deriveAddressP2PKH(index, storage) {
  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }
  return deriveAddressFromXPubP2PKH(accessData.xpubkey, index, storage.config.getNetwork().name);
}
function deriveAddressFromDataP2SH(multisigData, index, networkName) {
  const network = new _network.default(networkName);
  const redeemScript = (0, _scripts.createP2SHRedeemScript)(multisigData.pubkeys, multisigData.numSignatures, index);
  // eslint-disable-next-line new-cap -- Cannot change the dependency method name
  const address = new _bitcoreLib.Address.payingTo(_bitcoreLib.Script.fromBuffer(redeemScript), network.bitcoreNetwork);
  return {
    base58: address.toString(),
    bip32AddressIndex: index
  };
}

/**
 * Derive a p2sh address at a given index with the data from a loaded storage.
 *
 * @param {number} index Address index
 * @param {IStorage} storage Wallet storage to get p2sh and access data
 *
 * @async
 * @returns {Promise<IAddressInfo>}
 */
async function deriveAddressP2SH(index, storage) {
  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }
  const {
    multisigData
  } = accessData;
  if (multisigData === undefined) {
    throw new Error('No multisig data');
  }
  return deriveAddressFromDataP2SH(multisigData, index, storage.config.getNetwork().name);
}

/**
 * Create an output script from a base58 address
 * It may be P2PKH or P2SH
 *
 * @param {output} Output with data to create the script
 *
 * @throws {AddressError} If the address is invalid
 */
function createOutputScriptFromAddress(address, network) {
  const addressObj = new _address.default(address, {
    network
  });
  // This will throw AddressError in case the address is invalid
  addressObj.validateAddress();
  const addressType = addressObj.getType();
  if (addressType === 'p2sh') {
    // P2SH
    const p2sh = new _p2sh.default(addressObj);
    return p2sh.createScript();
  }
  if (addressType === 'p2pkh') {
    // P2PKH
    const p2pkh = new _p2pkh.default(addressObj);
    return p2pkh.createScript();
  }
  throw new Error('Invalid address type');
}

/**
 * Parse the public key and return an address.
 *
 * @param pubkey Hex string conveying the public key.
 * @param network Address's network.
 * @returns The address object from parsed publicKey
 */
function getAddressFromPubkey(pubkey, network) {
  const pubkeyBuffer = (0, _buffer.hexToBuffer)(pubkey);
  const base58 = new _bitcoreLib.Address((0, _bitcoreLib.PublicKey)(pubkeyBuffer), network.bitcoreNetwork).toString();
  return new _address.default(base58, {
    network
  });
}