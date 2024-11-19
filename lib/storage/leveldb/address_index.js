"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.INDEX_PREFIX = exports.ADDRESS_PREFIX = exports.ADDRESS_META_PREFIX = void 0;
var _path = _interopRequireDefault(require("path"));
var _level = require("level");
var _errors = require("./errors");
var _utils = require("./utils");
var _bigint = require("../../utils/bigint");
var _schemas = require("../../schemas");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _awaitAsyncGenerator(e) { return new _OverloadYield(e, 0); }
function _wrapAsyncGenerator(e) { return function () { return new AsyncGenerator(e.apply(this, arguments)); }; }
function AsyncGenerator(e) { var r, t; function resume(r, t) { try { var n = e[r](t), o = n.value, u = o instanceof _OverloadYield; Promise.resolve(u ? o.v : o).then(function (t) { if (u) { var i = "return" === r ? "return" : "next"; if (!o.k || t.done) return resume(i, t); t = e[i](t).value; } settle(n.done ? "return" : "normal", t); }, function (e) { resume("throw", e); }); } catch (e) { settle("throw", e); } } function settle(e, n) { switch (e) { case "return": r.resolve({ value: n, done: !0 }); break; case "throw": r.reject(n); break; default: r.resolve({ value: n, done: !1 }); } (r = r.next) ? resume(r.key, r.arg) : t = null; } this._invoke = function (e, n) { return new Promise(function (o, u) { var i = { key: e, arg: n, resolve: o, reject: u, next: null }; t ? t = t.next = i : (r = t = i, resume(e, n)); }); }, "function" != typeof e.return && (this.return = void 0); }
AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function () { return this; }, AsyncGenerator.prototype.next = function (e) { return this._invoke("next", e); }, AsyncGenerator.prototype.throw = function (e) { return this._invoke("throw", e); }, AsyncGenerator.prototype.return = function (e) { return this._invoke("return", e); };
function _OverloadYield(e, d) { this.v = e, this.k = d; }
function _asyncIterator(r) { var n, t, o, e = 2; for ("undefined" != typeof Symbol && (t = Symbol.asyncIterator, o = Symbol.iterator); e--;) { if (t && null != (n = r[t])) return n.call(r); if (o && null != (n = r[o])) return new AsyncFromSyncIterator(n.call(r)); t = "@@asyncIterator", o = "@@iterator"; } throw new TypeError("Object is not async iterable"); }
function AsyncFromSyncIterator(r) { function AsyncFromSyncIteratorContinuation(r) { if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object.")); var n = r.done; return Promise.resolve(r.value).then(function (r) { return { value: r, done: n }; }); } return AsyncFromSyncIterator = function (r) { this.s = r, this.n = r.next; }, AsyncFromSyncIterator.prototype = { s: null, n: null, next: function () { return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments)); }, return: function (r) { var n = this.s.return; return void 0 === n ? Promise.resolve({ value: r, done: !0 }) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); }, throw: function (r) { var n = this.s.return; return void 0 === n ? Promise.reject(r) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); } }, new AsyncFromSyncIterator(r); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const ADDRESS_PREFIX = exports.ADDRESS_PREFIX = 'address';
const INDEX_PREFIX = exports.INDEX_PREFIX = 'index';
const ADDRESS_META_PREFIX = exports.ADDRESS_META_PREFIX = 'meta';

/**
 * The database key for addressIndexDB is a string.
 * This method converts the index number to its string representation.
 *
 * @param index The address index
 * @returns {string} hex value of the uint32 representation of the index
 */
function _index_key(index) {
  // .toString(16) will convert the number to a hex string
  // .padStart(8, '0') will pad the number to 4 bytes
  return index.toString(16).padStart(8, '0');
}
class LevelAddressIndex {
  constructor(dbpath) {
    _defineProperty(this, "dbpath", void 0);
    // Level implements AbstractLevel (with extra options like location, etc)
    // SubLevel implements AbstractSublevel which extends AbstractLevel
    // AbstractSubLevel requires the type of database(Level) the type of information saved at the database (string|Buffer|Uint8Array) and the types of keys and values it expects.
    /**
     * Main address database
     * Key: address in base58
     * Value: json encoded IAddressInfo
     */
    _defineProperty(this, "addressesDB", void 0);
    /**
     * Index database
     * Key: index in uint32
     * Value: address in base58
     */
    _defineProperty(this, "addressesIndexDB", void 0);
    /**
     * Address metadata database
     * Key: address in base58
     * Value: json encoded IAddressMetadata
     */
    _defineProperty(this, "addressesMetaDB", void 0);
    /**
     * Whether the index is validated or not
     * This is used to avoid using the address count before we know it is valid.
     */
    _defineProperty(this, "isValidated", void 0);
    _defineProperty(this, "indexVersion", '0.0.1');
    _defineProperty(this, "size", void 0);
    this.dbpath = _path.default.join(dbpath, 'addresses');
    // Open addresses
    const db = new _level.Level(this.dbpath);
    this.addressesDB = db.sublevel(ADDRESS_PREFIX, {
      valueEncoding: 'json'
    });
    this.addressesIndexDB = db.sublevel(INDEX_PREFIX);
    this.addressesMetaDB = db.sublevel(ADDRESS_META_PREFIX, {
      valueEncoding: (0, _bigint.jsonBigIntEncoding)(_schemas.IAddressMetadataAsRecordSchema)
    });
    this.isValidated = false;
    this.size = 0;
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close() {
    await this.addressesDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion() {
    const {
      db
    } = this.addressesDB;
    const instanceName = this.constructor.name;
    await (0, _utils.checkLevelDbVersion)(instanceName, db, this.indexVersion);
  }

  /**
   * Validate the index consistency along with the sublevel children.
   * We check that all addresses in the addressesDB have an index in the addressesIndexDB.
   * @returns {Promise<AddressIndexValidateResponse>} The first and last index in the database
   */
  async validate() {
    // Clear metadata since we cannot guarantee the validity
    await this.addressesMetaDB.clear();
    const ret = {
      firstIndex: Infinity,
      lastIndex: -1
    };
    let size = 0;
    // Iterate on all addresses and check that we have a corresponding index entry
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(this.addressesDB.iterator()), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const [key, value] = _step.value;
        {
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
            const addressFromIndex = await this.addressesIndexDB.get(_index_key(value.bip32AddressIndex));
            if (value.base58 !== addressFromIndex) {
              throw new Error('Inconsistent database');
            }
          } catch (err) {
            if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
              // Create if index is missing
              await this.addressesIndexDB.put(_index_key(value.bip32AddressIndex), value.base58);
              continue;
            }
            throw err;
          }
        }
      }

      // We just did a full address count, we can save the size and trust it
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (_iteratorAbruptCompletion && _iterator.return != null) {
          await _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }
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
  async addressCount() {
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
  async runAddressCount() {
    let size = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- No use for the variable: just a counter
    var _iteratorAbruptCompletion2 = false;
    var _didIteratorError2 = false;
    var _iteratorError2;
    try {
      for (var _iterator2 = _asyncIterator(this.addressesDB.iterator()), _step2; _iteratorAbruptCompletion2 = !(_step2 = await _iterator2.next()).done; _iteratorAbruptCompletion2 = false) {
        const _ = _step2.value;
        {
          size++;
        }
      }
    } catch (err) {
      _didIteratorError2 = true;
      _iteratorError2 = err;
    } finally {
      try {
        if (_iteratorAbruptCompletion2 && _iterator2.return != null) {
          await _iterator2.return();
        }
      } finally {
        if (_didIteratorError2) {
          throw _iteratorError2;
        }
      }
    }
    return size;
  }

  /**
   * Fetch the address info from the database.
   * @param {string} base58 The address in base58
   * @returns {Promise<IAddressInfo|null>}
   */
  async getAddressInfo(base58) {
    try {
      return await this.addressesDB.get(base58);
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
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
  async addressExists(base58) {
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
  addressIter() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion3 = false;
      var _didIteratorError3 = false;
      var _iteratorError3;
      try {
        for (var _iterator3 = _asyncIterator(_this.addressesIndexDB.values()), _step3; _iteratorAbruptCompletion3 = !(_step3 = yield _awaitAsyncGenerator(_iterator3.next())).done; _iteratorAbruptCompletion3 = false) {
          const address = _step3.value;
          {
            const info = yield _awaitAsyncGenerator(_this.getAddressInfo(address));
            if (info === null) {
              throw new Error('Inconsistent database');
            }
            yield info;
          }
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion3 && _iterator3.return != null) {
            yield _awaitAsyncGenerator(_iterator3.return());
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }
    })();
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
  async setAddressMeta(address, meta) {
    const dbMeta = {
      numTransactions: meta.numTransactions,
      balance: {}
    };
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
  async getAddressMeta(base58) {
    try {
      const dbmeta = await this.addressesMetaDB.get(base58);
      const meta = {
        numTransactions: dbmeta.numTransactions,
        balance: new Map()
      };
      for (const [uid, balance] of Object.entries(dbmeta.balance)) {
        meta.balance.set(uid, balance);
      }
      return meta;
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
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
  async getAddressAtIndex(index) {
    if (index < 0) {
      return null;
    }
    try {
      return await this.addressesIndexDB.get(_index_key(index));
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save address on database.
   * @param info Address info to save
   */
  async saveAddress(info) {
    await this.addressesDB.put(info.base58, info);
    await this.addressesIndexDB.put(_index_key(info.bip32AddressIndex), info.base58);
    this.size++;
  }

  /**
   * Clear the address metadata database.
   */
  async clearMeta() {
    await this.addressesMetaDB.clear();
  }

  /**
   * Clear the entire address database.
   */
  async clear() {
    this.addressesDB.db.clear();
  }
}
exports.default = LevelAddressIndex;