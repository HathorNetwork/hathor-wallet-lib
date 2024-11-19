/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVUtxoIndex, IUtxo, IUtxoFilterOptions, ILockedUtxo } from '../../types';
export declare const UTXO_PREFIX = "utxo";
export declare const TOKEN_ADDRESS_UTXO_PREFIX = "token:address:utxo";
export declare const TOKEN_UTXO_PREFIX = "token:utxo";
export declare const LOCKED_UTXO_PREFIX = "locked:utxo";
export default class LevelUtxoIndex implements IKVUtxoIndex {
    dbpath: string;
    /**
     * Main utxo database
     * Key: tx_id:index
     * Value: IUtxo (json encoded)
     */
    utxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
    /**
     * Reverse search index for utxo database
     * Key: authorities:token:value:tx_id:index
     * Value: IUtxo (json encoded)
     */
    tokenUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
    /**
     * Reverse search index for utxo database
     * Key: authorities:token:address:value:tx_id:index
     * Value: IUtxo (json encoded)
     */
    tokenAddressUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
    /**
     * Locked utxo database
     * Key: tx_id:index
     * Value: ILockedUtxo (json encoded)
     */
    lockedUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ILockedUtxo>;
    indexVersion: string;
    constructor(dbpath: string);
    /**
     * Close the database and the sublevel children.
     * @returns {Promise<void>}
     */
    close(): Promise<void>;
    /**
     * Check that the index version matches the expected version.
     * @returns {Promise<void>}
     */
    checkVersion(): Promise<void>;
    validate(): Promise<void>;
    /**
     * Iterate on all utxos in the database.
     * @returns {AsyncGenerator<IUtxo>}
     */
    utxoIter(): AsyncGenerator<IUtxo>;
    /**
     * Select utxos to match the given filter options.
     *
     * Depending on which options are set, the utxos will be filtered using different indexes.
     * We expect `token` and `authorities` to always be set.
     * If we have `address` set, we will use the `tokenAddressUtxoDB` index.
     * Otherwise we will use the `tokenUtxoDB` index.
     *
     * The value filter works since we use the uint64 in big endian.
     *
     * @param {IUtxoFilterOptions} options Which parameters to use to filter the utxos.
     * @param {number|undefined} networkHeight Height of the network, used to check if the utxo is height locked
     * @returns {AsyncGenerator<IUtxo>}
     */
    selectUtxos(options: IUtxoFilterOptions, networkHeight?: number): AsyncGenerator<IUtxo>;
    /**
     * Save utxo on the database.
     * Also save on all reverse search indexes.
     * @param {IUtxo} utxo
     * @returns {Promise<void>}
     */
    saveUtxo(utxo: IUtxo): Promise<void>;
    /**
     * Save a locked utxo on the database.
     *
     * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
     * @returns {Promise<void>}
     */
    saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    /**
     * Remove a locked utxo from the database.
     * @param {ILockedUtxo} lockedUtxo Locked utxo to be unlocked
     * @returns {Promise<void>}
     */
    unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    /**
     * Iterate on all locked utxos
     * @returns {AsyncGenerator<ILockedUtxo>}
     */
    iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
    /**
     * Clear all entries from the database.
     * @returns {Promise<void>}
     */
    clear(): Promise<void>;
}
//# sourceMappingURL=utxo_index.d.ts.map