"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.REGISTERED_PREFIX = void 0;
var _path = _interopRequireDefault(require("path"));
var _level = require("level");
var _errors = require("./errors");
var _utils = require("./utils");
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
function AsyncFromSyncIterator(r) { function AsyncFromSyncIteratorContinuation(r) { if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object.")); var n = r.done; return Promise.resolve(r.value).then(function (r) { return { value: r, done: n }; }); } return AsyncFromSyncIterator = function (r) { this.s = r, this.n = r.next; }, AsyncFromSyncIterator.prototype = { s: null, n: null, next: function () { return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments)); }, return: function (r) { var n = this.s.return; return void 0 === n ? Promise.resolve({ value: r, done: !0 }) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); }, throw: function (r) { var n = this.s.return; return void 0 === n ? Promise.reject(r) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); } }, new AsyncFromSyncIterator(r); }
const REGISTERED_PREFIX = exports.REGISTERED_PREFIX = 'registered';
class LevelNanoContractIndex {
  constructor(dbpath) {
    _defineProperty(this, "dbpath", void 0);
    /**
     * Registered Nano Contract database
     * Key: ncId
     * Value: INcData (json encoded)
     */
    _defineProperty(this, "registeredDB", void 0);
    _defineProperty(this, "indexVersion", '0.0.1');
    this.dbpath = _path.default.join(dbpath, 'nanocontract');
    const db = new _level.Level(this.dbpath);
    this.registeredDB = db.sublevel(REGISTERED_PREFIX, {
      valueEncoding: 'json'
    });
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close() {
    await this.registeredDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion() {
    const {
      db
    } = this.registeredDB;
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
   * Delete all entries on the database.
   */
  async clear() {
    await this.registeredDB.db.clear();
  }

  /**
   * Return if the nano contract is registered for the given ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId) {
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
  registeredNanoContractsIter() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion = false;
      var _didIteratorError = false;
      var _iteratorError;
      try {
        for (var _iterator = _asyncIterator(_this.registeredDB.values()), _step; _iteratorAbruptCompletion = !(_step = yield _awaitAsyncGenerator(_iterator.next())).done; _iteratorAbruptCompletion = false) {
          const ncData = _step.value;
          {
            yield ncData;
          }
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion && _iterator.return != null) {
            yield _awaitAsyncGenerator(_iterator.return());
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
    })();
  }

  /**
   * Get a nano contract data on database from the ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns Nano contract data instance.
   * @async
   */
  async getNanoContract(ncId) {
    try {
      const ncValue = await this.registeredDB.get(ncId);
      return {
        ...ncValue
      };
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
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
  async registerNanoContract(ncId, ncValue) {
    await this.registeredDB.put(ncId, ncValue);
  }

  /**
   * Unregister nano contract.
   *
   * @param ncId Nano Contract ID.
   * @async
   */
  async unregisterNanoContract(ncId) {
    await this.registeredDB.del(ncId);
  }

  /**
   * Update nano contract registered address.
   *
   * @param ncId Nano Contract ID.
   * @param address Nano Contract registered address.
   * @async
   */
  async updateNanoContractRegisteredAddress(ncId, address) {
    const currentNanoContractData = await this.getNanoContract(ncId);
    if (currentNanoContractData === null) {
      return;
    }
    await this.registeredDB.put(ncId, Object.assign(currentNanoContractData, {
      address
    }));
  }
}
exports.default = LevelNanoContractIndex;