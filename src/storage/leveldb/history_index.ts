/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractLevel, AbstractSublevel } from 'abstract-level';
import { IKVHistoryIndex, IHistoryTx, HistoryIndexValidateResponse } from '../../types';
import { KEY_NOT_FOUND_CODE, KEY_NOT_FOUND_MESSAGE } from './errors';

export const HISTORY_PREFIX = 'history';
export const TS_HISTORY_PREFIX = 'ts_history';


function _ts_key(tx: Pick<IHistoryTx, 'timestamp'|'tx_id'>): string {
  const buf = Buffer.alloc(4);
  buf.writeUint32BE(tx.timestamp);
  return `${buf.toString('hex')}:${tx.tx_id}`;
}

export default class LevelHistoryIndex implements IKVHistoryIndex {
  dbpath: string;
  historyDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IHistoryTx>;
  tsHistoryDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IHistoryTx>;
  size: number;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'history');
    const db = new Level(this.dbpath);
    this.historyDB = db.sublevel<string, IHistoryTx>(HISTORY_PREFIX, { valueEncoding: 'json' });
    this.tsHistoryDB = db.sublevel<string, IHistoryTx>(TS_HISTORY_PREFIX, { valueEncoding: 'json' });
    this.size = 0;
  }

  async checkVersion(): Promise<void> {
    const db = this.historyDB.db;
    try {
      const dbVersion = await db.get('version');
      if (this.indexVersion !== dbVersion) {
        throw new Error(`Database version mismatch for ${this.constructor.name}: database version (${dbVersion}) expected version (${this.indexVersion})`);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          // This is a new db, add version and return
          await db.put('version', this.indexVersion);
          return;
        }
      }
      throw err;
    }
  }

  async validate(): Promise<HistoryIndexValidateResponse> {
    await this.checkVersion();

    let ret: HistoryIndexValidateResponse = {
      count: 0,
      tokens: [],
      addresses: [],
    };
    const addresses = new Set<string>();
    const tokens = new Set<string>();
    // Iterate on all addresses and check that we have a corresponding index entry
    for await (const [key, value] of this.historyDB.iterator()) {
      ret.count += 1;
      if (key !== value.tx_id) {
        throw new Error('Inconsistent database');
      }

      // for (const io of [...value.inputs, ...value.outputs]) {
      //   if (io.decoded.address) {
      //     addresses.add(io.decoded.address);
      //   }
      //   tokens.add(io.token);
      // }

      try {
        await this.tsHistoryDB.get(`${value.timestamp}:${value.tx_id}`);
      } catch(err: unknown) {
        if (err instanceof Error) {
          if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
            // Create if index is missing
            await this.tsHistoryDB.put(_ts_key(value), value);
            continue;
          }
        }
        throw err;
      }
    }
    ret.addresses = Array.from(addresses);
    ret.tokens = Array.from(tokens);
    return ret;
  }

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

  async getTx(txId: string): Promise<IHistoryTx | null> {
    try {
      return await this.historyDB.get(txId);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          return null;
        }
      }
      throw err;
    }
  }

  async saveTx(tx: IHistoryTx): Promise<void> {
    await this.historyDB.put(tx.tx_id, tx);
    await this.tsHistoryDB.put(_ts_key(tx), tx);
  }

  async historyCount(): Promise<number> {
    // Level is bad at counting db size
    // An alternative would be to have a counter and increase it on every new transaction
    let count = 0;
    for await (let _ of this.historyDB.keys()) {
      count += 1;
    }
    return count;
  }
}