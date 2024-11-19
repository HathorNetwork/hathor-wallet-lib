"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.UTXO_PREFIX = exports.TOKEN_UTXO_PREFIX = exports.TOKEN_ADDRESS_UTXO_PREFIX = exports.LOCKED_UTXO_PREFIX = void 0;
var _path = _interopRequireDefault(require("path"));
var _level = require("level");
var _lodash = _interopRequireDefault(require("lodash"));
var _constants = require("../../constants");
var _errors = require("./errors");
var _transaction = _interopRequireDefault(require("../../utils/transaction"));
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
const UTXO_PREFIX = exports.UTXO_PREFIX = 'utxo';
const TOKEN_ADDRESS_UTXO_PREFIX = exports.TOKEN_ADDRESS_UTXO_PREFIX = 'token:address:utxo';
const TOKEN_UTXO_PREFIX = exports.TOKEN_UTXO_PREFIX = 'token:utxo';
const LOCKED_UTXO_PREFIX = exports.LOCKED_UTXO_PREFIX = 'locked:utxo';

/**
 * Create a string representing the utxo id to be used as database key.
 * @param {Pick<IUtxo, 'txId'|'index'>} utxo The utxo to calculate the id
 * @returns {string} a string representing the utxo id
 */
function _utxo_id(utxo) {
  return `${utxo.txId}:${utxo.index}`;
}

/**
 * Create the database key for tokenAddressUtxoDB from the utxo.
 * @param {IUtxo} utxo
 * @returns {string}
 */
function _token_address_utxo_key(utxo) {
  const value = _big_int_to_hex(utxo.value);
  return `${utxo.authorities}:${utxo.token}:${utxo.address}:${value}:${_utxo_id(utxo)}`;
}
function _big_int_to_hex(value) {
  return value.toString(16).padStart(16, '0');
}

/**
 * Create the database key for tokenUtxoDB from the utxo.
 * @param {IUtxo} utxo
 * @returns {string}
 */
