/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractLevel, AbstractSublevel } from 'abstract-level';
import { IKVHistoryIndex, IHistoryTx, HistoryIndexValidateResponse, IKVTokenIndex, ITokenData, ITokenMetadata } from '../../types';
import { KEY_NOT_FOUND_MESSAGE } from './errors';

export const TOKEN_PREFIX = 'token';
export const META_PREFIX = 'meta';
export const REGISTER_PREFIX = 'registered';

function _ts_key(tx: Pick<IHistoryTx, 'timestamp'|'tx_id'>): string {
  const buf = Buffer.alloc(4);
  buf.writeUint32BE(tx.timestamp);
  return `${buf.toString('hex')}:${tx.tx_id}`;
}

export default class LevelTokenIndex implements IKVTokenIndex {
  dbpath: string;
  tokenDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenData>;
  metadataDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenMetadata>;
  registeredDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenData>;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'tokens');
    const db = new Level(this.dbpath);
    this.tokenDB = db.sublevel<string, ITokenData>(TOKEN_PREFIX, { valueEncoding: 'json' });
    this.metadataDB = db.sublevel<string, ITokenMetadata>(TOKEN_PREFIX, { valueEncoding: 'json' });
    this.registeredDB = db.sublevel<string, ITokenData>(TOKEN_PREFIX, { valueEncoding: 'json' });
  }

  async checkVersion(): Promise<void> {
    const db = this.tokenDB.db;
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

  async validate(): Promise<void> {
    await this.checkVersion();
    await this.metadataDB.clear();

    for await (const [key, value] of this.tokenDB.iterator()) {
      if (key !== value.uid) {
        throw new Error('Inconsistent database');
      }
    }
  }

  async * tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.tokenDB.values()) {
      const meta = await this.getTokenMetadata(token.uid);
      yield {...token, ...meta};
    }
  }

  async *registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.registeredDB.values()) {
      const meta = await this.getTokenMetadata(token.uid);
      yield {...token, ...meta};
    }
  }

  async hasToken(tokenUid: string): Promise<boolean> {
    const token = await this.getToken(tokenUid);
    return token !== null;
  }

  async getToken(uid: string): Promise<(ITokenData & Partial<ITokenMetadata>)|null> {
    let token: ITokenData;
    try {
      token = await this.tokenDB.get(uid);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          return null;
        }
      }
      throw err;
    }

    let meta = await this.getTokenMetadata(uid);
    const DEFAULT_TOKEN_META: ITokenMetadata = {
      numTransactions: 0,
      balance: {
        tokens: { unlocked: 0, locked: 0 },
        authorities: {
          mint: { unlocked: 0, locked: 0 },
          melt: { unlocked: 0, locked: 0 },
        },
      }
    };

    return {...token, ...DEFAULT_TOKEN_META, ...meta};
  }

  async getTokenMetadata(uid: string): Promise<ITokenMetadata | null> {
    try {
      return await this.metadataDB.get(uid);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          return null;
        }
      }
      throw err;
    }
  }

  async saveToken(token: ITokenData): Promise<void> {
    await this.tokenDB.put(token.uid, token);
  }

  async saveMetadata(uid: string, meta: ITokenMetadata): Promise<void> {
    await this.metadataDB.put(uid, meta);
  }

  async registerToken(token: ITokenData): Promise<void> {
    await this.registeredDB.put(token.uid, token);
  }

  async unregisterToken(tokenUid: string): Promise<void> {
    await this.registeredDB.del(tokenUid);
  }

  async deleteTokens(tokens: string[]): Promise<void> {
    for (const uid of tokens) {
      await this.tokenDB.del(uid);
      await this.metadataDB.del(uid);
    }
  }

  async editToken(tokenUid: string, meta: Partial<ITokenMetadata>): Promise<void> {
    const metadata: ITokenMetadata = {
      numTransactions: 0,
      balance: {
        tokens: {unlocked: 0, locked: 0},
        authorities: {
          mint: {unlocked: 0, locked: 0},
          melt: {unlocked: 0, locked: 0},
        },
      }
    };
    if (meta.numTransactions) {
      metadata.numTransactions = meta.numTransactions;
    }

    if (meta.balance) {
      metadata.balance = meta.balance;
    }

    await this.metadataDB.put(tokenUid, metadata);
  }

  async clearMeta(): Promise<void> {
    await this.metadataDB.clear();
  }
}