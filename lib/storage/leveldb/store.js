"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _path = _interopRequireDefault(require("path"));
var _address_index = _interopRequireDefault(require("./address_index"));
var _history_index = _interopRequireDefault(require("./history_index"));
var _utxo_index = _interopRequireDefault(require("./utxo_index"));
var _wallet_index = _interopRequireDefault(require("./wallet_index"));
var _token_index = _interopRequireDefault(require("./token_index"));
var _nanocontract_index = _interopRequireDefault(require("./nanocontract_index"));
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
class LevelDBStore {
  constructor(dirpath, dbroot = 'hathor.data') {
    _defineProperty(this, "addressIndex", void 0);
    _defineProperty(this, "historyIndex", void 0);
    _defineProperty(this, "utxoIndex", void 0);
    _defineProperty(this, "walletIndex", void 0);
    _defineProperty(this, "tokenIndex", void 0);
    _defineProperty(this, "nanoContractIndex", void 0);
    _defineProperty(this, "dbpath", void 0);
    const dbpath = _path.default.join(dbroot, dirpath);
    // XXX: We can treat dbpath to avoid special
    // characters that are not acceptable in the filesystem
    this.addressIndex = new _address_index.default(dbpath);
    this.historyIndex = new _history_index.default(dbpath);
    this.utxoIndex = new _utxo_index.default(dbpath);
    this.walletIndex = new _wallet_index.default(dbpath);
    this.tokenIndex = new _token_index.default(dbpath);
    this.nanoContractIndex = new _nanocontract_index.default(dbpath);
    this.dbpath = dbpath;
  }
  async close() {
    await this.addressIndex.close();
    await this.historyIndex.close();
    await this.utxoIndex.close();
    await this.walletIndex.close();
    await this.tokenIndex.close();
    await this.nanoContractIndex.close();
  }
  async destroy() {
    await this.addressIndex.clear();
    await this.historyIndex.clear();
    await this.utxoIndex.clear();
    await this.walletIndex.clear();
    await this.tokenIndex.clear();
    await this.nanoContractIndex.clear();
    await this.close();
  }
  async validate() {
    await this.addressIndex.validate();
    await this.historyIndex.validate();
    await this.utxoIndex.validate();
    await this.tokenIndex.validate();
    await this.walletIndex.validate();
    await this.nanoContractIndex.validate();
  }

