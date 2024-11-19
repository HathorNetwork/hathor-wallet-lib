"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.WALLET_PREFIX = exports.GENERIC_PREFIX = exports.ACCESS_PREFIX = void 0;
var _path = _interopRequireDefault(require("path"));
var _level = require("level");
var _types = require("../../types");
var _constants = require("../../constants");
var _errors = require("./errors");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const ACCESS_PREFIX = exports.ACCESS_PREFIX = 'access';
const WALLET_PREFIX = exports.WALLET_PREFIX = 'wallet';
const GENERIC_PREFIX = exports.GENERIC_PREFIX = 'generic';
class LevelWalletIndex {
  constructor(dbpath) {
    _defineProperty(this, "dbpath", void 0);
    /**
     * Database to store wallet access data.
     */
    _defineProperty(this, "accessDB", void 0);
    /**
     * Database to store wallet data.
     */
    _defineProperty(this, "walletDB", void 0);
    /**
     * Database to store generic wallet data.
     */
    _defineProperty(this, "genericDB", void 0);
    _defineProperty(this, "indexVersion", '0.0.1');
    this.dbpath = _path.default.join(dbpath, 'wallet');
    const db = new _level.Level(this.dbpath);
    this.accessDB = db.sublevel(ACCESS_PREFIX, {
      valueEncoding: 'json'
    });
    this.walletDB = db.sublevel(WALLET_PREFIX);
    this.genericDB = db.sublevel(GENERIC_PREFIX, {
      valueEncoding: 'json'
    });
  }
  async close() {
    await this.accessDB.db.close();
  }

  /**
   * Save a number as a string encoded as the hex value.
   * Internal helper method, since this logic is used in multiple places.
   *
   * @param key The key to use when setting the value.
   * @param {number} value The value to set.
   */
  async _setNumber(key, value) {
    if (value < 0) {
      throw new Error(`Invalid unsigned int ${value} being set on ${key}`);
    }
    const val = value.toString(16).padStart(8, '0');
    await this.walletDB.put(key, val);
  }

