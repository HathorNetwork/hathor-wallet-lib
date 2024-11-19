/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVWalletIndex, IWalletData, IWalletAccessData, AddressScanPolicy, AddressScanPolicyData, IIndexLimitAddressScanPolicy } from '../../types';
export declare const ACCESS_PREFIX = "access";
export declare const WALLET_PREFIX = "wallet";
export declare const GENERIC_PREFIX = "generic";
export default class LevelWalletIndex implements IKVWalletIndex {
    dbpath: string;
    /**
     * Database to store wallet access data.
     */
    accessDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IWalletAccessData>;
    /**
     * Database to store wallet data.
     */
    walletDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, string>;
    /**
     * Database to store generic wallet data.
     */
    genericDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, unknown>;
    indexVersion: string;
    constructor(dbpath: string);
    close(): Promise<void>;
    /**
     * Save a number as a string encoded as the hex value.
     * Internal helper method, since this logic is used in multiple places.
     *
     * @param key The key to use when setting the value.
     * @param {number} value The value to set.
     */
    _setNumber(key: string, value: number): Promise<void>;
    /**
     * Get the number from its hex value string saved on the database.
     * Internal helper method, since this logic is used in multiple places.
     *
     * @param {string} key The key to fetch.
     * @returns {Promise<number|null>}
     */
    _getNumber(key: string): Promise<number | null>;
    /**
     * Check if the index version is valid.
     * @returns {Promise<null>}
     */
    checkVersion(): Promise<void>;
    /**
     * Validate the database.
     * @returns {Promise<void>}
     */
    validate(): Promise<void>;
    /**
     * Get the configured gap limit.
     * @returns {Promise<number>} defaults to constants.GAP_LIMIT
     */
    getGapLimit(): Promise<number>;
    /**
     * Configure a wallet specific gap limit.
     * @param {number} value gap limit.
     */
    setGapLimit(value: number): Promise<void>;
    /**
     * Get the index limit.
     * @returns {Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>}
     */
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    /**
     * Get the value of the current address index.
     * The current address is the most recent unused address.
     * @returns {Promise<number>} defaults to -1
     */
    getCurrentAddressIndex(): Promise<number>;
    /**
     * Set the value of the current address index.
     * @param {number} value Current address index.
     * @returns {Promise<void>}
     */
    setCurrentAddressIndex(value: number): Promise<void>;
    /**
     * Get the value of the current network height.
     * The network height is the number of blocks on the blockchain.
     * @returns {Promise<number>} defaults to 0
     */
    getCurrentHeight(): Promise<number>;
    /**
     * Set the value of the current network height.
     * @param {number} value network height.
     * @returns {Promise<void>}
     */
    setCurrentHeight(value: number): Promise<void>;
    /**
     * Get the value of the last used address index.
     * The last used address is the highest address index that has been used.
     * @returns {Promise<number>} defaults to -1
     */
    getLastUsedAddressIndex(): Promise<number>;
    /**
     * Set the value of the last used address index.
     * @param {number} value last used address index.
     * @returns {Promise<void>}
     */
    setLastUsedAddressIndex(value: number): Promise<void>;
    /**
     * Get the value of the last loaded address index.
     * The last loaded address is the highest address index.
     * @returns {Promise<number>} defaults to 0
     */
    getLastLoadedAddressIndex(): Promise<number>;
    /**
     * Set the value of the last loaded address index.
     * @param {number} value last loaded address index.
     * @returns {Promise<void>}
     */
    setLastLoadedAddressIndex(value: number): Promise<void>;
    /**
     * Get the scanning policy.
     * @returns {Promise<AddressScanPolicy>}
     */
    getScanningPolicy(): Promise<AddressScanPolicy>;
    setScanningPolicyData(data: AddressScanPolicyData): Promise<void>;
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    /**
     * Get the wallet data.
     * @returns {Promise<IWalletData>}
     */
    getWalletData(): Promise<IWalletData>;
    /**
     * Save wallet access data.
     * @param {IWalletAccessData} data Wallet access data.
     * @returns {Promise<void>}
     */
    saveAccessData(data: IWalletAccessData): Promise<void>;
    /**
     * Get wallet access data.
     * @returns {Promise<IWalletAccessData | null>}
     */
    getAccessData(): Promise<IWalletAccessData | null>;
    /**
     * Fetch a key from the database.
     * @param key database key.
     * @returns {Promise<any>}
     */
    getItem(key: string): Promise<unknown>;
    /**
     * Save a key/value pair to the database.
     * @param {string} key database key
     * @param {any} value database value
     */
    setItem(key: string, value: unknown): Promise<void>;
    /**
     * Clean the wallet access data.
     */
    cleanAccessData(): Promise<void>;
    cleanWalletData(clear?: boolean): Promise<void>;
    /**
     * Delete all entries on the database.
     */
    clear(): Promise<void>;
}
//# sourceMappingURL=wallet_index.d.ts.map