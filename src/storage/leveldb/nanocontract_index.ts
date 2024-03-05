import path from 'path';
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVNanoContractIndex, INcData } from "src/types";
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';

export const REGISTERED_PREFIX = 'registered';

export default class LevelNanoContractIndex implements IKVNanoContractIndex {
  dbpath: string;
  /**
   * Registered Nano Contract database
   * Key: nckey
   * Value: INcData (json encoded)
   */
  registeredDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, INcData>;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'nanocontract');
    const db = new Level(this.dbpath);
    this.registeredDB = db.sublevel<string, INcData>(REGISTERED_PREFIX, { valueEncoding: 'json' });
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    await this.registeredDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion(): Promise<void> {
    const db = this.registeredDB.db;
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
   * Delete all entries on the database.
   */
  async clear(): Promise<void> {
      await this.registeredDB.db.clear();
  }

  /**
   * Return if the nano contract is registered for the given address based on ncKey.
   *
   * @param ncKey Pair address:ncId concatenated.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncKey: string): Promise<boolean> {
    try {
      await this.registeredDB.get(ncKey);
      return true;
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        // Did not find the token among the registered tokens
        return false;
      }
      throw err;
    }
  }

  /**
   * Get a nano contract data on database from the ncKey.
   *
   * @param ncKey Pair address:ncId registered.
   * @returns Nano contract data instance.
   * @async
   */
  async getNanoContract(ncKey: string): Promise<INcData | null> {
    try {
      const ncValue = await this.registeredDB.get(ncKey);
      return { ...ncValue };
    } catch (err: unknown) {
      if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Register a nano contract data.
   *
   * @param ncKey Pair address:ncId to register as key.
   * @param ncValue Nano contract basic information.
   * @async
   */
  async registerNanoContract(ncKey: string, ncValue: INcData): Promise<void> {
    await this.registeredDB.put(ncKey, ncValue);
  }
}
