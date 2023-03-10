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

export const HISTORY_PREFIX = 'history';
export const TS_HISTORY_PREFIX = 'ts_history';


function _ts_key(tx: Pick<IHistoryTx, 'timestamp'|'tx_id'>): string {
  const buf = Buffer.alloc(4);
  buf.writeUint32BE(tx.timestamp);
  return `${buf.toString('hex')}:${tx.tx_id}`;
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
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'history');
    const db = new Level(this.dbpath);
    this.historyDB = db.sublevel<string, IHistoryTx>(HISTORY_PREFIX, { valueEncoding: 'json' });
    this.tsHistoryDB = db.sublevel<string, IHistoryTx>(TS_HISTORY_PREFIX, { valueEncoding: 'json' });
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
    const db = this.historyDB.db;
    try {
      const dbVersion = await db.get('version');
      if (this.indexVersion !== dbVersion) {
        throw new Error(`Database version mismatch for ${this.constructor.name}: database version (${dbVersion}) expected version (${this.indexVersion})`);
      }
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        // This is a new db, add version and return
        await db.put('version', this.indexVersion);
        return;
      }
      throw err;
    }
  }

  /**
   * Validate the index.
   * This method iterates on all transactions and checks that we have a corresponding entry on the timestamp index.
   * If we find a missing entry, we create it.
   * @returns {Promise<HistoryIndexValidateResponse>}
   */
  async validate(): Promise<HistoryIndexValidateResponse> {
    await this.checkVersion();

    let ret: HistoryIndexValidateResponse = {
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
    return ret;
  }

  /**
   * Iterate on the tx history.
   * @param {string|undefined} [tokenUid] Token uid to filter transactions. If undefined, returns all transactions.
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  async * historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx> {
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
  }

  /**
   * Count the number of transactions on the database.
   * @returns {Promise<number>} The number of transactions on the database
   */
  async historyCount(): Promise<number> {
    // Level is bad at counting db size
    // An alternative would be to have a counter and increase it on every new transaction
    let count = 0;
    for await (let _ of this.historyDB.keys()) {
      count += 1;
    }
    return count;
  }

  /**
   * Clear all database entries.
   * @returns {Promise<void>}
   */
  async clear(): Promise<void> {
    await this.historyDB.db.clear();
  }
}