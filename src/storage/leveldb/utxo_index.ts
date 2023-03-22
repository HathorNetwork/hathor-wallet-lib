/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level, ValueIteratorOptions } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVUtxoIndex, IUtxo, IUtxoFilterOptions, ILockedUtxo } from '../../types';
import _ from 'lodash';
import { BLOCK_VERSION, HATHOR_TOKEN_CONFIG, MAX_INPUTS } from '../../constants';
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';

export const UTXO_PREFIX = 'utxo';
export const TOKEN_ADDRESS_UTXO_PREFIX = 'token:address:utxo';
export const TOKEN_UTXO_PREFIX = 'token:utxo';
export const LOCKED_UTXO_PREFIX = 'locked:utxo';

/**
 * Create a string representing the utxo id to be used as database key.
 * @param {Pick<IUtxo, 'txId'|'index'>} utxo The utxo to calculate the id
 * @returns {string} a string representing the utxo id
 */
function _utxo_id(utxo: Pick<IUtxo, 'txId'|'index'>): string {
  return `${utxo.txId}:${utxo.index}`;
}

/**
 * Create the database key for tokenAddressUtxoDB from the utxo.
 * @param {IUtxo} utxo
 * @returns {string}
 */
function _token_address_utxo_key(utxo: IUtxo): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUint64BE(BigInt(utxo.value));
  const value = buf.toString('hex');
  return `${utxo.authorities}:${utxo.token}:${utxo.address}:${value}:${_utxo_id(utxo)}`;
}

/**
 * Create the database key for tokenUtxoDB from the utxo.
 * @param {IUtxo} utxo
 * @returns {string}
 */
function _token_utxo_key(utxo: IUtxo): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUint64BE(BigInt(utxo.value));
  const value = buf.toString('hex');
  return `${utxo.authorities}:${utxo.token}:${value}:${_utxo_id(utxo)}`;
}

