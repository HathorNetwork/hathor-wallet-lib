/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Address from '../models/address';
import Network from '../models/network';
import { IMultisigData, IStorage, IAddressInfo } from '../types';
/**
 * Parse address and return the address type
 *
 * @param {string} address
 * @param {Network} network
 *
 * @returns {string} output type of the address (p2pkh or p2sh)
 */
export declare function getAddressType(address: string, network: Network): 'p2pkh' | 'p2sh';
export declare function deriveAddressFromXPubP2PKH(xpubkey: string, index: number, networkName: string): IAddressInfo;
export declare function deriveAddressP2PKH(index: number, storage: IStorage): Promise<IAddressInfo>;
export declare function deriveAddressFromDataP2SH(multisigData: IMultisigData, index: number, networkName: string): IAddressInfo;
/**
 * Derive a p2sh address at a given index with the data from a loaded storage.
 *
 * @param {number} index Address index
 * @param {IStorage} storage Wallet storage to get p2sh and access data
 *
 * @async
 * @returns {Promise<IAddressInfo>}
 */
export declare function deriveAddressP2SH(index: number, storage: IStorage): Promise<IAddressInfo>;
/**
 * Create an output script from a base58 address
 * It may be P2PKH or P2SH
 *
 * @param {output} Output with data to create the script
 *
 * @throws {AddressError} If the address is invalid
 */
export declare function createOutputScriptFromAddress(address: string, network: Network): Buffer;
/**
 * Parse the public key and return an address.
 *
 * @param pubkey Hex string conveying the public key.
 * @param network Address's network.
 * @returns The address object from parsed publicKey
 */
export declare function getAddressFromPubkey(pubkey: string, network: Network): Address;
//# sourceMappingURL=address.d.ts.map