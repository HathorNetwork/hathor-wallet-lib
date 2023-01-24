/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import { Level, ValueIteratorOptions } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVUtxoIndex, IUtxo, IUtxoFilterOptions } from '../../types';
import _ from 'lodash';
import { BLOCK_VERSION, HATHOR_TOKEN_CONFIG, MAX_INPUTS } from '../../constants';
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from './errors';

export const UTXO_PREFIX = 'utxo';
export const TOKEN_ADDRESS_UTXO_PREFIX = 'token:address:utxo';
export const TOKEN_UTXO_PREFIX = 'token:utxo';

function _utxo_id(utxo: Pick<IUtxo, 'txId'|'index'>): string {
  return `${utxo.txId}:${utxo.index}`;
}

function _token_address_utxo_key(utxo: IUtxo): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUint64BE(BigInt(utxo.value));
  const value = buf.toString('hex');
  return `${utxo.authorities}:${utxo.token}:${utxo.address}:${value}:${_utxo_id(utxo)}`;
}

function _token_utxo_key(utxo: IUtxo): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUint64BE(BigInt(utxo.value));
  const value = buf.toString('hex');
  return `${utxo.authorities}:${utxo.token}:${value}:${_utxo_id(utxo)}`;
}

export default class LevelUtxoIndex implements IKVUtxoIndex {
  dbpath: string;
  utxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
  tokenUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
  tokenAddressUtxoDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IUtxo>;
  indexVersion: string = '0.0.1';

  constructor(dbpath: string) {
    this.dbpath = path.join(dbpath, 'utxos');
    const db = new Level(this.dbpath);
    this.utxoDB = db.sublevel<string, IUtxo>(UTXO_PREFIX, { valueEncoding: 'json' });
    this.tokenUtxoDB = db.sublevel<string, IUtxo>(TOKEN_UTXO_PREFIX, { valueEncoding: 'json' });
    this.tokenAddressUtxoDB = db.sublevel<string, IUtxo>(TOKEN_ADDRESS_UTXO_PREFIX, { valueEncoding: 'json' });
  }

  async close(): Promise<void> {
    await this.utxoDB.db.close();
  }

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

  async * utxoIter(): AsyncGenerator<IUtxo> {
    for await (const utxo of this.utxoDB.values()) {
      yield utxo;
    }
  }

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
      if (isHeightLocked(utxo) || (options.filter_method && !options.filter_method(utxo))) {
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

  async saveUtxo(utxo: IUtxo): Promise<void> {
    await this.utxoDB.put(_utxo_id(utxo), utxo);
    await this.tokenAddressUtxoDB.put(_token_address_utxo_key(utxo), utxo);
    await this.tokenUtxoDB.put(_token_utxo_key(utxo), utxo);
  }

  async clear(): Promise<void> {
    // This should clear all utxos subdbs
    await this.utxoDB.db.clear();
    // await this.utxoDB.clear();
    // await this.tokenUtxoDB.clear();
    // await this.tokenAddressUtxoDB.clear();    
  }
}