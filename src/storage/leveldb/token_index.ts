/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVTokenIndex, ITokenData, ITokenMetadata } from '../../types';
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';
import { HATHOR_TOKEN_CONFIG } from '../../constants';

export const TOKEN_PREFIX = 'token';
export const META_PREFIX = 'meta';
export const REGISTER_PREFIX = 'registered';

export default class LevelTokenIndex implements IKVTokenIndex {
  dbpath: string;
  /**
   * Main token database
   * Key: uid
   * Value: ITokenData (json encoded)
   */
  tokenDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenData>;
  /**
   * Token metadata database
   * Key: uid
   * Value: ITokenMetadata (json encoded)
   */
  metadataDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenMetadata>;
  /**
   * Registered tokens database
   * Key: uid
   * Value: ITokenData (json encoded)
   */
  registeredDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenData>;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'tokens');
    const db = new Level(this.dbpath);
    this.tokenDB = db.sublevel<string, ITokenData>(TOKEN_PREFIX, { valueEncoding: 'json' });
    this.metadataDB = db.sublevel<string, ITokenMetadata>(META_PREFIX, { valueEncoding: 'json' });
    this.registeredDB = db.sublevel<string, ITokenData>(REGISTER_PREFIX, { valueEncoding: 'json' });

    // Add HTR to the database
    this.saveToken(HATHOR_TOKEN_CONFIG);
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    await this.tokenDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion(): Promise<void> {
    const db = this.tokenDB.db;
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

  async validate(): Promise<void> {
    await this.checkVersion();
    await this.metadataDB.clear();

    for await (const [key, value] of this.tokenDB.iterator()) {
      if (key !== value.uid) {
        throw new Error('Inconsistent database');
      }
    }
  }

  /**
   * Iterate over all tokens in the database
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  async * tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.tokenDB.values()) {
      const meta = await this.getTokenMetadata(token.uid);
      yield {...token, ...meta};
    }
  }

  /**
   * Iterate over all registered tokens in the database
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  async *registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.registeredDB.values()) {
      const meta = await this.getTokenMetadata(token.uid);
      yield {...token, ...meta};
    }
  }

  /**
   * Check if a token is on the database
   * @param {string} tokenUid
   * @returns {Promise<boolean>}
   */
  async hasToken(tokenUid: string): Promise<boolean> {
    const token = await this.getToken(tokenUid);
    return token !== null;
  }

  /**
   * Get a token from the database.
   * @param {string} uid
   * @returns {Promise<(ITokenData & Partial<ITokenMetadata>)|null>}
   */
  async getToken(uid: string): Promise<(ITokenData & Partial<ITokenMetadata>)|null> {
    let token: ITokenData;
    try {
      token = await this.tokenDB.get(uid);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
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

  /**
   * Get a token metadata from the database.
   * @param {string} uid
   * @returns {Promise<ITokenMetadata|null>}
   */
  async getTokenMetadata(uid: string): Promise<ITokenMetadata | null> {
    try {
      return await this.metadataDB.get(uid);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save a token to the database.
   * @param {ITokenData} token Token to be saved
   * @returns {Promise<void>}
   */
  async saveToken(token: ITokenData): Promise<void> {
    await this.tokenDB.put(token.uid, token);
  }

  /**
   * Save a token metadata to the database.
   * @param {string} uid token uid
   * @param {ITokenMetadata} meta Token metadata to be saved
   * @returns {Promise<void>}
   */
  async saveMetadata(uid: string, meta: ITokenMetadata): Promise<void> {
    await this.metadataDB.put(uid, meta);
  }

  /**
   * Add a token to the registered list.
   * @param {ITokenData} token Token to register
   * @returns {Promise<void>}
   */
  async registerToken(token: ITokenData): Promise<void> {
    await this.registeredDB.put(token.uid, token);
  }

  /**
   * Remove a token from the registered list.
   * @param {string} tokenUid Token uid to unregister
   * @returns {Promise<void>}
   */
  async unregisterToken(tokenUid: string): Promise<void> {
    await this.registeredDB.del(tokenUid);
  }

  /**
   * Delete a token from the database.
   * @param {string[]} tokens List of token uids to be deleted
   */
  async deleteTokens(tokens: string[]): Promise<void> {
    for (const uid of tokens) {
      await this.tokenDB.del(uid);
      await this.metadataDB.del(uid);
    }
  }

  /**
   * Edit token metadata
   * @param {string} tokenUid token uid
   * @param {Partial<ITokenMetadata>} meta metadata to add
   * @returns {Promise<void>}
   */
  async editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void> {
    await this.metadataDB.put(tokenUid, meta);
  }

  /**
   * Clear metadata index.
   * @returns {Promise<void>}
   */
  async clearMeta(): Promise<void> {
    await this.metadataDB.clear();
  }

  /**
   * Clear all entries from the database.
   * @returns {Promise<void>}
   */
  async clear(): Promise<void> {
    await this.tokenDB.db.clear();
  }
}