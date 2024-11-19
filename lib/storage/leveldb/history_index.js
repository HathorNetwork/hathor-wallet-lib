"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.TS_HISTORY_PREFIX = exports.HISTORY_PREFIX = void 0;
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
const HISTORY_PREFIX = exports.HISTORY_PREFIX = 'history';
const TS_HISTORY_PREFIX = exports.TS_HISTORY_PREFIX = 'ts_history';
function _ts_key(tx) {
  // .toString(16) will convert the number to a hex string
  // .padStart(8, '0') will pad the number to 4 bytes
  const hexTimestamp = tx.timestamp.toString(16).padStart(8, '0');
  return `${hexTimestamp}:${tx.tx_id}`;
}
class LevelHistoryIndex {
  constructor(dbpath) {
    _defineProperty(this, "dbpath", void 0);
    /**
     * Main tx history database:
     * Key: tx_id
     * Value: IHistoryTx (json encoded)
     */
    _defineProperty(this, "historyDB", void 0);
    /**
     * Timestamp index, used to iterate on transaction in order.
     * Key: timestamp:tx_id
     * Value: IHistoryTx (json encoded)
     */
    _defineProperty(this, "tsHistoryDB", void 0);
    /**
     * Whether the index is validated or not
     * This is used to avoid using the tx count before we know it is valid.
     */
    _defineProperty(this, "isValidated", void 0);
    _defineProperty(this, "size", void 0);
    _defineProperty(this, "indexVersion", '0.0.1');
    this.dbpath = _path.default.join(dbpath, 'history');
    const db = new _level.Level(this.dbpath);
    const valueEncoding = (0, _bigint.jsonBigIntEncoding)(_schemas.IHistoryTxSchema);
    this.historyDB = db.sublevel(HISTORY_PREFIX, {
      valueEncoding
    });
    this.tsHistoryDB = db.sublevel(TS_HISTORY_PREFIX, {
      valueEncoding
    });
    this.isValidated = false;
    this.size = 0;
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close() {
    await this.historyDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion() {
    const {
      db
    } = this.historyDB;
    const instanceName = this.constructor.name;
    await (0, _utils.checkLevelDbVersion)(instanceName, db, this.indexVersion);
  }

  /**
   * Validate the index.
   * This method iterates on all transactions and checks that we have a corresponding entry on the timestamp index.
   * If we find a missing entry, we create it.
   * @returns {Promise<HistoryIndexValidateResponse>}
   */
  async validate() {
    await this.checkVersion();
    const ret = {
      count: 0
    };
    // Iterate on all txs and check that we have a corresponding entry on the timestamp index
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(this.historyDB.iterator()), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const [key, value] = _step.value;
        {
          ret.count += 1;
          if (key !== value.tx_id) {
            throw new Error('Inconsistent database');
          }
          try {
            await this.tsHistoryDB.get(`${value.timestamp}:${value.tx_id}`);
          } catch (err) {
            if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
              // Create if index is missing
              await this.tsHistoryDB.put(_ts_key(value), value);
              continue;
            }
            throw err;
          }
        }
      }

      // We have validated the index, we can now trust the tx count
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
    this.size = ret.count;

    // Set the index as validated
    this.isValidated = true;
    return ret;
  }

  /**
   * Get the number of txs in the database.
   *
   * leveldb does not have a count method and the feature request for this was rejected (see https://github.com/google/leveldb/issues/119).
   * As stated in the issue above "There is no way to implement count more efficiently inside leveldb than outside."
   * This means that the best way to count the number of entries would be to iterate on all keys and count them.
   * Another sugestion would be to have an external count of txs, this is done with the this.size variable.
   *
   * The problem with this.size is that it is not updated when we start a database.
   * This is why we update the size when we validate the index and then we can use the pre-calculated size.
   * If the index has not been validated we will run a full count.
   * While a full count runs in O(n) it has been confirmed to be very fast with leveldb.
   * And since the wallet runs the validation when it starts we do not expect to use the full count with a running wallet.
   *
   * @returns {Promise<number>} The number of txs in the database
   */
  async historyCount() {
    if (!this.isValidated) {
      // Since we have not yet validated the index, we cannot trust the tx count
      return this.runHistoryCount();
    }
    return this.size;
  }

  /**
   * Run a full count of the txs in the database.
   *
   * @returns {Promise<number>} The number of txs in the database
   */
  async runHistoryCount() {
    let size = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- No use for the variable: just a counter
    var _iteratorAbruptCompletion2 = false;
    var _didIteratorError2 = false;
    var _iteratorError2;
    try {
      for (var _iterator2 = _asyncIterator(this.historyDB.iterator()), _step2; _iteratorAbruptCompletion2 = !(_step2 = await _iterator2.next()).done; _iteratorAbruptCompletion2 = false) {
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
   * Iterate on the tx history.
   * @param {string|undefined} [tokenUid] Token uid to filter transactions. If undefined, returns all transactions.
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  historyIter(tokenUid) {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion3 = false;
      var _didIteratorError3 = false;
      var _iteratorError3;
      try {
        for (var _iterator3 = _asyncIterator(_this.tsHistoryDB.values({
            reverse: true
          })), _step3; _iteratorAbruptCompletion3 = !(_step3 = yield _awaitAsyncGenerator(_iterator3.next())).done; _iteratorAbruptCompletion3 = false) {
          const info = _step3.value;
          {
            if (tokenUid === undefined) {
              yield info;
              continue;
            }
            let found = false;
            for (const io of [...info.inputs, ...info.outputs]) {
              if (io.token === tokenUid) {
                found = true;
                break;
              }
            }
            if (found) {
              yield info;
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
   * Fetch a transaction from the database.
   * @param txId The transaction id
   * @returns {Promise<IHistoryTx | null>}
   */
  async getTx(txId) {
    try {
      return await this.historyDB.get(txId);
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save a transaction on the database.
   * @param {IHistoryTx} tx The transaction to save
   */
  async saveTx(tx) {
    await this.historyDB.put(tx.tx_id, tx);
    await this.tsHistoryDB.put(_ts_key(tx), tx);
    this.size++;
  }

  /**
   * Clear all database entries.
   * @returns {Promise<void>}
   */
  async clear() {
    await this.historyDB.db.clear();
  }
}
exports.default = LevelHistoryIndex;