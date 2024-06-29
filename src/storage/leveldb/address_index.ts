/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import {
  IAddressInfo,
  IAddressMetadata,
  IKVAddressIndex,
  AddressIndexValidateResponse,
  IAddressMetadataAsRecord,
  IBalance,
} from '../../types';
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';
import { checkLevelDbVersion } from './utils';

export const ADDRESS_PREFIX = 'address';
export const INDEX_PREFIX = 'index';
export const ADDRESS_META_PREFIX = 'meta';

/**
 * The database key for addressIndexDB is a string.
 * This method converts the index number to its string representation.
 *
 * @param index The address index
 * @returns {string} hex value of the uint32 representation of the index
 */
function _index_key(index: number): string {
  // .toString(16) will convert the number to a hex string
  // .padStart(8, '0') will pad the number to 4 bytes
  return index.toString(16).padStart(8, '0');
}

export default class LevelAddressIndex implements IKVAddressIndex {
  dbpath: string;
  // Level implements AbstractLevel (with extra options like location, etc)
  // SubLevel implements AbstractSublevel which extends AbstractLevel
  // AbstractSubLevel requires the type of database(Level) the type of information saved at the database (string|Buffer|Uint8Array) and the types of keys and values it expects.

  /**
   * Main address database
   * Key: address in base58
   * Value: json encoded IAddressInfo
   */
  addressesDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IAddressInfo>;

  /**
   * Index database
   * Key: index in uint32
   * Value: address in base58
   */
  addressesIndexDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, string>;

  /**
   * Address metadata database
   * Key: address in base58
   * Value: json encoded IAddressMetadata
   */
  addressesMetaDB: AbstractSublevel<
    Level,
    string | Buffer | Uint8Array,
    string,
    IAddressMetadataAsRecord
  >;

  /**
   * Whether the index is validated or not
   * This is used to avoid using the address count before we know it is valid.
   */
  isValidated: boolean;

  indexVersion: string = '0.0.1';