export default class LevelUtxoIndex implements IKVUtxoIndex {
  dbpath: string;
  /**
   * Main utxo database
   * Key: tx_id:index
   * Value: IUtxo (json encoded)
   */
  utxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
  /**
   * Reverse search index for utxo database
   * Key: authorities:token:value:tx_id:index
   * Value: IUtxo (json encoded)
   */
  tokenUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
  /**
   * Reverse search index for utxo database
   * Key: authorities:token:address:value:tx_id:index
   * Value: IUtxo (json encoded)
   */
  tokenAddressUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
  /**
   * Locked utxo database
   * Key: tx_id:index
   * Value: ILockedUtxo (json encoded)
   */
  lockedUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ILockedUtxo>;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'utxos');
    const db = new Level(this.dbpath);
    this.utxoDB = db.sublevel<string, IUtxo>(UTXO_PREFIX, { valueEncoding: 'json' });
    this.tokenUtxoDB = db.sublevel<string, IUtxo>(TOKEN_UTXO_PREFIX, { valueEncoding: 'json' });
    this.tokenAddressUtxoDB = db.sublevel<string, IUtxo>(TOKEN_ADDRESS_UTXO_PREFIX, { valueEncoding: 'json' });
    this.lockedUtxoDB = db.sublevel<string, ILockedUtxo>(LOCKED_UTXO_PREFIX, { valueEncoding: 'json' });
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    await this.utxoDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion(): Promise<void> {
    const db = this.utxoDB.db;
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

    // Iterate on all addresses and check that we have a corresponding index entry
    for await (const [key, value] of this.utxoDB.iterator()) {
      if (key !== _utxo_id(value)) {
        throw new Error('Inconsistent database');
      }

      try {
        const tokenUtxo = await this.tokenUtxoDB.get(_token_utxo_key(value));
        if (!_.isEqual(tokenUtxo, value)) {
          throw new Error('Inconsistent database')
        }

      } catch(err: unknown) {
        if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
          // Create if missing
          await this.tokenUtxoDB.put(_token_utxo_key(value), value);
        } else {
          throw err;
        }
      }

      try {
        const tokenAddrUtxo = await this.tokenAddressUtxoDB.get(_token_address_utxo_key(value));
        if (!_.isEqual(tokenAddrUtxo, value)) {
          throw new Error('Inconsistent database')
        }
      } catch(err: unknown) {
        if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
          // Create if missing
          await this.tokenAddressUtxoDB.put(_token_address_utxo_key(value), value);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Iterate on all utxos in the database.
   * @returns {AsyncGenerator<IUtxo>}
   */
  async * utxoIter(): AsyncGenerator<IUtxo> {
    for await (const utxo of this.utxoDB.values()) {
      yield utxo;
    }
  }

  /**
   * Select utxos to match the given filter options.
   *
   * Depending on which options are set, the utxos will be filtered using different indexes.
   * We expect `token` and `authorities` to always be set.
   * If we have `address` set, we will use the `tokenAddressUtxoDB` index.
   * Otherwise we will use the `tokenUtxoDB` index.
   *
   * The value filter works since we use the uint64 in big endian.
   *
   * @param {IUtxoFilterOptions} options Which parameters to use to filter the utxos.
   * @param {number|undefined} networkHeight Height of the network, used to check if the utxo is height locked
   * @returns {AsyncGenerator<IUtxo>}
   */
  async * selectUtxos(options: IUtxoFilterOptions, networkHeight?: number): AsyncGenerator<IUtxo> {
    const isHeightLocked = (utxo: IUtxo) => {
      if (utxo.type !== BLOCK_VERSION) {
        // Only blocks can be reward locked
        return false;
      }
      if (!(options.reward_lock && networkHeight)) {
        // We do not have details to process reward lock
        return false;
      }
      // Heighlocked when network height is lower than block height + reward_spend_min_blocks
      return ((utxo.height || 0) + options.reward_lock) > networkHeight;
    };
    const nowTs = Math.floor(Date.now() / 1000);
    const isTimelocked = (utxo: IUtxo) => {
      if (utxo.timelock === null) {
        // Not timelocked
        return false;
      }
      // Timelocked when now is lower than timelock
      return nowTs < utxo.timelock;
    };

    const token = options.token || HATHOR_TOKEN_CONFIG.uid;
    const authorities = options.authorities || 0;
    const maxUtxos = options.max_utxos || MAX_INPUTS;

    let db: typeof this.utxoDB;
    const itOptions: ValueIteratorOptions<string, IUtxo> = {};
    if (options.filter_address !== undefined) {
      // Use tokenAddressUtxoDB
      db = this.tokenAddressUtxoDB;
      let minkey = `${authorities}:${token}:${options.filter_address}:`;
      let maxkey = `${authorities}:${token}:`;

      if (options.amount_bigger_than) {
        const minvalbuf = Buffer.alloc(8);
        minvalbuf.writeBigUint64BE(BigInt(options.amount_bigger_than));
        minkey = `${minkey}${minvalbuf.toString('hex')}`;
      }
      if (options.amount_smaller_than !== undefined) {
        const maxvalbuf = Buffer.alloc(8);
        maxvalbuf.writeBigUint64BE(BigInt(options.amount_smaller_than + 1));
        maxkey = `${maxkey}${options.filter_address}:${maxvalbuf.toString('hex')}`;
      } else {
        const lastChar = String.fromCharCode(options.filter_address.charCodeAt(options.filter_address.length - 1) + 1);
        const maxaddr = `${options.filter_address.slice(0, -1)}${lastChar}`;
        maxkey = `${maxkey}${maxaddr}:`;
      }

      itOptions.gte = minkey;
      itOptions.lte = maxkey;
    } else {
      // No need to filter by address, just tokens
      db = this.tokenUtxoDB;
      let minkey = `${authorities}:${token}:`;
      let maxkey = `${authorities}:`;

      if (options.amount_bigger_than) {
        const minvalbuf = Buffer.alloc(8);
        minvalbuf.writeBigUint64BE(BigInt(options.amount_bigger_than));
        minkey = `${minkey}${minvalbuf.toString('hex')}`;
      }
      if (options.amount_smaller_than !== undefined) {
        const maxvalbuf = Buffer.alloc(8);
        maxvalbuf.writeBigUint64BE(BigInt(options.amount_smaller_than + 1));
        maxkey = `${maxkey}${token}:${maxvalbuf.toString('hex')}`;
      } else {
        const lastChar = String.fromCharCode(token.charCodeAt(token.length - 1) + 1);
        const maxtoken = `${token.slice(0, -1)}${lastChar}`;
        maxkey = `${maxkey}${maxtoken}:`;
      }

      itOptions.gte = minkey;
      itOptions.lte = maxkey;
    }

    let sumAmount = 0;
    let utxoNum = 0;
    for await (const utxo of db.values(itOptions)) {
      if (options.only_available_utxos) {
        if (isHeightLocked(utxo) || isTimelocked(utxo)) {
          continue;
        }
      }
      if (options.filter_method && !options.filter_method(utxo)) {
        continue;
      }
      if (options.max_amount && ((sumAmount + utxo.value) > options.max_amount)) {
        continue;
      }

      yield utxo;

      utxoNum += 1;
      sumAmount += utxo.value;

      if ((options.target_amount && sumAmount >= options.target_amount) || (utxoNum >= maxUtxos)) {
        // We have reached either the target amount or the max number of utxos requested
        return;
      }
    }
  }

  /**
   * Save utxo on the database.
   * Also save on all reverse search indexes.
   * @param {IUtxo} utxo
   * @returns {Promise<void>}
   */
  async saveUtxo(utxo: IUtxo): Promise<void> {
    await this.utxoDB.put(_utxo_id(utxo), utxo);
    await this.tokenAddressUtxoDB.put(_token_address_utxo_key(utxo), utxo);
    await this.tokenUtxoDB.put(_token_utxo_key(utxo), utxo);
  }

  /**
   * Save a locked utxo on the database.
   *
   * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
   * @returns {Promise<void>}
   */
  async saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void> {
    const utxoId = _utxo_id({txId: lockedUtxo.tx.tx_id, index: lockedUtxo.index});
    return this.lockedUtxoDB.put(utxoId, lockedUtxo);
  }

  /**
   * Remove a locked utxo from the database.
   * @param {ILockedUtxo} lockedUtxo Locked utxo to be unlocked
   * @returns {Promise<void>}
   */
  async unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void> {
    const utxoId = _utxo_id({txId: lockedUtxo.tx.tx_id, index: lockedUtxo.index});
    return this.lockedUtxoDB.del(utxoId);
  }

  /**
   * Iterate on all locked utxos
   * @returns {AsyncGenerator<ILockedUtxo>}
   */
  async *iterateLockedUtxos(): AsyncGenerator<ILockedUtxo> {
    for await (const lockedUtxo of this.lockedUtxoDB.values()) {
      yield lockedUtxo;
    }
  }

  /**
   * Clear all entries from the database.
   * @returns {Promise<void>}
   */
  async clear(): Promise<void> {
    // This should clear all utxos subdbs
    await this.utxoDB.db.clear();
    await this.lockedUtxoDB.clear();
  }
}