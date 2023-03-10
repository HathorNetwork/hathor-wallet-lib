/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVWalletIndex, IWalletData, IWalletAccessData } from '../../types';
import { GAP_LIMIT } from '../../constants';
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';

export const ACCESS_PREFIX = 'access';
export const WALLET_PREFIX = 'wallet';
export const GENERIC_PREFIX = 'generic';

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
  genericDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, any>;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'wallet');
    const db = new Level(this.dbpath);
    this.accessDB = db.sublevel<string, IWalletAccessData>(ACCESS_PREFIX, { valueEncoding: 'json' });
    this.walletDB = db.sublevel(WALLET_PREFIX);
    this.genericDB = db.sublevel<string, any>(GENERIC_PREFIX, { valueEncoding: 'json' });
  }

  async close(): Promise<void> {
    await this.accessDB.db.close();
  }

  /**
   * Convert a number to a uint32 buffer before saving on database.
   * Internal helper method, since this logic is used in multiple places.
   *
   * @param {'access'|'wallet'|'generic'} dest Which database to use.
   * @param key The key to use when setting the value.
   * @param {number} value The value to set.
   */
  async _setNumber(dest: 'access'|'wallet'|'generic', key: string, value: number) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    switch(dest) {
      case 'access':
        await this.accessDB.put<string, Buffer>(key, buf, { valueEncoding: 'buffer'});
        break;
      case 'wallet':
        await this.walletDB.put<string, Buffer>(key, buf, { valueEncoding: 'buffer'});
        break;
      case 'generic':
        await this.genericDB.put<string, Buffer>(key, buf, { valueEncoding: 'buffer'});
        break;
    }
  }

  /**
   * Get the number from the uint32 buffer saved on database.
   * Internal helper method, since this logic is used in multiple places.
   *
   * @param {'access'|'wallet'|'generic'} dest Which database to fetch from.
   * @param {string} key The key to fetch.
   * @returns {Promise<number|null>}
   */
  async _getNumber(dest: 'access'|'wallet'|'generic', key: string): Promise<number|null> {
    try {
      let buf: Buffer;
      switch(dest) {
        case 'access':
          buf = await this.accessDB.get<string, Buffer>(key, { valueEncoding: 'buffer'});
          break;
        case 'wallet':
          buf = await this.walletDB.get<string, Buffer>(key, { valueEncoding: 'buffer'});
          break;
        case 'generic':
          buf = await this.genericDB.get<string, Buffer>(key, { valueEncoding: 'buffer'});
          break;
      }

      return buf.readUint32BE(0);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }

      throw err;
    }
  }

  /**
   * Check if the index version is valid.
   * @returns {Promise<null>}
   */
  async checkVersion(): Promise<void> {
    const db = this.accessDB.db;
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
   * Validate the database.
   * @returns {Promise<void>}
   */
  async validate(): Promise<void> {
    await this.checkVersion();
  }

  /**
   * Get the configured gap limit.
   * @returns {Promise<number>} defaults to constants.GAP_LIMIT
   */
  async getGapLimit(): Promise<number> {
    const value = await this._getNumber('wallet', 'gapLimit');
    return value || GAP_LIMIT;
  }

  /**
   * Configure a wallet specific gap limit.
   * @param {number} value gap limit.
   */
  async setGapLimit(value: number): Promise<void> {
    await this._setNumber('wallet', 'gapLimit', value);
  }

  /**
   * Get the value of the current address index.
   * The current address is the most recent unused address.
   * @returns {Promise<number>} defaults to -1
   */
  async getCurrentAddressIndex(): Promise<number> {
    const value = await this._getNumber('wallet', 'currentAddressIndex');
    if (value === null) return -1;
    return value;
  }

  /**
   * Set the value of the current address index.
   * @param {number} value Current address index.
   * @returns {Promise<void>}
   */
  async setCurrentAddressIndex(value: number): Promise<void> {
    await this._setNumber('wallet', 'currentAddressIndex', value);
  }

  /**
   * Get the value of the current network height.
   * The network height is the number of blocks on the blockchain.
   * @returns {Promise<number>} defaults to 0
   */
  async getCurrentHeight(): Promise<number> {
    const value = await this._getNumber('wallet', 'networkHeight');
    if (value === null) return 0;
    return value;
  }

  /**
   * Set the value of the current network height.
   * @param {number} value network height.
   * @returns {Promise<void>}
   */
  async setCurrentHeight(value: number): Promise<void> {
    await this._setNumber('wallet', 'networkHeight', value);
  }

  /**
   * Get the value of the last used address index.
   * The last used address is the highest address index that has been used.
   * @returns {Promise<number>} defaults to -1
   */
  async getLastUsedAddressIndex(): Promise<number> {
    const value = await this._getNumber('wallet', 'lastUsedAddressIndex');
    if (value === null) return -1;
    return value;
  }

  /**
   * Set the value of the last used address index.
   * @param {number} value last used address index.
   * @returns {Promise<void>}
   */
  async setLastUsedAddressIndex(value: number): Promise<void> {
    await this._setNumber('wallet', 'lastUsedAddressIndex', value);
  }

  /**
   * Get the value of the last loaded address index.
   * The last loaded address is the highest address index.
   * @returns {Promise<number>} defaults to 0
   */
  async getLastLoadedAddressIndex(): Promise<number> {
    const value = await this._getNumber('wallet', 'lastLoadedAddressIndex');
    if (value === null) return 0;
    return value;
  }

  /**
   * Set the value of the last loaded address index.
   * @param {number} value last loaded address index.
   * @returns {Promise<void>}
   */
  async setLastLoadedAddressIndex(value: number): Promise<void> {
    await this._setNumber('wallet', 'lastLoadedAddressIndex', value);
  }

  /**
   * Get the wallet data.
   * @returns {Promise<IWalletData>}
   */
  async getWalletData(): Promise<IWalletData> {
    const lastLoadedAddressIndex = await this.getLastLoadedAddressIndex();
    const lastUsedAddressIndex = await this.getLastUsedAddressIndex();
    const currentAddressIndex = await this.getCurrentAddressIndex();
    const bestBlockHeight = await this.getCurrentHeight();
    const gapLimit = await this.getGapLimit();
    return {
      lastLoadedAddressIndex,
      lastUsedAddressIndex,
      currentAddressIndex,
      bestBlockHeight,
      gapLimit,
    };
  }

  /**
   * Save wallet access data.
   * @param {IWalletAccessData} data Wallet access data.
   * @returns {Promise<void>}
   */
  async saveAccessData(data: IWalletAccessData): Promise<void> {
    await this.accessDB.put('data', data);
  }

  /**
   * Get wallet access data.
   * @returns {Promise<IWalletAccessData | null>}
   */
  async getAccessData(): Promise<IWalletAccessData | null> {
    try {
      return await this.accessDB.get('data');
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetch a key from the database.
   * @param key database key.
   * @returns {Promise<any>}
   */
  async getItem(key: string): Promise<any> {
    try {
      return await this.genericDB.get(key);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save a key/value pair to the database.
   * @param {string} key database key
   * @param {any} value database value
   */
  async setItem(key: string, value: any): Promise<void> {
    await this.genericDB.put(key, value);
  }

  /**
   * Clean the wallet access data.
   */
  async cleanAccessData(): Promise<void> {
    await this.accessDB.clear();
  }

  async cleanWalletData(clear: boolean = false): Promise<void> {
    if (clear) {
      await this.walletDB.clear();
    } else {
      const batch = this.walletDB.batch();
      batch.del('lastLoadedAddressIndex');
      batch.del('lastUsedAddressIndex');
      batch.del('currentAddressIndex');
      await batch.write();
    }
  }
}