/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVHistoryIndex, IHistoryTx, HistoryIndexValidateResponse } from '../../types';
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';
import { checkLevelDbVersion } from './utils';
import { jsonBigIntEncoding } from '../../utils/bigint';
import { IHistoryTxSchema } from '../../schemas';

export const HISTORY_PREFIX = 'history';
export const TS_HISTORY_PREFIX = 'ts_history';

function _ts_key(tx: Pick<IHistoryTx, 'timestamp' | 'tx_id'>): string {
  // .toString(16) will convert the number to a hex string
  // .padStart(8, '0') will pad the number to 4 bytes
  const hexTimestamp = tx.timestamp.toString(16).padStart(8, '0');
  return `${hexTimestamp}:${tx.tx_id}`;
}

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

  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'history');
    const db = new Level(this.dbpath);
    const valueEncoding = jsonBigIntEncoding(IHistoryTxSchema);
    this.historyDB = db.sublevel<string, IHistoryTx>(HISTORY_PREFIX, { valueEncoding });
    this.tsHistoryDB = db.sublevel<string, IHistoryTx>(TS_HISTORY_PREFIX, { valueEncoding });
    this.isValidated = false;
    this.size = 0;
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    await this.historyDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion(): Promise<void> {
    const { db } = this.historyDB;
    const instanceName = this.constructor.name;
    await checkLevelDbVersion(instanceName, db, this.indexVersion);
  }

  /**
   * Validate the index.
   * This method iterates on all transactions and checks that we have a corresponding entry on the timestamp index.
   * If we find a missing entry, we create it.
   * @returns {Promise<HistoryIndexValidateResponse>}
   */
  async validate(): Promise<HistoryIndexValidateResponse> {
    await this.checkVersion();

    const ret: HistoryIndexValidateResponse = {
      count: 0,
    };
    // Iterate on all txs and check that we have a corresponding entry on the timestamp index
    for await (const [key, value] of this.historyDB.iterator()) {
      ret.count += 1;
      if (key !== value.tx_id) {
        throw new Error('Inconsistent database');
      }

      try {
        await this.tsHistoryDB.get(`${value.timestamp}:${value.tx_id}`);
      } catch (err: unknown) {
        if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
          // Create if index is missing
          await this.tsHistoryDB.put(_ts_key(value), value);
          continue;
        }
        throw err;
      }
    }

    // We have validated the index, we can now trust the tx count
    this.size = ret.count;

    // Set the index as validated
    this.isValidated = true;
    return ret;
  }

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
  async historyCount(): Promise<number> {
    if (!this.isValidated) {
      // Since we have not yet validated the index, we cannot trust the tx count
      return this.runHistoryCount();
    }
    return this.size;
  }

  /**
   * Run a full count of the txs in the database.
   *
   * @returns {Promise<number>} The number of txs in the database
   */
  async runHistoryCount(): Promise<number> {
    let size = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- No use for the variable: just a counter
    for await (const _ of this.historyDB.iterator()) {
      size++;
    }
    return size;
  }

  /**
   * Iterate on the tx history.
   * @param {string|undefined} [tokenUid] Token uid to filter transactions. If undefined, returns all transactions.
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  async *historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx> {
    for await (const info of this.tsHistoryDB.values({ reverse: true })) {
      if (tokenUid === undefined) {
        yield info;
        continue;
      }

      let found: boolean = false;
      for (const io of [...info.inputs, ...info.outputs]) {
        if (io.token === tokenUid) {
          found = true;
          break;
        }
      }
      if (found) {
        yield info;
      }
    }
  }

  /**
   * Fetch a transaction from the database.
   * @param txId The transaction id
   * @returns {Promise<IHistoryTx | null>}
   */
  async getTx(txId: string): Promise<IHistoryTx | null> {
    try {
      return await this.historyDB.get(txId);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save a transaction on the database.
   * @param {IHistoryTx} tx The transaction to save
   */
  async saveTx(tx: IHistoryTx): Promise<void> {
    await this.historyDB.put(tx.tx_id, tx);
    await this.tsHistoryDB.put(_ts_key(tx), tx);
    this.size++;
  }

  /**
   * Clear all database entries.
   * @returns {Promise<void>}
   */
  async clear(): Promise<void> {
    await this.historyDB.db.clear();
  }
}
