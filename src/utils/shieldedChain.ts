/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IAddressChainOptions, IStorage, IWalletAccessData, WalletType } from '../types';
import { WalletError } from '../errors';
import walletUtils from './wallet';

/**
 * Get the scan and spend xpubs the wallet's shielded chain is derived from, or
 * null when the wallet has no shielded chain.
 *
 * `loadAddresses`, `checkGapLimit` and `deriveShieldedAddressFromStorage` all
 * decide through this check, so they always agree on whether the chain exists:
 * a gap-limit check that wants shielded indexes that address loading never
 * derives would request the same window forever.
 *
 * The chain needs a P2PKH record with both xpubs (see `walletUtils.hasShieldedXpubs`) and a
 * registered shielded crypto provider. Without a provider nothing received on
 * the chain can be decoded, so the wallet derives, stores, subscribes and
 * fetches nothing for it. Register the provider before `start()`: the first
 * sync and each reconnect load the chain from the first index of the scanning
 * policy, but the loads in between continue from the last loaded index, so a
 * provider registered on a started wallet leaves the first indexes of the
 * chain unloaded until the next reconnect. A storage without access data has
 * no shielded chain.
 *
 * This module is internal: the lib does not export it.
 *
 * @param storage The wallet storage
 * @returns The two xpubs, or null
 */
export async function getShieldedChainXpubs(
  storage: IStorage
): Promise<{ scanXpubkey: string; spendXpubkey: string } | null> {
  if (!storage.shieldedCryptoProvider) {
    return null;
  }
  const accessData = await storage.getAccessData();
  if (!walletUtils.hasShieldedXpubs(accessData)) {
    return null;
  }
  return { scanXpubkey: accessData.scanXpubkey, spendXpubkey: accessData.spendXpubkey };
}

/**
 * Why a multisig wallet has no shielded keys or addresses.
 */
const MULTISIG_SHIELDED_KEYS_MESSAGE =
  'Multisig wallets have no shielded keys or addresses: shielded keys come from one ' +
  "participant's seed, so that participant alone could spend what is sent to a shielded " +
  'address, without the other signatures the wallet requires.';

/**
 * Refuse a request for the shielded keys or addresses of a multisig wallet.
 *
 * Shielded keys are derived from the wallet's own root, at m/44'/280'/1'/0
 * (scan) and m/44'/280'/2'/0 (spend). On a multisig wallet that root belongs to
 * one participant, so that participant alone could spend what is sent to a
 * shielded address of the wallet. Until shielded outputs have a multisig
 * design, a multisig wallet has no shielded keys or addresses: none are
 * derived for it, the ones an older version stored in its record are ignored
 * (see `walletUtils.hasShieldedXpubs`), and every request for them fails with
 * this error.
 *
 * @param accessData The wallet access data. A wallet without one is not refused here.
 * @throws {WalletError} For a multisig wallet
 */
export function refuseMultisigShieldedKeys(accessData: IWalletAccessData | null): void {
  if (accessData?.walletType === WalletType.MULTISIG) {
    throw new WalletError(MULTISIG_SHIELDED_KEYS_MESSAGE);
  }
}

/**
 * Refuse a read of the shielded chain (`opts.legacy` false) of a multisig
 * wallet (see refuseMultisigShieldedKeys).
 *
 * @param storage The wallet storage
 * @param opts The chain the read is for
 * @throws {WalletError} For the shielded chain of a multisig wallet
 */
export async function refuseMultisigShieldedChain(
  storage: IStorage,
  opts?: IAddressChainOptions
): Promise<void> {
  if (opts?.legacy === false) {
    refuseMultisigShieldedKeys(await storage.getAccessData());
  }
}