  /**
   * Get the number from its hex value string saved on the database.
   * Internal helper method, since this logic is used in multiple places.
   *
   * @param {string} key The key to fetch.
   * @returns {Promise<number|null>}
   */
  async _getNumber(key) {
    try {
      const tmp = await this.walletDB.get(key);
      return Number(`0x${tmp}`);
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if the index version is valid.
   * @returns {Promise<null>}
   */
  async checkVersion() {
    const {
      db
    } = this.accessDB;
    const instanceName = this.constructor.name;
    await (0, _utils.checkLevelDbVersion)(instanceName, db, this.indexVersion);
  }

  /**
   * Validate the database.
   * @returns {Promise<void>}
   */
  async validate() {
    await this.checkVersion();
  }

  /**
   * Get the configured gap limit.
   * @returns {Promise<number>} defaults to constants.GAP_LIMIT
   */
  async getGapLimit() {
    const value = await this._getNumber('gapLimit');
    return value || _constants.GAP_LIMIT;
  }

  /**
   * Configure a wallet specific gap limit.
   * @param {number} value gap limit.
   */
  async setGapLimit(value) {
    await this._setNumber('gapLimit', value);
  }

  /**
   * Get the index limit.
   * @returns {Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>}
   */
  async getIndexLimit() {
    const startIndex = (await this._getNumber('startIndex')) || 0;
    const endIndex = (await this._getNumber('endIndex')) || 0;
    return {
      startIndex,
      endIndex
    };
  }

  /**
   * Get the value of the current address index.
   * The current address is the most recent unused address.
   * @returns {Promise<number>} defaults to -1
   */
  async getCurrentAddressIndex() {
    const value = await this._getNumber('currentAddressIndex');
    if (value === null) return -1;
    return value;
  }

  /**
   * Set the value of the current address index.
   * @param {number} value Current address index.
   * @returns {Promise<void>}
   */
  async setCurrentAddressIndex(value) {
    await this._setNumber('currentAddressIndex', value);
  }

  /**
   * Get the value of the current network height.
   * The network height is the number of blocks on the blockchain.
   * @returns {Promise<number>} defaults to 0
   */
  async getCurrentHeight() {
    const value = await this._getNumber('networkHeight');
    if (value === null) return 0;
    return value;
  }

  /**
   * Set the value of the current network height.
   * @param {number} value network height.
   * @returns {Promise<void>}
   */
  async setCurrentHeight(value) {
    await this._setNumber('networkHeight', value);
  }

  /**
   * Get the value of the last used address index.
   * The last used address is the highest address index that has been used.
   * @returns {Promise<number>} defaults to -1
   */
  async getLastUsedAddressIndex() {
    const value = await this._getNumber('lastUsedAddressIndex');
    if (value === null) return -1;
    return value;
  }

  /**
   * Set the value of the last used address index.
   * @param {number} value last used address index.
   * @returns {Promise<void>}
   */
  async setLastUsedAddressIndex(value) {
    await this._setNumber('lastUsedAddressIndex', value);
  }

  /**
   * Get the value of the last loaded address index.
   * The last loaded address is the highest address index.
   * @returns {Promise<number>} defaults to 0
   */
  async getLastLoadedAddressIndex() {
    const value = await this._getNumber('lastLoadedAddressIndex');
    if (value === null) return 0;
    return value;
  }

  /**
   * Set the value of the last loaded address index.
   * @param {number} value last loaded address index.
   * @returns {Promise<void>}
   */
  async setLastLoadedAddressIndex(value) {
    await this._setNumber('lastLoadedAddressIndex', value);
  }

  /**
   * Get the scanning policy.
   * @returns {Promise<AddressScanPolicy>}
   */
  async getScanningPolicy() {
    try {
      const value = await this.walletDB.get('scanningPolicy');
      if (!value) return _constants.DEFAULT_ADDRESS_SCANNING_POLICY;
      return value;
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        // Default behavior is gap-limit
        return _constants.DEFAULT_ADDRESS_SCANNING_POLICY;
      }
      throw err;
    }
  }
  async setScanningPolicyData(data) {
    if ((0, _types.isGapLimitScanPolicy)(data)) {
      await this.walletDB.put('scanningPolicy', _types.SCANNING_POLICY.GAP_LIMIT);
      await this.setGapLimit(data.gapLimit);
      return;
    }
    if ((0, _types.isIndexLimitScanPolicy)(data)) {
      await this.walletDB.put('scanningPolicy', _types.SCANNING_POLICY.INDEX_LIMIT);
      await this._setNumber('startIndex', data.startIndex);
      await this._setNumber('endIndex', data.endIndex);
      return;
    }
    throw new Error('Invalid scanning policy data');
  }
  async getScanningPolicyData() {
    const policy = await this.getScanningPolicy();
    if (policy === _types.SCANNING_POLICY.GAP_LIMIT) {
      return {
        policy: _types.SCANNING_POLICY.GAP_LIMIT,
        gapLimit: await this.getGapLimit()
      };
    }
    if (policy === _types.SCANNING_POLICY.INDEX_LIMIT) {
      return {
        policy: _types.SCANNING_POLICY.INDEX_LIMIT,
        startIndex: (await this._getNumber('startIndex')) || 0,
        endIndex: (await this._getNumber('endIndex')) || 0
      };
    }
    throw new Error('Invalid scanning policy');
  }

  /**
   * Get the wallet data.
   * @returns {Promise<IWalletData>}
   */
  async getWalletData() {
    const lastLoadedAddressIndex = await this.getLastLoadedAddressIndex();
    const lastUsedAddressIndex = await this.getLastUsedAddressIndex();
    const currentAddressIndex = await this.getCurrentAddressIndex();
    const bestBlockHeight = await this.getCurrentHeight();
    const scanPolicyData = await this.getScanningPolicyData();
    return {
      lastLoadedAddressIndex,
      lastUsedAddressIndex,
      currentAddressIndex,
      bestBlockHeight,
      scanPolicyData
    };
  }

  /**
   * Save wallet access data.
   * @param {IWalletAccessData} data Wallet access data.
   * @returns {Promise<void>}
   */
  async saveAccessData(data) {
    await this.accessDB.put('data', data);
  }

  /**
   * Get wallet access data.
   * @returns {Promise<IWalletAccessData | null>}
   */
  async getAccessData() {
    try {
      return await this.accessDB.get('data');
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
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
  async getItem(key) {
    try {
      return await this.genericDB.get(key);
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
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
  async setItem(key, value) {
    await this.genericDB.put(key, value);
  }

  /**
   * Clean the wallet access data.
   */
  async cleanAccessData() {
    await this.accessDB.clear();
  }
  async cleanWalletData(clear = false) {
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

  /**
   * Delete all entries on the database.
   */
  async clear() {
    this.walletDB.db.clear();
  }
}
exports.default = LevelWalletIndex;