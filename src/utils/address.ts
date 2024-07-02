/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Address as BitcoreAddress,
  PublicKey as bitcorePublicKey,
  Script,
  HDPublicKey,
} from 'bitcore-lib';
import Address from '../models/address';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import Network from '../models/network';
import { hexToBuffer } from './buffer';
import { IMultisigData, IStorage, IAddressInfo } from '../types';
import { createP2SHRedeemScript } from './scripts';

/**
 * Parse address and return the address type
 *
 * @param {string} address
 * @param {Network} network
 *
 * @returns {string} output type of the address (p2pkh or p2sh)
 */
export function getAddressType(address: string, network: Network): 'p2pkh' | 'p2sh' {
  const addressObj = new Address(address, { network });
  return addressObj.getType();
}

export function deriveAddressFromXPubP2PKH(
  xpubkey: string,
  index: number,
  networkName: string
): IAddressInfo {
  const network = new Network(networkName);
  const hdpubkey = new HDPublicKey(xpubkey);
  const key = hdpubkey.deriveChild(index);
  return {
    base58: new BitcoreAddress(key.publicKey, network.bitcoreNetwork).toString(),
    bip32AddressIndex: index,
    publicKey: key.publicKey.toString('hex'),
  };
}

export async function deriveAddressP2PKH(index: number, storage: IStorage): Promise<IAddressInfo> {
  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }
  return deriveAddressFromXPubP2PKH(accessData.xpubkey, index, storage.config.getNetwork().name);
}

export function deriveAddressFromDataP2SH(
  multisigData: IMultisigData,
  index: number,
  networkName: string
): IAddressInfo {
  const network = new Network(networkName);
  const redeemScript = createP2SHRedeemScript(
    multisigData.pubkeys,
    multisigData.numSignatures,
    index
  );
  // eslint-disable-next-line new-cap -- Cannot change the dependency method name
  const address = new BitcoreAddress.payingTo(
    Script.fromBuffer(redeemScript),
    network.bitcoreNetwork
  );
  return {
    base58: address.toString(),
    bip32AddressIndex: index,
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
export async function deriveAddressP2SH(index: number, storage: IStorage): Promise<IAddressInfo> {
  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }
  const { multisigData } = accessData;
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
export function createOutputScriptFromAddress(address: string, network: Network): Buffer {
  const addressObj = new Address(address, { network });
  // This will throw AddressError in case the address is invalid
  addressObj.validateAddress();
  const addressType = addressObj.getType();
  if (addressType === 'p2sh') {
    // P2SH
    const p2sh = new P2SH(addressObj);
    return p2sh.createScript();
  }
  if (addressType === 'p2pkh') {
    // P2PKH
    const p2pkh = new P2PKH(addressObj);
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
export function getAddressFromPubkey(pubkey: string, network: Network): Address {
  const pubkeyBuffer = hexToBuffer(pubkey);
  const base58 = new BitcoreAddress(
    bitcorePublicKey(pubkeyBuffer),
    network.bitcoreNetwork
  ).toString();
  return new Address(base58, { network });
}
