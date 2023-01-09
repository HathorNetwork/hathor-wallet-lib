/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Address from '../models/address';
import Network from '../models/network';
import {Address as bitcoreAddress, Script, HDPublicKey} from 'bitcore-lib';
import { IMultisigData, IStorage, IAddressInfo } from '../types';
import _ from 'lodash';
import { createP2SHRedeemScript } from './scripts';

/**
 * Parse address and return the address type
 *
 * @param {string} address
 * @param {Network} network
 *
 * @returns {string} output type of the address (p2pkh or p2sh)
 */
export const getAddressType = (address: string, network: Network): 'p2pkh'|'p2sh' => {
  const addressObj = new Address(address, { network });
  return addressObj.getType();
}

export function deriveAddressFromXPubP2PKH(xpubkey: string, index: number, networkName: string): IAddressInfo {
  const network = new Network(networkName);
  const hdpubkey = new HDPublicKey(xpubkey);
  const key = hdpubkey.deriveChild(index);
  return {
    base58: new bitcoreAddress(key.publicKey, network.bitcoreNetwork).toString(),
    bip32AddressIndex: index,
    publicKey: key.publicKey.toString('hex'),
  }
}

export async function deriveAddressP2PKH(index: number, storage: IStorage): Promise<IAddressInfo> {
  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }
  return deriveAddressFromXPubP2PKH(
    accessData.xpubkey,
    index,
    storage.config.getNetwork().name,
  );
}

export function deriveAddressFromDataP2SH(multisigData: IMultisigData, index: number, networkName: string): IAddressInfo {
  const network = new Network(networkName);
  const redeemScript = createP2SHRedeemScript(multisigData.pubkeys, multisigData.numSignatures, index);
  const address = new bitcoreAddress.payingTo(Script.fromBuffer(redeemScript), network.bitcoreNetwork);
  return {
    base58: address.toString(),
    bip32AddressIndex: index,
  }
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
  const multisigData = accessData.multisigData;
  if (multisigData === undefined) {
    throw new Error('No multisig data');
  }
  return deriveAddressFromDataP2SH(multisigData, index, storage.config.getNetwork().name);
}