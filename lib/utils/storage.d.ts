/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import FullnodeConnection from '../new/connection';
import { IStorage, IHistoryTx, ILockedUtxo, IScanPolicyLoadAddresses, HistorySyncMode, HistorySyncFunction } from '../types';
/**
 * Get history sync method for a given mode
 * @param {HistorySyncMode} mode The mode of the stream
 * @returns {HistorySyncFunction}
 */
export declare function getHistorySyncMethod(mode: HistorySyncMode): HistorySyncFunction;
export declare function getSupportedSyncMode(storage: IStorage): Promise<HistorySyncMode[]>;
/**
 * Derive requested addresses (if not already loaded), save them on storage then return them.
 * @param {number} startIndex Index to start loading addresses
 * @param {number} count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @returns {Promise<stringp[]>} List of loaded addresses in base58
 */
export declare function loadAddresses(startIndex: number, count: number, storage: IStorage): Promise<string[]>;
/**
 * Fetch the history of the addresses and save it on storage.
 * Optionally process the history after loading it.
 *
 * @param {number} startIndex Index to start loading addresses
 * @param {number} count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @param {FullnodeConnection} connection Connection to the full node
 * @param {boolean} shouldProcessHistory If we should process the history after loading it.
 */
export declare function apiSyncHistory(startIndex: number, count: number, storage: IStorage, connection: FullnodeConnection, shouldProcessHistory?: boolean): Promise<void>;
/**
 * Fetch the tx history for a chunkified list of addresses.
 * This method returns an AsyncGenerator so that the caller can update the UI if any transaction is found during the load process.
 *
 * @param {stringp[]} addresses List of addresses to load history
 * @param {IStorage} storage The storage to load the addresses
 * @returns {AsyncGenerator<boolean>} If we found any transaction in the history
 */
export declare function loadAddressHistory(addresses: string[], storage: IStorage): AsyncGenerator<boolean>;
/**
 * Get the starting addresses to load from the scanning policy
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses>}
 */
export declare function scanPolicyStartAddresses(storage: IStorage): Promise<IScanPolicyLoadAddresses>;
/**
 * Use the correct method for the configured address scanning policy to check if we should
 * load more addresses
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
export declare function checkScanningPolicy(storage: IStorage): Promise<IScanPolicyLoadAddresses | null>;
/**
 * Check if the addresses loaded in storage are within policy specifications.
 * If it doesn't, it will return the next index to load and the number of addresses to fill the gap.
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
export declare function checkIndexLimit(storage: IStorage): Promise<IScanPolicyLoadAddresses | null>;
/**
 * Check if the storage has at least `gapLimit` addresses loaded without any transaction.
 * If it doesn't, it will return the next index to load and the number of addresses to fill the gap.
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
export declare function checkGapLimit(storage: IStorage): Promise<IScanPolicyLoadAddresses | null>;
/**
 * Process the history of transactions and create metadata to be used by the wallet.
 *
 * History processing is a complex and nuanced method so we created a utility to avoid errors on other store implementations.
 * This utility only uses the store methods so it can be used by any store implementation.
 *
 * @param {IStorage} storage Storage instance.
 * @param {{rewardLock: number}} [options={}] Use this configuration when processing the storage
 * @async
 * @returns {Promise<void>}
 */
export declare function processHistory(storage: IStorage, { rewardLock }?: {
    rewardLock?: number;
}): Promise<void>;
/**
 * Fetch and save the data of the token set on the storage
 * @param {IStorage} storage - Storage to save the tokens.
 * @param {Set<string>} tokens - set of tokens to fetch and save.
 * @returns {Promise<void>}
 */
export declare function _updateTokensData(storage: IStorage, tokens: Set<string>): Promise<void>;
/**
 * Process a new transaction, adding or creating the metadata for the addresses and tokens involved.
 * Will update relevant wallet data and utxos.
 * The return object contains the max address index used and the tokens found in the transaction.
 *
 * @param {IStorage} storage Storage instance.
 * @param {IHistoryTx} tx The new transaction to be processed
 * @param {Object} [options]
 * @param {number} [options.rewardLock] The reward lock of the network
 * @param {number} [options.nowTs] The current timestamp
 * @param {number} [options.currentHeight] The current height of the best chain
 * @returns {Promise<{ maxAddressIndex: number, tokens: Set<string> }>}
 */
export declare function processNewTx(storage: IStorage, tx: IHistoryTx, { rewardLock, nowTs, currentHeight, }?: {
    rewardLock?: number;
    nowTs?: number;
    currentHeight?: number;
}): Promise<{
    maxAddressIndex: number;
    tokens: Set<string>;
}>;
/**
 * Process locked utxo and update the balances.
 * If the utxo is still locked nothing is done.
 *
 * @param {IStorage} storage Storage instance.
 * @param {ILockedUtxo} lockedUtxo The utxo to be unlocked
 * @param {Object} [options]
 * @param {number} [options.rewardLock] The reward lock of the network
 * @param {number} [options.nowTs] The current timestamp
 * @param {number} [options.currentHeight] The current height of the best chain
 * @returns {Promise<void>}
 */
export declare function processUtxoUnlock(storage: IStorage, lockedUtxo: ILockedUtxo, { rewardLock, nowTs, currentHeight, }?: {
    rewardLock?: number;
    nowTs?: number;
    currentHeight?: number;
}): Promise<void>;
//# sourceMappingURL=storage.d.ts.map