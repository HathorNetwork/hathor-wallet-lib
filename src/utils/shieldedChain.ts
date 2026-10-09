/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage } from '../types';
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
 * The chain needs both xpubs (see `walletUtils.hasShieldedXpubs`) and a
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
