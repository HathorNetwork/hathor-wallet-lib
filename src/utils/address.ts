/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Address as BitcoreAddress,
  PrivateKey,
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
import { deriveShieldedAddress } from './shieldedAddress';
import { WalletError } from '../errors';

/**
 * Parse address and return its OUTPUT SCRIPT type.
 *
 * This util answers "which script does an output to this address use" —
 * every caller (send pipeline, token utils, storage fillTx, nano builder)
 * feeds the result into output building. Shielded addresses have no output
 * script form of their own (on-chain they use the spend-derived P2PKH), so
 * this throws for them rather than letting a 71-byte address reach script
 * builders.
 *
 * For the general address-family classifier — including 'shielded' — use
 * `new Address(address, { network }).getType()` instead.
 *
 * @param {string} address
 * @param {Network} network
 *
 * @returns {'p2pkh' | 'p2sh'} output script type of the address
 */
export function getAddressType(address: string, network: Network): 'p2pkh' | 'p2sh' {
  const addressObj = new Address(address, { network });
  const addrType = addressObj.getType();
  if (addrType === 'shielded') {
    throw new Error(
      'Shielded addresses cannot be used directly as output script type. ' +
        'Use the spend-derived P2PKH address instead — obtain it via ' +
        '`new Address(addr, { network }).getSpendAddress().base58`.'
    );
  }
  return addrType;
}

/**
 * Resolve an address to the form usable as a transparent output script.
 *
 * A 71-byte address in the wallet's universal format has no single transparent
 * output script (on-chain a transparent output at it uses the spend-derived
 * P2PKH), so this returns the spend address base58 for such an address and the
 * address unchanged otherwise. Use it before `getAddressType` / output building
 * wherever a caller-supplied address may be in the 71-byte format — e.g. a
 * change address in token creation (otherwise getAddressType throws). This is
 * the uniform address->script resolution the transaction layer
 * (createOutputScript) applies to every output address; it produces a plain
 * TRANSPARENT output, not a shielded one.
 *
 * @param {string} address base58 address (may be shielded)
 * @param {Network} network
 * @returns {string} spend-derived P2PKH base58 if shielded, else `address`
 */
export function resolveOutputScriptAddress(address: string, network: Network): string {
  const addressObj = new Address(address, { network });
  if (addressObj.getType() === 'shielded') {
    return addressObj.getSpendAddress().base58;
  }
  return address;
}

/**
 * Convert a bitcore PublicKey to a base58 P2PKH address string.
 */
