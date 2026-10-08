/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage } from '../types';
import walletUtils from './wallet';
import { shieldedSessionOf } from '../shielded/session';

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
 * fetches nothing for it. The first sync and each reconnect load the chain from
 * the first index of the scanning policy, and so does the walk a started
 * HathorWallet runs when a provider is registered on it (see
 * `HathorWallet.setShieldedCryptoProvider`). The loads in between continue from
 * the last loaded index. A storage without access data has no shielded chain.
 *
 * Nor has a wallet whose started session found the record's shielded keys
 * inconsistent: the stored xpubs are not trusted, so nothing is derived from
 * them until the record is repaired.
 *
 * This module is internal: the lib does not export it.
 *
 * @param storage The wallet storage
 * @returns The two xpubs, or null
 */
export async function getShieldedChainXpubs(
  storage: IStorage
): Promise<{ scanXpubkey: string; spendXpubkey: string } | null> {
  if (!storage.shieldedCryptoProvider || shieldedSessionOf(storage).integrity !== null) {
    return null;
  }
  const accessData = await storage.getAccessData();
  if (!walletUtils.hasShieldedXpubs(accessData)) {
    return null;
  }
  return { scanXpubkey: accessData.scanXpubkey, spendXpubkey: accessData.spendXpubkey };
}