  // eslint-disable-next-line class-methods-use-this
  async preProcessHistory() {
    // This is a noop since there are no pre-processing operations to do.
  }
  addressIter() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion = false;
      var _didIteratorError = false;
      var _iteratorError;
      try {
        for (var _iterator = _asyncIterator(_this.addressIndex.addressIter()), _step; _iteratorAbruptCompletion = !(_step = yield _awaitAsyncGenerator(_iterator.next())).done; _iteratorAbruptCompletion = false) {
          const info = _step.value;
          {
            yield info;
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
  async getAddress(base58) {
    return this.addressIndex.getAddressInfo(base58);
  }
  async getAddressMeta(base58) {
    return this.addressIndex.getAddressMeta(base58);
  }
  async addressCount() {
    return this.addressIndex.addressCount();
  }
  async getAddressAtIndex(index) {
    const address = await this.addressIndex.getAddressAtIndex(index);
    if (address === null) {
      return null;
    }
    return this.addressIndex.getAddressInfo(address);
  }
  async setCurrentAddressIndex(index) {
    await this.walletIndex.setCurrentAddressIndex(index);
  }
  async editAddressMeta(base58, meta) {
    await this.addressIndex.setAddressMeta(base58, meta);
  }
  async saveAddress(info) {
    if (!info.base58) {
      throw new Error('Invalid address');
    }
    if (await this.addressIndex.addressExists(info.base58)) {
      throw new Error('Already have this address');
    }
    await this.addressIndex.saveAddress(info);
    if ((await this.walletIndex.getCurrentAddressIndex()) === -1) {
      await this.walletIndex.setCurrentAddressIndex(info.bip32AddressIndex);
    }
    if (info.bip32AddressIndex > (await this.walletIndex.getLastLoadedAddressIndex())) {
      await this.walletIndex.setLastLoadedAddressIndex(info.bip32AddressIndex);
    }
  }
  async addressExists(base58) {
    return this.addressIndex.addressExists(base58);
  }
  async getCurrentAddress(markAsUsed) {
    const addressIndex = await this.walletIndex.getCurrentAddressIndex();
    const addressInfo = await this.getAddressAtIndex(addressIndex);
    if (!addressInfo) {
      throw new Error('Current address is not loaded');
    }
    if (markAsUsed) {
      // Will move the address index only if we have not reached the gap limit
      const lastLoadedIndex = await this.walletIndex.getLastLoadedAddressIndex();
      await this.walletIndex.setCurrentAddressIndex(Math.min(lastLoadedIndex, addressIndex + 1));
    }
    return addressInfo.base58;
  }
  historyIter(tokenUid) {
    var _this2 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion2 = false;
      var _didIteratorError2 = false;
      var _iteratorError2;
      try {
        for (var _iterator2 = _asyncIterator(_this2.historyIndex.historyIter(tokenUid)), _step2; _iteratorAbruptCompletion2 = !(_step2 = yield _awaitAsyncGenerator(_iterator2.next())).done; _iteratorAbruptCompletion2 = false) {
          const tx = _step2.value;
          {
            yield tx;
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
  async historyCount() {
    return this.historyIndex.historyCount();
  }
  async saveTx(tx) {
    await this.historyIndex.saveTx(tx);
    let maxIndex = await this.walletIndex.getLastUsedAddressIndex();
    for (const el of [...tx.inputs, ...tx.outputs]) {
      if (el.decoded.address && (await this.addressExists(el.decoded.address))) {
        const index = (await this.addressIndex.getAddressInfo(el.decoded.address)).bip32AddressIndex;
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    }
    // Address index should always be greater than or equal to 0
    if (maxIndex >= 0) {
      if ((await this.walletIndex.getCurrentAddressIndex()) < maxIndex) {
        await this.walletIndex.setCurrentAddressIndex(Math.min(maxIndex + 1, await this.walletIndex.getLastLoadedAddressIndex()));
      }
      await this.walletIndex.setLastUsedAddressIndex(maxIndex);
    }
  }
  async getTx(txId) {
    return this.historyIndex.getTx(txId);
  }

  // TOKENS
  tokenIter() {
    var _this3 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion3 = false;
      var _didIteratorError3 = false;
      var _iteratorError3;
      try {
        for (var _iterator3 = _asyncIterator(_this3.tokenIndex.tokenIter()), _step3; _iteratorAbruptCompletion3 = !(_step3 = yield _awaitAsyncGenerator(_iterator3.next())).done; _iteratorAbruptCompletion3 = false) {
          const token = _step3.value;
          {
            yield token;
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
  async getToken(tokenUid) {
    return this.tokenIndex.getToken(tokenUid);
  }
  async getTokenMeta(tokenUid) {
    return this.tokenIndex.getTokenMetadata(tokenUid);
  }
  async saveToken(tokenConfig, meta) {
    await this.tokenIndex.saveToken(tokenConfig);
    if (meta !== undefined) {
      await this.tokenIndex.saveMetadata(tokenConfig.uid, meta);
    }
  }
  registeredTokenIter() {
    var _this4 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion4 = false;
      var _didIteratorError4 = false;
      var _iteratorError4;
      try {
        for (var _iterator4 = _asyncIterator(_this4.tokenIndex.registeredTokenIter()), _step4; _iteratorAbruptCompletion4 = !(_step4 = yield _awaitAsyncGenerator(_iterator4.next())).done; _iteratorAbruptCompletion4 = false) {
          const token = _step4.value;
          {
            yield token;
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
  async registerToken(token) {
    await this.tokenIndex.registerToken(token);
  }
  async unregisterToken(tokenUid) {
    await this.tokenIndex.unregisterToken(tokenUid);
  }
  async isTokenRegistered(tokenUid) {
    return this.tokenIndex.isTokenRegistered(tokenUid);
  }
  async editTokenMeta(tokenUid, meta) {
    await this.tokenIndex.editTokenMeta(tokenUid, meta);
  }

  // Utxos

  utxoIter() {
    var _this5 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion5 = false;
      var _didIteratorError5 = false;
      var _iteratorError5;
      try {
        for (var _iterator5 = _asyncIterator(_this5.utxoIndex.utxoIter()), _step5; _iteratorAbruptCompletion5 = !(_step5 = yield _awaitAsyncGenerator(_iterator5.next())).done; _iteratorAbruptCompletion5 = false) {
          const utxo = _step5.value;
          {
            yield utxo;
          }
        }
      } catch (err) {
        _didIteratorError5 = true;
        _iteratorError5 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion5 && _iterator5.return != null) {
            yield _awaitAsyncGenerator(_iterator5.return());
          }
        } finally {
          if (_didIteratorError5) {
            throw _iteratorError5;
          }
        }
      }
    })();
  }
  selectUtxos(options) {
    var _this6 = this;
    return _wrapAsyncGenerator(function* () {
      if (options.max_amount && options.target_amount) {
        throw new Error('invalid options');
      }
      const networkHeight = yield _awaitAsyncGenerator(_this6.getCurrentHeight());
      var _iteratorAbruptCompletion6 = false;
      var _didIteratorError6 = false;
      var _iteratorError6;
      try {
        for (var _iterator6 = _asyncIterator(_this6.utxoIndex.selectUtxos(options, networkHeight)), _step6; _iteratorAbruptCompletion6 = !(_step6 = yield _awaitAsyncGenerator(_iterator6.next())).done; _iteratorAbruptCompletion6 = false) {
          const utxo = _step6.value;
          {
            yield utxo;
          }
        }
      } catch (err) {
        _didIteratorError6 = true;
        _iteratorError6 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion6 && _iterator6.return != null) {
            yield _awaitAsyncGenerator(_iterator6.return());
          }
        } finally {
          if (_didIteratorError6) {
            throw _iteratorError6;
          }
        }
      }
    })();
  }
  async saveUtxo(utxo) {
    return this.utxoIndex.saveUtxo(utxo);
  }

  /**
   * Save a locked utxo to the database.
   * Used when a new utxo is received but it is either time locked or height locked.
   * The locked utxo index will be used to manage the locked utxos.
   *
   * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
   * @returns {Promise<void>}
   */
  async saveLockedUtxo(lockedUtxo) {
    return this.utxoIndex.saveLockedUtxo(lockedUtxo);
  }

  /**
   * Remove an utxo from the locked utxos if it became unlocked.
   *
   * @param lockedUtxo utxo that became unlocked
   * @returns {Promise<void>}
   */
  async unlockUtxo(lockedUtxo) {
    return this.utxoIndex.unlockUtxo(lockedUtxo);
  }

  /**
   * Iterate over all locked utxos
   * @returns {AsyncGenerator<ILockedUtxo>}
   */
  iterateLockedUtxos() {
    var _this7 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion7 = false;
      var _didIteratorError7 = false;
      var _iteratorError7;
      try {
        for (var _iterator7 = _asyncIterator(_this7.utxoIndex.iterateLockedUtxos()), _step7; _iteratorAbruptCompletion7 = !(_step7 = yield _awaitAsyncGenerator(_iterator7.next())).done; _iteratorAbruptCompletion7 = false) {
          const lockedUtxo = _step7.value;
          {
            yield lockedUtxo;
          }
        }
      } catch (err) {
        _didIteratorError7 = true;
        _iteratorError7 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion7 && _iterator7.return != null) {
            yield _awaitAsyncGenerator(_iterator7.return());
          }
        } finally {
          if (_didIteratorError7) {
            throw _iteratorError7;
          }
        }
      }
    })();
  }

  // Wallet

  async saveAccessData(data) {
    await this.walletIndex.saveAccessData(data);
  }
  async getAccessData() {
    return this.walletIndex.getAccessData();
  }
  async getLastLoadedAddressIndex() {
    return this.walletIndex.getLastLoadedAddressIndex();
  }
  async getLastUsedAddressIndex() {
    return this.walletIndex.getLastUsedAddressIndex();
  }
  async setLastUsedAddressIndex(index) {
    await this.walletIndex.setLastUsedAddressIndex(index);
  }
  async setCurrentHeight(height) {
    await this.walletIndex.setCurrentHeight(height);
  }
  async getCurrentHeight() {
    return this.walletIndex.getCurrentHeight();
  }
  async setGapLimit(value) {
    await this.walletIndex.setGapLimit(value);
  }
  async getGapLimit() {
    return this.walletIndex.getGapLimit();
  }
  async getIndexLimit() {
    return this.walletIndex.getIndexLimit();
  }
  async getScanningPolicy() {
    return this.walletIndex.getScanningPolicy();
  }
  async setScanningPolicyData(data) {
    await this.walletIndex.setScanningPolicyData(data);
  }
  async getScanningPolicyData() {
    return this.walletIndex.getScanningPolicyData();
  }
  async getWalletData() {
    return this.walletIndex.getWalletData();
  }
  async getItem(key) {
    return this.walletIndex.getItem(key);
  }
  async setItem(key, value) {
    await this.walletIndex.setItem(key, value);
  }
  async cleanStorage(cleanHistory = false, cleanAddresses = false, cleanTokens = false) {
    // If both are false the method will be a no-op
    await this.tokenIndex.clear(cleanHistory, cleanTokens);
    if (cleanHistory) {
      await this.historyIndex.clear();
      await this.utxoIndex.clear();
    }
    if (cleanAddresses) {
      await this.addressIndex.clear();
      await this.walletIndex.cleanWalletData();
    }
    /* Clean registered nano contracts when cleaning tokens */
    if (cleanTokens) {
      await this.nanoContractIndex.clear();
    }
  }
  async cleanMetadata() {
    await this.tokenIndex.clearMeta();
    await this.addressIndex.clearMeta();
    await this.utxoIndex.clear();
  }

  /**
   * Return if the nano contract is registered for the given address based on ncId.
   *
   * @param ncId Nano Contract Id.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId) {
    return this.nanoContractIndex.isNanoContractRegistered(ncId);
  }

  /**
   * Iterate over all registered nano contracts in the database
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<INcData>}
   */
  registeredNanoContractsIter() {
    var _this8 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion8 = false;
      var _didIteratorError8 = false;
      var _iteratorError8;
      try {
        for (var _iterator8 = _asyncIterator(_this8.nanoContractIndex.registeredNanoContractsIter()), _step8; _iteratorAbruptCompletion8 = !(_step8 = yield _awaitAsyncGenerator(_iterator8.next())).done; _iteratorAbruptCompletion8 = false) {
          const ncData = _step8.value;
          {
            yield ncData;
          }
        }
      } catch (err) {
        _didIteratorError8 = true;
        _iteratorError8 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion8 && _iterator8.return != null) {
            yield _awaitAsyncGenerator(_iterator8.return());
          }
        } finally {
          if (_didIteratorError8) {
            throw _iteratorError8;
          }
        }
      }
    })();
  }

  /**
   * Get a nano contract data on storage from the ncId.
   *
   * @param ncId Nano Contract Id.
   * @returns Nano contract data instance.
   * @async
   */
  async getNanoContract(ncId) {
    return this.nanoContractIndex.getNanoContract(ncId);
  }

  /**
   * Register a nano contract data.
   *
   * @param ncId Nano Contract Id.
   * @param ncValue Nano contract basic information.
   * @async
   */
  async registerNanoContract(ncId, ncValue) {
    return this.nanoContractIndex.registerNanoContract(ncId, ncValue);
  }

  /**
   * Unregister a nano contract.
   *
   * @param ncId Nano Contract ID.
   * @async
   */
  async unregisterNanoContract(ncId) {
    return this.nanoContractIndex.unregisterNanoContract(ncId);
  }

  /**
   * Update nano contract registered address.
   *
   * @param ncId Nano Contract ID.
   * @param address Nano Contract registered address.
   */
  async updateNanoContractRegisteredAddress(ncId, address) {
    return this.nanoContractIndex.updateNanoContractRegisteredAddress(ncId, address);
  }
}
exports.default = LevelDBStore;