  size: number;

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'addresses');
    // Open addresses
    const db = new Level(this.dbpath);
    this.addressesDB = db.sublevel<string, IAddressInfo>(ADDRESS_PREFIX, { valueEncoding: 'json' });
    this.addressesIndexDB = db.sublevel(INDEX_PREFIX);
    this.addressesMetaDB = db.sublevel<string, IAddressMetadataAsRecord>(ADDRESS_META_PREFIX, {
      valueEncoding: 'json',
    });
    this.isValidated = false;
    this.size = 0;
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    await this.addressesDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion(): Promise<void> {
    const { db } = this.addressesDB;
    const instanceName = this.constructor.name;
    await checkLevelDbVersion(instanceName, db, this.indexVersion);
  }

  /**
   * Validate the index consistency along with the sublevel children.
   * We check that all addresses in the addressesDB have an index in the addressesIndexDB.
   * @returns {Promise<AddressIndexValidateResponse>} The first and last index in the database
   */
  async validate(): Promise<AddressIndexValidateResponse> {
    // Clear metadata since we cannot guarantee the validity
    await this.addressesMetaDB.clear();

    const ret: AddressIndexValidateResponse = { firstIndex: Infinity, lastIndex: -1 };
    let size = 0;
    // Iterate on all addresses and check that we have a corresponding index entry
    for await (const [key, value] of this.addressesDB.iterator()) {
      // increment size counter
      size++;
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
        const addressFromIndex = await this.addressesIndexDB.get(
          _index_key(value.bip32AddressIndex)
        );
        if (value.base58 !== addressFromIndex) {
          throw new Error('Inconsistent database');
        }
      } catch (err: unknown) {
        if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
          // Create if index is missing
          await this.addressesIndexDB.put(_index_key(value.bip32AddressIndex), value.base58);
          continue;
        }
        throw err;
      }
    }

    // We just did a full address count, we can save the size and trust it
    this.size = size;

    // Validation is complete
    this.isValidated = true;
    return ret;
  }

  /**
   * Get the number of addresses saved in the database.
   *
   * leveldb does not have a count method and the feature request for this was rejected (see https://github.com/google/leveldb/issues/119).
   * As stated in the issue above "There is no way to implement count more efficiently inside leveldb than outside."
   * This means that the best way to count the number of entries would be to iterate on all keys and count them.
   * Another sugestion would be to have an external count of addresses, this is done with the this.size variable.
   *
   * The problem with this.size is that it is not updated when we start a database.
   * This is why we update the size when we validate the index and then we can use the pre-calculated size.
   * If the index has not been validated we will run a full count.
   * While a full count runs in O(n) it has been confirmed to be very fast with leveldb.
   * And since the wallet runs the validation when it starts we do not expect to use the full count with a running wallet.
   *
   * @returns {Promise<number>} The number of addresses in the database
   */
  async addressCount(): Promise<number> {
    if (!this.isValidated) {
      // Since we have not yet validated the index, we cannot trust the address count
      return this.runAddressCount();
    }
    return this.size;
  }

  /**
   * Run a full count of the addresses in the database.
   *
   * @returns {Promise<number>} The number of addresses in the database
   */
  async runAddressCount(): Promise<number> {
    let size = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- No use for the variable: just a counter
    for await (const _ of this.addressesDB.iterator()) {
      size++;
    }
    return size;
  }

  /**
   * Fetch the address info from the database.
   * @param {string} base58 The address in base58
   * @returns {Promise<IAddressInfo|null>}
   */
  async getAddressInfo(base58: string): Promise<IAddressInfo | null> {
    try {
      return await this.addressesDB.get(base58);
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if the address exists in the database.
   * @param {string} base58 The address in base58
   * @returns {Promise<boolean>} True if the address exists in the database.
   */
  async addressExists(base58: string): Promise<boolean> {
    return (await this.getAddressInfo(base58)) !== null;
  }

  /**
   * Iterate on all addresses, ordered by the bip32 address index.
   *
   * The iteration is done on the db sorted by bip32 address index (addressesIndexDB)
   * This ensures an ordered iteration.
   *
   * @returns {AsyncGenerator<IAddressInfo>}
   */
  async *addressIter(): AsyncGenerator<IAddressInfo> {
    for await (const address of this.addressesIndexDB.values()) {
      const info = await this.getAddressInfo(address);
      if (info === null) {
        throw new Error('Inconsistent database');
      }
      yield info;
    }
  }

  /**
   * Save an address metadata in the database.
   *
   * The meta argument type is IAddressMetadata that uses a Map which is unsupported
   * with leveldb native json encoding so we convert it to an object using Record instead.
   *
   * @param {string} address Address in base58
   * @param {IAddressMetadata} meta metadata to store
   */
  async setAddressMeta(address: string, meta: IAddressMetadata): Promise<void> {
    const dbMeta: IAddressMetadataAsRecord = { numTransactions: meta.numTransactions, balance: {} };
    for (const [uid, balance] of meta.balance.entries()) {
      dbMeta.balance[uid] = balance;
    }
    await this.addressesMetaDB.put(address, dbMeta);
  }

  /**
   * Fetch address metadata from the database.
   *
   * Due to Leveldb json encoding the type returned is IAddressMetadataAsRecord
   * Which we need to convert to IAddressMetadata before returning.
   *
   * @param base58 Address in base58
   * @returns {Promise<IAddressMetadata|null>}
   */
  async getAddressMeta(base58: string): Promise<IAddressMetadata | null> {
    try {
      const dbmeta = await this.addressesMetaDB.get(base58);
      const meta: IAddressMetadata = {
        numTransactions: dbmeta.numTransactions,
        balance: new Map<string, IBalance>(),
      };
      for (const [uid, balance] of Object.entries(dbmeta.balance)) {
        meta.balance.set(uid, balance);
      }
      return meta;
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get address using its bip32 index.
   * @param index Address bip32 index
   * @returns {Promise<string|null>}
   */
  async getAddressAtIndex(index: number): Promise<string | null> {
    if (index < 0) {
      return null;
    }
    try {
      return await this.addressesIndexDB.get(_index_key(index));
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save address on database.
   * @param info Address info to save
   */
  async saveAddress(info: IAddressInfo): Promise<void> {
    await this.addressesDB.put(info.base58, info);
    await this.addressesIndexDB.put(_index_key(info.bip32AddressIndex), info.base58);
    this.size++;
  }

  /**
   * Clear the address metadata database.
   */
  async clearMeta(): Promise<void> {
    await this.addressesMetaDB.clear();
  }

  /**
   * Clear the entire address database.
   */
  async clear(): Promise<void> {
    this.addressesDB.db.clear();
  }
}