function _token_utxo_key(utxo) {
  return `${utxo.authorities}:${utxo.token}:${_big_int_to_hex(utxo.value)}:${_utxo_id(utxo)}`;
}
class LevelUtxoIndex {
  constructor(dbpath) {
    _defineProperty(this, "dbpath", void 0);
    /**
     * Main utxo database
     * Key: tx_id:index
     * Value: IUtxo (json encoded)
     */
    _defineProperty(this, "utxoDB", void 0);
    /**
     * Reverse search index for utxo database
     * Key: authorities:token:value:tx_id:index
     * Value: IUtxo (json encoded)
     */
    _defineProperty(this, "tokenUtxoDB", void 0);
    /**
     * Reverse search index for utxo database
     * Key: authorities:token:address:value:tx_id:index
     * Value: IUtxo (json encoded)
     */
    _defineProperty(this, "tokenAddressUtxoDB", void 0);
    /**
     * Locked utxo database
     * Key: tx_id:index
     * Value: ILockedUtxo (json encoded)
     */
    _defineProperty(this, "lockedUtxoDB", void 0);
    _defineProperty(this, "indexVersion", '0.0.1');
    this.dbpath = _path.default.join(dbpath, 'utxos');
    const db = new _level.Level(this.dbpath);
    const utxoEncoding = (0, _bigint.jsonBigIntEncoding)(_schemas.IUtxoSchema);
    this.utxoDB = db.sublevel(UTXO_PREFIX, {
      valueEncoding: utxoEncoding
    });
    this.tokenUtxoDB = db.sublevel(TOKEN_UTXO_PREFIX, {
      valueEncoding: utxoEncoding
    });
    this.tokenAddressUtxoDB = db.sublevel(TOKEN_ADDRESS_UTXO_PREFIX, {
      valueEncoding: utxoEncoding
    });
    this.lockedUtxoDB = db.sublevel(LOCKED_UTXO_PREFIX, {
      valueEncoding: (0, _bigint.jsonBigIntEncoding)(_schemas.ILockedUtxoSchema)
    });
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close() {
    await this.utxoDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion() {
    const {
      db
    } = this.utxoDB;
    const instanceName = this.constructor.name;
    await (0, _utils.checkLevelDbVersion)(instanceName, db, this.indexVersion);
  }
  async validate() {
    await this.checkVersion();

    // Iterate on all addresses and check that we have a corresponding index entry
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(this.utxoDB.iterator()), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const [key, value] = _step.value;
        {
          if (key !== _utxo_id(value)) {
            throw new Error('Inconsistent database');
          }
          try {
            const tokenUtxo = await this.tokenUtxoDB.get(_token_utxo_key(value));
            if (!_lodash.default.isEqual(tokenUtxo, value)) {
              throw new Error('Inconsistent database');
            }
          } catch (err) {
            if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
              // Create if missing
              await this.tokenUtxoDB.put(_token_utxo_key(value), value);
            } else {
              throw err;
            }
          }
          try {
            const tokenAddrUtxo = await this.tokenAddressUtxoDB.get(_token_address_utxo_key(value));
            if (!_lodash.default.isEqual(tokenAddrUtxo, value)) {
              throw new Error('Inconsistent database');
            }
          } catch (err) {
            if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
              // Create if missing
              await this.tokenAddressUtxoDB.put(_token_address_utxo_key(value), value);
              continue;
            }
            throw err;
          }
        }
      }
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
  }

  /**
   * Iterate on all utxos in the database.
   * @returns {AsyncGenerator<IUtxo>}
   */
  utxoIter() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion2 = false;
      var _didIteratorError2 = false;
      var _iteratorError2;
      try {
        for (var _iterator2 = _asyncIterator(_this.utxoDB.values()), _step2; _iteratorAbruptCompletion2 = !(_step2 = yield _awaitAsyncGenerator(_iterator2.next())).done; _iteratorAbruptCompletion2 = false) {
          const utxo = _step2.value;
          {
            yield utxo;
          }
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion2 && _iterator2.return != null) {
            yield _awaitAsyncGenerator(_iterator2.return());
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }
    })();
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
  selectUtxos(options, networkHeight) {
    var _this2 = this;
    return _wrapAsyncGenerator(function* () {
      const isHeightLocked = utxo => {
        if (!_transaction.default.isBlock({
          version: utxo.type
        })) {
          // Only blocks can be reward locked
          return false;
        }
        return _transaction.default.isHeightLocked(utxo.height, networkHeight, options.reward_lock);
      };
      const nowTs = Math.floor(Date.now() / 1000);
      const isTimelocked = utxo => {
        if (utxo.timelock === null) {
          // Not timelocked
          return false;
        }
        // Timelocked when now is lower than timelock
        return nowTs < utxo.timelock;
      };
      const token = options.token || _constants.NATIVE_TOKEN_UID;
      const authorities = options.authorities || 0;
      let db;
      const itOptions = {};
      if (options.order_by_value === 'desc') {
        // The default behavior is to iterate in ascending order of keys
        // And the keys are in the format <authorities>:<token>:<value>:<tx_id>:<index>
        // Or <authorities>:<token>:<address>:<value>:<tx_id>:<index>
        // But in both the authorities and token are fixed (address is only used when it is fixed as well)
        // So the value is always the first "free" part of the key and since we are using big endian
        // The iteration will always order the value in ascending order
        // And the reverse iteration will order the value in descending order
        itOptions.reverse = true;
      }
      if (options.filter_address !== undefined) {
        // Use tokenAddressUtxoDB
        // Key: <authorities>:<token>:<address>:<value>:<tx_id>:<index>
        // authorities, token and address are fixed
        // value can be filtered with options.amount_bigger_than and options.amount_smaller_than
        db = _this2.tokenAddressUtxoDB;
        let minkey = `${authorities}:${token}:${options.filter_address}:`;
        let maxkey = `${authorities}:${token}:`;
        if (options.amount_bigger_than) {
          minkey = `${minkey}${_big_int_to_hex(options.amount_bigger_than)}`;
        }
        if (options.amount_smaller_than !== undefined) {
          maxkey = `${maxkey}${options.filter_address}:${_big_int_to_hex(options.amount_smaller_than + 1n)}`;
        } else {
          const lastChar = String.fromCharCode(options.filter_address.charCodeAt(options.filter_address.length - 1) + 1);
          const maxaddr = `${options.filter_address.slice(0, -1)}${lastChar}`;
          maxkey = `${maxkey}${maxaddr}:`;
        }
        itOptions.gte = minkey;
        itOptions.lte = maxkey;
      } else {
        // No need to filter by address, just tokens
        // Key: <authorities>:<token>:<value>:<tx_id>:<index>
        // authorities and token are fixed
        // value can be filtered with options.amount_bigger_than and options.amount_smaller_than
        db = _this2.tokenUtxoDB;
        let minkey = `${authorities}:${token}:`;
        let maxkey = `${authorities}:`;
        if (options.amount_bigger_than) {
          minkey = `${minkey}${_big_int_to_hex(options.amount_bigger_than)}`;
        }
        if (options.amount_smaller_than !== undefined) {
          maxkey = `${maxkey}${token}:${_big_int_to_hex(options.amount_smaller_than + 1n)}`;
        } else {
          const lastChar = String.fromCharCode(token.charCodeAt(token.length - 1) + 1);
          const maxtoken = `${token.slice(0, -1)}${lastChar}`;
          maxkey = `${maxkey}${maxtoken}:`;
        }
        itOptions.gte = minkey;
        itOptions.lte = maxkey;
      }
      let sumAmount = 0n;
      let utxoNum = 0;
      var _iteratorAbruptCompletion3 = false;
      var _didIteratorError3 = false;
      var _iteratorError3;
      try {
        for (var _iterator3 = _asyncIterator(db.values(itOptions)), _step3; _iteratorAbruptCompletion3 = !(_step3 = yield _awaitAsyncGenerator(_iterator3.next())).done; _iteratorAbruptCompletion3 = false) {
          const utxo = _step3.value;
          {
            if (options.only_available_utxos) {
              if (isHeightLocked(utxo) || isTimelocked(utxo)) {
                continue;
              }
            }
            if (options.filter_method && !options.filter_method(utxo)) {
              continue;
            }
            if (options.max_amount && sumAmount + utxo.value > options.max_amount) {
              continue;
            }
            yield utxo;
            utxoNum += 1;
            sumAmount += utxo.value;
            if (options.target_amount && sumAmount >= options.target_amount || options.max_utxos && utxoNum >= options.max_utxos) {
              // We have reached either the target amount or the max number of utxos requested
              return;
            }
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
   * Save utxo on the database.
   * Also save on all reverse search indexes.
   * @param {IUtxo} utxo
   * @returns {Promise<void>}
   */
  async saveUtxo(utxo) {
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
  async saveLockedUtxo(lockedUtxo) {
    const utxoId = _utxo_id({
      txId: lockedUtxo.tx.tx_id,
      index: lockedUtxo.index
    });
    return this.lockedUtxoDB.put(utxoId, lockedUtxo);
  }

  /**
   * Remove a locked utxo from the database.
   * @param {ILockedUtxo} lockedUtxo Locked utxo to be unlocked
   * @returns {Promise<void>}
   */
  async unlockUtxo(lockedUtxo) {
    const utxoId = _utxo_id({
      txId: lockedUtxo.tx.tx_id,
      index: lockedUtxo.index
    });
    return this.lockedUtxoDB.del(utxoId);
  }

  /**
   * Iterate on all locked utxos
   * @returns {AsyncGenerator<ILockedUtxo>}
   */
  iterateLockedUtxos() {
    var _this3 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion4 = false;
      var _didIteratorError4 = false;
      var _iteratorError4;
      try {
        for (var _iterator4 = _asyncIterator(_this3.lockedUtxoDB.values()), _step4; _iteratorAbruptCompletion4 = !(_step4 = yield _awaitAsyncGenerator(_iterator4.next())).done; _iteratorAbruptCompletion4 = false) {
          const lockedUtxo = _step4.value;
          {
            yield lockedUtxo;
          }
        }
      } catch (err) {
        _didIteratorError4 = true;
        _iteratorError4 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion4 && _iterator4.return != null) {
            yield _awaitAsyncGenerator(_iterator4.return());
          }
        } finally {
          if (_didIteratorError4) {
            throw _iteratorError4;
          }
        }
      }
    })();
  }

  /**
   * Clear all entries from the database.
   * @returns {Promise<void>}
   */
  async clear() {
    // This should clear all utxos subdbs
    await this.utxoDB.db.clear();
  }
}
exports.default = LevelUtxoIndex;