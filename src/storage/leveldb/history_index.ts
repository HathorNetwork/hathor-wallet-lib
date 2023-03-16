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
  /**
   * Whether the index is validated or not
   * This is used to avoid using the tx count before we know it is valid.
   */
  isValidated: boolean;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'history');
    const db = new Level(this.dbpath);
    this.historyDB = db.sublevel<string, IHistoryTx>(HISTORY_PREFIX, { valueEncoding: 'json' });
    this.tsHistoryDB = db.sublevel<string, IHistoryTx>(TS_HISTORY_PREFIX, { valueEncoding: 'json' });
    this.isValidated = false;
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

    // We have validated the index, we can now trust the tx count
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(ret.count);
    await this.historyDB.db.put('size', buf.toString('hex'));

    // Set the index as validated
    this.isValidated = true;
    return ret;
  }

  /**
   * Get the pre-calculated number of txs in the database.
   * The database value is only used if the index is validated.
   * If the index is not validated, we run a full count.
   *
   * @returns {Promise<number>} The number of txs in the database
   */
  async historyCount(): Promise<number> {
    if (!this.isValidated) {
      // Since we have not yet validated the index, we cannot trust the tx count
      return await this.runHistoryCount();
    }
    // The index is validated, we can trust the tx count
    const db = this.historyDB.db;
    try {
      // tx count is an index, but it is stored as a uint32 hex string.
      const sizeStr = await db.get('size');
      // To fetch from the db we need to read the uint32 from the hex string.
      const buf = Buffer.from(sizeStr, 'hex');
      return buf.readUInt32BE(0);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return 0;
      }
      throw err;
    }
  }

  /**
   * Increment the tx count in the database.
   * @returns {Promise<void>}
   */
  async incrHistoryCount(): Promise<void> {
    const db = this.historyDB.db;
    const size = await this.historyCount();
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(size + 1);
    await db.put('size', buf.toString('hex'));
  }

  /**
   * Run a full count of the txs in the database.
   * Since we have made a full count we can update the tx count in the database.
   *
   * @returns {Promise<number>} The number of txs in the database
   */
  async runHistoryCount(): Promise<number> {
    const db = this.historyDB.db;
    let size = 0;
    for await (let _ of this.historyDB.iterator()) {
      size++;
    }
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(size);
    await db.put('size', buf.toString('hex'));
    return size;
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
    await this.incrHistoryCount();
  }

  /**
   * Clear all database entries.
   * @returns {Promise<void>}
   */
  async clear(): Promise<void> {
    await this.historyDB.db.clear();
  }
}