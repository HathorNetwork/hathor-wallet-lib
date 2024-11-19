"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.TOKEN_PREFIX = exports.REGISTER_PREFIX = exports.META_PREFIX = void 0;
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
const TOKEN_PREFIX = exports.TOKEN_PREFIX = 'token';
const META_PREFIX = exports.META_PREFIX = 'meta';
const REGISTER_PREFIX = exports.REGISTER_PREFIX = 'registered';
class LevelTokenIndex {
  constructor(dbpath) {
    _defineProperty(this, "dbpath", void 0);
    /**
     * Main token database
     * Key: uid
     * Value: ITokenData (json encoded)
     */
    _defineProperty(this, "tokenDB", void 0);
    /**
     * Token metadata database
     * Key: uid
     * Value: ITokenMetadata (json encoded)
     */
    _defineProperty(this, "metadataDB", void 0);
    /**
     * Registered tokens database
     * Key: uid
     * Value: ITokenData (json encoded)
     */
    _defineProperty(this, "registeredDB", void 0);
    _defineProperty(this, "indexVersion", '0.0.1');
    this.dbpath = _path.default.join(dbpath, 'tokens');
    const db = new _level.Level(this.dbpath);
    this.tokenDB = db.sublevel(TOKEN_PREFIX, {
      valueEncoding: 'json'
    });
    this.metadataDB = db.sublevel(META_PREFIX, {
      valueEncoding: (0, _bigint.jsonBigIntEncoding)(_schemas.ITokenMetadataSchema)
    });
    this.registeredDB = db.sublevel(REGISTER_PREFIX, {
      valueEncoding: 'json'
    });
  }

  /**
   * Close the database and the sublevel children.
   * @returns {Promise<void>}
   */
  async close() {
    await this.tokenDB.db.close();
  }

  /**
   * Check that the index version matches the expected version.
   * @returns {Promise<void>}
   */
  async checkVersion() {
    const {
      db
    } = this.tokenDB;
    const instanceName = this.constructor.name;
    await (0, _utils.checkLevelDbVersion)(instanceName, db, this.indexVersion);
  }
  async validate() {
    await this.checkVersion();
    await this.metadataDB.clear();
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(this.tokenDB.iterator()), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const [key, value] = _step.value;
        {
          if (key !== value.uid) {
            throw new Error('Inconsistent database');
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
   * Iterate over all tokens in the database
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  tokenIter() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion2 = false;
      var _didIteratorError2 = false;
      var _iteratorError2;
      try {
        for (var _iterator2 = _asyncIterator(_this.tokenDB.values()), _step2; _iteratorAbruptCompletion2 = !(_step2 = yield _awaitAsyncGenerator(_iterator2.next())).done; _iteratorAbruptCompletion2 = false) {
          const token = _step2.value;
          {
            const meta = yield _awaitAsyncGenerator(_this.getTokenMetadata(token.uid));
            yield {
              ...token,
              ...meta
            };
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
   * Iterate over all registered tokens in the database
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  registeredTokenIter() {
    var _this2 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion3 = false;
      var _didIteratorError3 = false;
      var _iteratorError3;
      try {
        for (var _iterator3 = _asyncIterator(_this2.registeredDB.values()), _step3; _iteratorAbruptCompletion3 = !(_step3 = yield _awaitAsyncGenerator(_iterator3.next())).done; _iteratorAbruptCompletion3 = false) {
          const token = _step3.value;
          {
            const meta = yield _awaitAsyncGenerator(_this2.getTokenMetadata(token.uid));
            yield {
              ...token,
              ...meta
            };
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
   * Check if a token is on the database
   * @param {string} tokenUid
   * @returns {Promise<boolean>}
   */
  async hasToken(tokenUid) {
    const token = await this.getToken(tokenUid);
    return token !== null;
  }

  /**
   * Get a token from the database.
   * @param {string} uid
   * @returns {Promise<(ITokenData & Partial<ITokenMetadata>)|null>}
   */
  async getToken(uid) {
    let token;
    try {
      token = await this.tokenDB.get(uid);
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
    const meta = await this.getTokenMetadata(uid);
    const DEFAULT_TOKEN_META = {
      numTransactions: 0,
      balance: {
        tokens: {
          unlocked: 0n,
          locked: 0n
        },
        authorities: {
          mint: {
            unlocked: 0n,
            locked: 0n
          },
          melt: {
            unlocked: 0n,
            locked: 0n
          }
        }
      }
    };
    return {
      ...token,
      ...DEFAULT_TOKEN_META,
      ...meta
    };
  }

  /**
   * Get a token metadata from the database.
   * @param {string} uid
   * @returns {Promise<ITokenMetadata|null>}
   */
  async getTokenMetadata(uid) {
    try {
      return await this.metadataDB.get(uid);
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save a token to the database.
   * @param {ITokenData} token Token to be saved
   * @returns {Promise<void>}
   */
  async saveToken(token) {
    await this.tokenDB.put(token.uid, token);
  }

  /**
   * Save a token metadata to the database.
   * @param {string} uid token uid
   * @param {ITokenMetadata} meta Token metadata to be saved
   * @returns {Promise<void>}
   */
  async saveMetadata(uid, meta) {
    await this.metadataDB.put(uid, meta);
  }

  /**
   * Add a token to the registered list.
   * @param {ITokenData} token Token to register
   * @returns {Promise<void>}
   */
  async registerToken(token) {
    await this.registeredDB.put(token.uid, token);
  }

  /**
   * Remove a token from the registered list.
   * @param {string} tokenUid Token uid to unregister
   * @returns {Promise<void>}
   */
  async unregisterToken(tokenUid) {
    await this.registeredDB.del(tokenUid);
  }

  /**
   * Return if a token is registered.
   * @param tokenUid - Token id
   * @returns {Promise<boolean>}
   */
  async isTokenRegistered(tokenUid) {
    try {
      await this.registeredDB.get(tokenUid);
      return true;
    } catch (err) {
      if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
        // Did not find the token among the registered tokens
        return false;
      }
      throw err;
    }
  }

  /**
   * Delete a token from the database.
   * @param {string[]} tokens List of token uids to be deleted
   */
  async deleteTokens(tokens) {
    for (const uid of tokens) {
      await this.tokenDB.del(uid);
      await this.metadataDB.del(uid);
    }
  }

  /**
   * Edit token metadata
   * @param {string} tokenUid token uid
   * @param {Partial<ITokenMetadata>} meta metadata to add
   * @returns {Promise<void>}
   */
  async editTokenMeta(tokenUid, meta) {
    await this.metadataDB.put(tokenUid, meta);
  }

  /**
   * Clear metadata index.
   * @returns {Promise<void>}
   */
  async clearMeta() {
    await this.metadataDB.clear();
  }

  /**
   * Clear all entries from the database.
   * @param {boolean} [cleanIndex=true] Delete all token and meta keys.
   * @param {boolean} [cleanRegisteredTokens=false] Delete all registered token keys.
   * @returns {Promise<void>}
   */
  async clear(cleanIndex = true, cleanRegisteredTokens = false) {
    if (cleanIndex && cleanRegisteredTokens) {
      await this.tokenDB.db.clear();
      return;
    }
    if (cleanIndex) {
      await this.tokenDB.clear();
      await this.metadataDB.clear();
    }
    if (cleanRegisteredTokens) {
      await this.registeredDB.clear();
    }
  }
}
exports.default = LevelTokenIndex;