export function publicKeyToP2PKH(
  publicKey: InstanceType<typeof bitcorePublicKey>,
  network: Network
): string {
  return new BitcoreAddress(publicKey, network.bitcoreNetwork).toString();
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
    base58: publicKeyToP2PKH(key.publicKey, network),
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

/**
 * Encode a P2SH redeem script as its base58 address for the given network.
 *
 * @param {Buffer} redeemScript The P2SH redeem script
 * @param {Network} network Network to encode the address for
 *
 * @returns {string} The base58 P2SH address
 */
export function redeemScriptToP2SHAddress(redeemScript: Buffer, network: Network): string {
  // eslint-disable-next-line new-cap -- Cannot change the dependency method name
  const address = new BitcoreAddress.payingTo(
    Script.fromBuffer(redeemScript),
    network.bitcoreNetwork
  );
  return address.toString();
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
  return {
    base58: redeemScriptToP2SHAddress(redeemScript, network),
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
  if (addressType === 'shielded') {
    // For shielded addresses, derive P2PKH script from spend_pubkey
    const spendAddress = addressObj.getSpendAddress();
    const p2pkh = new P2PKH(spendAddress);
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

/**
 * Fetch an address private key from the storage's external provider and verify it corresponds to
 * the requested address. A buggy or mismatched provider could otherwise return the wrong key, which
 * would sign with the wrong key and could create an unspendable utxo. Shared by both facades'
 * `getVerifiedExternalPrivateKey`.
 *
 * Callers that know the requested address must pass it as `options.expectedAddress`. An index
 * alone is ambiguous (the legacy, shielded and shielded-spend addresses of one BIP32 index share
 * it), so checking only against the address at the index could accept the legacy key for a
 * shielded-spend request. Index-based callers fall back to `getOwnAddress(addressIndex)`.
 *
 * @param storage Storage holding the external private-key provider
 * @param network The wallet's network
 * @param addressIndex Index whose private key to fetch
 * @param getOwnAddress Resolves the wallet's own (legacy) address at an index; each facade passes
 *   its own lookup
 * @param [options.pinCode] Forwarded to the provider
 * @param [options.expectedAddress] The address the key must own, when the caller knows it. Used
 *   only for verification; it is not forwarded to the provider.
 * @returns The verified private key
 */
export async function fetchVerifiedExternalPrivateKey(
  storage: IStorage,
  network: Network,
  addressIndex: number,
  getOwnAddress: (index: number) => Promise<string>,
  options: { pinCode?: string; expectedAddress?: string } = {}
): Promise<PrivateKey> {
  // expectedAddress is verification-only: keep it out of the PrivateKeyProvider contract.
  const { expectedAddress, ...providerOptions } = options;
  const privateKey = await storage.getExternalPrivateKey(addressIndex, providerOptions);
  if (!(privateKey instanceof PrivateKey)) {
    throw new WalletError('External private key provider must return a bitcore PrivateKey.');
  }
  // bitcore's typings don't narrow `unknown` through instanceof, hence the cast.
  const key = privateKey as PrivateKey;
  const derivedAddress = getAddressFromPubkey(key.publicKey.toString(), network).base58;
  const ownerAddress = expectedAddress ?? (await getOwnAddress(addressIndex));
  if (derivedAddress !== ownerAddress) {
    throw new WalletError('External private key provider returned a key for the wrong address.');
  }
  return key;
}

/**
 * Derive the shielded address pair (user-facing shielded + on-chain spend P2PKH)
 * at a given index from the scan/spend parent keys.
 *
 * The parents may be xpub strings or already-parsed HDPublicKey instances —
 * callers deriving many indexes (address loading) should parse once and pass
 * the instances (see deriveShieldedAddress).
 *
 * Returns two IAddressInfo entries:
 * 1. The shielded address (user-facing, 71-byte format)
 * 2. The spend-derived P2PKH address (on-chain, for matching incoming txs)
 */
export function deriveShieldedAddressPair(
  scanXpub: string | HDPublicKey,
  spendXpub: string | HDPublicKey,
  index: number,
  networkName: string
): { shieldedAddress: IAddressInfo; spendAddress: IAddressInfo } {
  const info = deriveShieldedAddress(scanXpub, spendXpub, index, networkName);

  // The user-facing shielded address encodes both scan and spend pubkeys.
  // This is what users share with senders to receive shielded outputs.
  const shieldedAddress: IAddressInfo = {
    base58: info.base58,
    bip32AddressIndex: index,
    publicKey: info.scanPubkey,
    addressType: 'shielded',
    // Pair link: from the user-facing shielded address to its on-chain spend P2PKH.
    ctMappingAddress: info.spendAddress,
  };

  // The on-chain P2PKH derived from the spend pubkey (spend_pubkey → HASH160 → P2PKH).
  // Stored separately so the wallet can match incoming transactions by decoded.address,
  // since on-chain scripts reference this P2PKH, not the shielded address.
  const spendAddress: IAddressInfo = {
    base58: info.spendAddress,
    bip32AddressIndex: index,
    publicKey: info.spendPubkey,
    addressType: 'shielded-spend',
    // Pair link: from the on-chain spend P2PKH back to the user-facing shielded address.
    ctMappingAddress: info.base58,
  };

  return { shieldedAddress, spendAddress };
}

/**
 * Derive shielded address and its on-chain spend address from storage at a given index.
 *
 * Returns two IAddressInfo entries:
 * 1. The shielded address (user-facing, 71-byte format)
 * 2. The spend-derived P2PKH address (on-chain, for matching incoming txs)
 *
 * Returns null if the wallet doesn't have shielded key material.
 */
export async function deriveShieldedAddressFromStorage(
  index: number,
  storage: IStorage
): Promise<{ shieldedAddress: IAddressInfo; spendAddress: IAddressInfo } | null> {
  const scanXpub = await storage.getScanXPubKey();
  const spendXpub = await storage.getSpendXPubKey();
  if (!scanXpub || !spendXpub) {
    return null;
  }

  const networkName = storage.config.getNetwork().name;
  return deriveShieldedAddressPair(scanXpub, spendXpub, index, networkName);
}
