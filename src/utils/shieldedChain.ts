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
 * The chain needs both xpubs (see `walletUtils.hasShieldedXpubs`). A storage
 * without access data has no shielded chain.
 *
 * This module is internal: the lib does not export it.
 *
 * @param storage The wallet storage
 * @returns The two xpubs, or null
 */
export async function getShieldedChainXpubs(
  storage: IStorage
): Promise<{ scanXpubkey: string; spendXpubkey: string } | null> {
  const accessData = await storage.getAccessData();
  if (!walletUtils.hasShieldedXpubs(accessData)) {
    return null;
  }
  return { scanXpubkey: accessData.scanXpubkey, spendXpubkey: accessData.spendXpubkey };
}
