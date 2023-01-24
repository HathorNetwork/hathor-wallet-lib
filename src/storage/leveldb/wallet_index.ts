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
  accessDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IWalletAccessData>;
  walletDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, string>;
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
        await this.walletDB.put<string, Buffer>(key, buf, { valueEncoding: 'buffer'});
        break;
    }
  }

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
          buf = await this.walletDB.get<string, Buffer>(key, { valueEncoding: 'buffer'});
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

  async validate(): Promise<void> {
    await this.checkVersion();
  }

  async getGapLimit(): Promise<number> {
    const value = await this._getNumber('wallet', 'gapLimit');
    return value || GAP_LIMIT;
  }

  async setGapLimit(value: number): Promise<void> {
    await this._setNumber('wallet', 'gapLimit', value);
  }

  async getCurrentAddressIndex(): Promise<number> {
    const value = await this._getNumber('wallet', 'currentAddressIndex');
    if (value === null) return -1;
    return value;
  }

  async setCurrentAddressIndex(value: number): Promise<void> {
    await this._setNumber('wallet', 'currentAddressIndex', value);
  }

  async getCurrentHeight(): Promise<number> {
    const value = await this._getNumber('wallet', 'networkHeight');
    if (value === null) return 0;
    return value;
  }

  async setCurrentHeight(value: number): Promise<void> {
    await this._setNumber('wallet', 'networkHeight', value);
  }

  async getLastUsedAddressIndex(): Promise<number> {
    const value = await this._getNumber('wallet', 'lastUsedAddressIndex');
    if (value === null) return -1;
    return value;
  }

  async setLastUsedAddressIndex(value: number): Promise<void> {
    await this._setNumber('wallet', 'lastUsedAddressIndex', value);
  }

  async getLastLoadedAddressIndex(): Promise<number> {
    const value = await this._getNumber('wallet', 'lastLoadedAddressIndex');
    if (value === null) return 0;
    return value;
  }

  async setLastLoadedAddressIndex(value: number): Promise<void> {
    await this._setNumber('wallet', 'lastLoadedAddressIndex', value);
  }

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

  async saveAccessData(data: IWalletAccessData): Promise<void> {
    // XXX: Any checks?
    await this.accessDB.put('data', data);
  }

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

  async setItem(key: string, value: any): Promise<void> {
    await this.genericDB.put(key, value);
  }

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