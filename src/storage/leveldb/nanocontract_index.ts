import path from 'path';
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVNanoContractIndex, INcData } from "src/types";
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';
import { checkLevelDbVersion } from './utils';

export const REGISTERED_PREFIX = 'registered';

export default class LevelNanoContractIndex implements IKVNanoContractIndex {
  dbpath: string;
  /**
   * Registered Nano Contract database
   * Key: ncId
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
    const instanceName = this.constructor.name;
    await checkLevelDbVersion(instanceName, db, this.indexVersion);
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
   * Return if the nano contract is registered for the given ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId: string): Promise<boolean> {
    const nc = await this.getNanoContract(ncId);
    return nc !== null;
  }

  /**
   * Iterate over all registered nano contracts in the database
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<INcData>}
   */
  async *registeredNanoContractsIter(): AsyncGenerator<INcData> {
    for await (const ncData of this.registeredDB.values()) {
      yield ncData;
    }
  }

  /**
   * Get a nano contract data on database from the ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns Nano contract data instance.
   * @async
   */
  async getNanoContract(ncId: string): Promise<INcData | null> {
    try {
      const ncValue = await this.registeredDB.get(ncId);
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
   * @param ncId Nano Contract ID.
   * @param ncValue Nano contract basic information.
   * @async
   */
  async registerNanoContract(ncId: string, ncValue: INcData): Promise<void> {
    await this.registeredDB.put(ncId, ncValue);
  }

  /**
   * Unregister nano contract.
   *
   * @param ncId Nano Contract ID.
   * @async
   */
  async unregisterNanoContract(ncId: string): Promise<void> {
    await this.registeredDB.del(ncId);
  }


  /**
   * Update nano contract registered address.
   *
   * @param ncId Nano Contract ID.
   * @param address Nano Contract registered address.
   * @async
   */
  async updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void> {
    const currentNanoContractData = await this.getNanoContract(ncId);
    if (currentNanoContractData !== null) {
      return this.registeredDB.put(ncId, Object.assign(currentNanoContractData, { address }));
    }
  }
}
