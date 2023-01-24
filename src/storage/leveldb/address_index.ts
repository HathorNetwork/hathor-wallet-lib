/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractLevel, AbstractSublevel } from 'abstract-level';
import { IAddressInfo, IAddressMetadata, IKVAddressIndex, AddressIndexValidateResponse, IAddressMetadataAsRecord, IBalance } from '../../types';
import { KEY_NOT_FOUND_CODE, KEY_NOT_FOUND_MESSAGE } from './errors';

export const ADDRESS_PREFIX = 'address';
export const INDEX_PREFIX = 'index';
export const ADDRESS_META_PREFIX = 'meta';

function _index_key(index: number): string {
  const buf = Buffer.alloc(4);
  buf.writeUint32BE(index);
  return buf.toString('hex');
}

export default class LevelAddressIndex implements IKVAddressIndex {
  dbpath: string;
  // Level implements AbstractLevel (with extra options like location, etc)
  // SubLevel implements AbstractSublevel which extends AbstractLevel
  // AbstractSubLevel requires the type of database(Level) the type of information saved at the database (string|Buffer|Uint8Array) and the types of keys and values it expects.
  addressesDB: AbstractSublevel<Level, string|Buffer|Uint8Array, string, IAddressInfo>;
  addressesIndexDB: AbstractSublevel<Level, string|Buffer|Uint8Array, string, string>;
  addressesMetaDB: AbstractSublevel<Level, string|Buffer|Uint8Array, string, IAddressMetadataAsRecord>;
  indexVersion: string = '0.0.2';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'addresses');
    // Open addresses
    const db = new Level(this.dbpath);
    this.addressesDB = db.sublevel<string, IAddressInfo>(ADDRESS_PREFIX, {valueEncoding: 'json'});
    this.addressesIndexDB = db.sublevel(INDEX_PREFIX);
    this.addressesMetaDB = db.sublevel<string, IAddressMetadataAsRecord>(ADDRESS_META_PREFIX, {valueEncoding: 'json'});
  }

  async checkVersion(): Promise<void> {
    const db = this.addressesDB.db;
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

  async validate(): Promise<AddressIndexValidateResponse> {
    // Clear metadata since we cannot guarantee the validity
    await this.addressesMetaDB.clear();

    const ret: AddressIndexValidateResponse = {firstIndex: Infinity, lastIndex: -1};
    // Iterate on all addresses and check that we have a corresponding index entry
    for await (const [key, value] of this.addressesDB.iterator()) {
      if (key !== value.base58) {
        throw new Error('Inconsistent database');
      }
      if (value.bip32AddressIndex < ret.firstIndex) {
        ret.firstIndex = value.bip32AddressIndex;
      }
      if (value.bip32AddressIndex > ret.lastIndex) {
        ret.lastIndex = value.bip32AddressIndex;
      }

      // check that we have an index
      try {
        const addressFromIndex = await this.addressesIndexDB.get(_index_key(value.bip32AddressIndex));
        if (value.base58 !== addressFromIndex) {
          throw new Error('Inconsistent database');
        }
      } catch(err: unknown) {
        if (err instanceof Error) {
          if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
            // Create if index is missing
            await this.addressesIndexDB.put(_index_key(value.bip32AddressIndex), value.base58);
            continue;
          }
        }
        throw err;
      }
    }
    return ret;
  }

  async getAddressInfo(base58: string): Promise<IAddressInfo | null> {
    try {
      return await this.addressesDB.get(base58);
    } catch(err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          return null;
        }
      }
      throw err;
    }
  }

  async addressExists(base58: string): Promise<boolean> {
    return (await this.getAddressInfo(base58)) !== null;
  }

  async * addressIter(): AsyncGenerator<IAddressInfo> {
    for await (const address of this.addressesIndexDB.values()) {
      const info = await this.getAddressInfo(address);
      if (info === null) {
        throw new Error('Inconsistent database');
      }
      yield info;
    }
  }

  async setAddressMeta(address: string, meta: IAddressMetadata): Promise<void> {
    const dbMeta: IAddressMetadataAsRecord = {numTransactions: meta.numTransactions, balance: {}}; 
    for (const [uid, balance] of meta.balance.entries()) {
      dbMeta.balance[uid] = balance;
    }
    await this.addressesMetaDB.put(address, dbMeta);
  }

  async getAddressMeta(base58: string): Promise<IAddressMetadata | null> {
    try {
      const dbmeta = await this.addressesMetaDB.get(base58);
      const meta: IAddressMetadata = {numTransactions: dbmeta.numTransactions, balance: new Map<string, IBalance>()};
      for (const [uid, balance] of Object.entries(dbmeta.balance)) {
        meta.balance.set(uid, balance);
      }
      return meta;
    } catch(err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          return null;
        }
      }
      throw err;
    }
  }

  async getAddressAtIndex(index: number): Promise<string|null> {
    try {
      return await this.addressesIndexDB.get(_index_key(index));
    } catch(err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes(KEY_NOT_FOUND_MESSAGE)) {
          return null;
        }
      }
      throw err;
    }
  }

  async saveAddress(info: IAddressInfo): Promise<void> {
    await this.addressesDB.put(info.base58, info);
    await this.addressesIndexDB.put(_index_key(info.bip32AddressIndex), info.base58);
  }

  async addressCount(): Promise<number> {
    // Level is bad at counting addresses addresses
    let count = 0;
    for await (let _ of this.addressesDB.keys()) {
      count += 1;
    }
    return count;
  }

  async clearMeta(): Promise<void> {
    await this.addressesMetaDB.clear();
  }
}