/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IAddressChainOptions, IStorage, IWalletAccessData, WalletType } from '../types';
import { ShieldedKeyError } from '../errors';
import { ErrorMessages } from '../errorMessages';
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
 * derived for it, and the keys an older version stored in its record are
 * ignored (see `walletUtils.hasShieldedXpubs`). The four Storage shielded key
 * getters refuse them with this error, and so do HathorWallet's address
 * getters for the shielded chain. The Storage address reads are not refused:
 * the shielded addresses an older version stored for the wallet are dropped
 * when it starts instead (see dropMultisigShieldedState).
 *
 * @param accessData The wallet access data. A wallet without one is not refused here.
 * @throws {ShieldedKeyError} `shielded-multisig` for a multisig wallet
 */
export function refuseMultisigShieldedKeys(accessData: IWalletAccessData | null): void {
  if (accessData?.walletType === WalletType.MULTISIG) {
    throw new ShieldedKeyError(ErrorMessages.SHIELDED_MULTISIG, MULTISIG_SHIELDED_KEYS_MESSAGE);
  }
}

/**
 * Refuse a read of the shielded chain (`opts.legacy` false) of a multisig
 * wallet (see refuseMultisigShieldedKeys).
 *
 * @param storage The wallet storage
 * @param opts The chain the read is for
 * @throws {ShieldedKeyError} `shielded-multisig` for the shielded chain of a
 *   multisig wallet
 */
export async function refuseMultisigShieldedChain(
  storage: IStorage,
  opts?: IAddressChainOptions
): Promise<void> {
  if (opts?.legacy === false) {
    refuseMultisigShieldedKeys(await storage.getAccessData());
  }
}

/**
 * Drop the shielded state an older version stored for a multisig wallet.
 *
 * Older versions gave multisig wallets shielded address pairs of one
 * participant's keys, saved them, and decoded and credited what was paid to
 * them. A store that keeps its contents across sessions still holds all of it:
 * the Storage address reads return the pairs, every processHistory credits the
 * decoded outputs again and lists them as UTXOs, and
 * getShieldedUnblindingForTx gives out their openings.
 *
 * When the record is multisig and the store holds a shielded address, the
 * history and the addresses are cleaned, as a reconnect cleans them
 * (`HathorWallet.reloadStorage`), and the access data is saved back. The first
 * sync then loads the legacy chain and its history again. Anything else is
 * left as it is: a P2PKH wallet, and a multisig wallet whose store holds no
 * shielded address.
 *
 * @param storage The wallet storage
 */
export async function dropMultisigShieldedState(storage: IStorage): Promise<void> {
  const accessData = await storage.getAccessData();
  if (accessData?.walletType !== WalletType.MULTISIG) {
    return;
  }
  if ((await storage.store.addressCount({ legacy: false })) === 0) {
    return;
  }
  await storage.cleanStorage(true, true);
  await storage.saveAccessData(accessData);
  storage.logger.info(
    'Dropped the shielded addresses that an older version stored for this multisig wallet, ' +
      'and the history credited with them. The history is loaded again.'
  );
}
