/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVHistoryIndex, IHistoryTx, HistoryIndexValidateResponse } from '../../types';
export declare const HISTORY_PREFIX = "history";
export declare const TS_HISTORY_PREFIX = "ts_history";
export default class LevelHistoryIndex implements IKVHistoryIndex {
    dbpath: string;
    /**
     * Main tx history database:
     * Key: tx_id
     * Value: IHistoryTx (json encoded)
     */
    historyDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IHistoryTx>;
    /**
     * Timestamp index, used to iterate on transaction in order.
     * Key: timestamp:tx_id
     * Value: IHistoryTx (json encoded)
     */
    tsHistoryDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IHistoryTx>;
    /**
     * Whether the index is validated or not
     * This is used to avoid using the tx count before we know it is valid.
     */
    isValidated: boolean;
    size: number;
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
    /**
     * Validate the index.
     * This method iterates on all transactions and checks that we have a corresponding entry on the timestamp index.
     * If we find a missing entry, we create it.
     * @returns {Promise<HistoryIndexValidateResponse>}
     */
    validate(): Promise<HistoryIndexValidateResponse>;
    /**
     * Get the number of txs in the database.
     *
     * leveldb does not have a count method and the feature request for this was rejected (see https://github.com/google/leveldb/issues/119).
     * As stated in the issue above "There is no way to implement count more efficiently inside leveldb than outside."
     * This means that the best way to count the number of entries would be to iterate on all keys and count them.
     * Another sugestion would be to have an external count of txs, this is done with the this.size variable.
     *
     * The problem with this.size is that it is not updated when we start a database.
     * This is why we update the size when we validate the index and then we can use the pre-calculated size.
     * If the index has not been validated we will run a full count.
     * While a full count runs in O(n) it has been confirmed to be very fast with leveldb.
     * And since the wallet runs the validation when it starts we do not expect to use the full count with a running wallet.
     *
     * @returns {Promise<number>} The number of txs in the database
     */
    historyCount(): Promise<number>;
    /**
     * Run a full count of the txs in the database.
     *
     * @returns {Promise<number>} The number of txs in the database
     */
    runHistoryCount(): Promise<number>;
    /**
     * Iterate on the tx history.
     * @param {string|undefined} [tokenUid] Token uid to filter transactions. If undefined, returns all transactions.
     * @returns {AsyncGenerator<IHistoryTx>}
     */
    historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx>;
    /**
     * Fetch a transaction from the database.
     * @param txId The transaction id
     * @returns {Promise<IHistoryTx | null>}
     */
    getTx(txId: string): Promise<IHistoryTx | null>;
    /**
     * Save a transaction on the database.
     * @param {IHistoryTx} tx The transaction to save
     */
    saveTx(tx: IHistoryTx): Promise<void>;
    /**
     * Clear all database entries.
     * @returns {Promise<void>}
     */
    clear(): Promise<void>;
}
//# sourceMappingURL=history_index.d.ts.map