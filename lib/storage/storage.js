"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Storage = void 0;
var _bitcoreLib = require("bitcore-lib");
var _types = require("../types");
var _transaction = _interopRequireDefault(require("../utils/transaction"));
var _storage = require("../utils/storage");
var _config = _interopRequireDefault(require("../config"));
var _crypto = require("../utils/crypto");
var _address = require("../utils/address");
var _wallet = _interopRequireDefault(require("../utils/wallet"));
var _constants = require("../constants");
var _errors = require("../errors");
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
const DEFAULT_ADDRESS_META = {
  numTransactions: 0,
  balance: new Map()
};
class Storage {
  constructor(store) {
    _defineProperty(this, "store", void 0);
    _defineProperty(this, "utxosSelectedAsInput", void 0);
    _defineProperty(this, "config", void 0);
    _defineProperty(this, "version", void 0);
    _defineProperty(this, "txSignFunc", void 0);
    /**
     * This promise is used to chain the calls to process unlocked utxos.
     * This way we can avoid concurrent calls.
     * The best way to do this would be an async queue or a mutex, but to avoid adding
     * more dependencies we are using this simpler method.
     *
     * We can change this implementation to use a mutex or async queue in the future.
     */
    _defineProperty(this, "utxoUnlockWait", void 0);
    _defineProperty(this, "logger", void 0);
    this.store = store;
    this.utxosSelectedAsInput = new Map();
    this.config = _config.default;
    this.version = null;
    this.utxoUnlockWait = Promise.resolve();
    this.txSignFunc = null;
    this.logger = (0, _types.getDefaultLogger)();
  }

  /**
   * Set the fullnode api version data.
   * @param {ApiVersion} version Fullnode api version data
   */
  setApiVersion(version) {
    this.version = version;
  }

  /**
   * Get the decimal places.
   * If not configured, will return the default DECIMAL_PLACES (2)
   * @returns {number}
   */
  getDecimalPlaces() {
    return this.version?.decimal_places ?? _constants.DECIMAL_PLACES;
  }

  /**
   * Set the native token config on the store
   */
  async saveNativeToken() {
    if ((await this.store.getToken(_constants.NATIVE_TOKEN_UID)) === null) {
      await this.store.saveToken(this.getNativeTokenData());
    }
  }

  /**
   * Gets the native token config
   *
   * @return {ITokenData} The native token config
   */
  getNativeTokenData() {
    const nativeToken = this.version?.native_token ?? _constants.DEFAULT_NATIVE_TOKEN_CONFIG;
    return {
      ...nativeToken,
      uid: _constants.NATIVE_TOKEN_UID
    };
  }

  /**
   * Set the logger instance to use.
   */
  setLogger(logger) {
    this.logger = logger;
  }

  /**
   * Check if the tx signing method is set
   * @returns {boolean}
   */
  hasTxSignatureMethod() {
    return !!this.txSignFunc;
  }

  /**
   * Set the tx signing function
   * @param {EcdsaTxSign} txSign The signing function
   */
  setTxSignatureMethod(txSign) {
    this.txSignFunc = txSign;
  }

  /**
   * Sign the transaction
   * @param {Transaction} tx The transaction to sign
   * @param {string} pinCode The pin code
   * @returns {Promise<ITxSignatureData>} The signatures
   */
  async getTxSignatures(tx, pinCode) {
    if (this.txSignFunc) {
      return this.txSignFunc(tx, this, pinCode);
    }
    return _transaction.default.getSignatureForTx(tx, this, pinCode);
  }

  /**
   * Return the deposit percentage for creating tokens.
   * @returns {number}
   */
  getTokenDepositPercentage() {
    /**
     *  When using wallet-service facade we do not update the version constants
     *  Since this data is important for the wallets UI we will return the default value here.
     */
    return this.version?.token_deposit_percentage ?? _constants.TOKEN_DEPOSIT_PERCENTAGE;
  }

  /**
   * Fetch all addresses from storage
   *
   * @async
   * @generator
   * @yields {Promise<IAddressInfo & Partial<IAddressMetadata>>} The addresses in store.
   */
  getAllAddresses() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion = false;
      var _didIteratorError = false;
      var _iteratorError;
      try {
        for (var _iterator = _asyncIterator(_this.store.addressIter()), _step; _iteratorAbruptCompletion = !(_step = yield _awaitAsyncGenerator(_iterator.next())).done; _iteratorAbruptCompletion = false) {
          const address = _step.value;
          {
            const meta = yield _awaitAsyncGenerator(_this.store.getAddressMeta(address.base58));
            yield {
              ...address,
              ...DEFAULT_ADDRESS_META,
              ...meta
            };
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
   * Get the address info from store
   *
   * @param {string} base58 The base58 address to fetch
   * @async
   * @returns {Promise<(IAddressInfo & Partial<IAddressMetadata>)|null>} The address info or null if not found
   */
  async getAddressInfo(base58) {
    const address = await this.store.getAddress(base58);
    if (address === null) {
      return null;
    }
    const meta = await this.store.getAddressMeta(base58);
    return {
      ...address,
      ...DEFAULT_ADDRESS_META,
      ...meta
    };
  }

  /**
   * Get the address at the given index
   *
   * @param {number} index
   * @async
   * @returns {Promise<IAddressInfo|null>} The address info or null if not found
   */
  async getAddressAtIndex(index) {
    return this.store.getAddressAtIndex(index);
  }

  /**
   * Get the address public key, if not available derive from xpub
   * @param {number} index
   * @async
   * @returns {Promise<string>} The public key DER encoded in hex
   */
  async getAddressPubkey(index) {
    const addressInfo = await this.store.getAddressAtIndex(index);
    if (addressInfo?.publicKey) {
      // public key already cached on address info
      return addressInfo.publicKey;
    }

    // derive public key from xpub
    const accessData = await this._getValidAccessData();
    const hdpubkey = new _bitcoreLib.HDPublicKey(accessData.xpubkey);
    const key = hdpubkey.deriveChild(index);
    return key.publicKey.toString('hex');
  }

  /**
   * Check if the address is from our wallet.
   * @param {string} base58 The address encoded as base58
   * @returns {Promise<boolean>} If the address is known by the storage
   */
  async isAddressMine(base58) {
    return this.store.addressExists(base58);
  }

  /**
   * Save address info on storage
   * @param {IAddressInfo} info Address info to save on storage
   * @returns {Promise<void>}
   */
  async saveAddress(info) {
    await this.store.saveAddress(info);
  }

  /**
   * Get the current address.
   *
   * @param {boolean|undefined} markAsUsed If we should set the next address as current
   * @returns {Promise<string>} The address in base58 encoding
   */
  async getCurrentAddress(markAsUsed) {
    return this.store.getCurrentAddress(markAsUsed);
  }

  /**
   * Get a change address to use, if one is provided we need to check if we own it
   * If not provided, the current address will be used instead.
   *
   * @param {Object} [options={}]
   * @param {string|null|undefined} [options.changeAddress=undefined] User provided change address to use
   * @returns {Promise<string>} The change address to use
   */
  async getChangeAddress({
    changeAddress
  } = {}) {
    if (changeAddress) {
      if (!(await this.isAddressMine(changeAddress))) {
        throw new Error('Change address is not from the wallet');
      }
      return changeAddress;
    }
    return this.getCurrentAddress();
  }

  /**
   * Iterate on the history of transactions.
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  txHistory() {
    var _this2 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion2 = false;
      var _didIteratorError2 = false;
      var _iteratorError2;
      try {
        for (var _iterator2 = _asyncIterator(_this2.store.historyIter()), _step2; _iteratorAbruptCompletion2 = !(_step2 = yield _awaitAsyncGenerator(_iterator2.next())).done; _iteratorAbruptCompletion2 = false) {
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

  /**
   * Iterate on the history of transactions that include the given token.
   *
   * @param {string|undefined} [tokenUid='00'] Token to fetch, defaults to HTR
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  tokenHistory(tokenUid) {
    var _this3 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion3 = false;
      var _didIteratorError3 = false;
      var _iteratorError3;
      try {
        for (var _iterator3 = _asyncIterator(_this3.store.historyIter(tokenUid || _constants.NATIVE_TOKEN_UID)), _step3; _iteratorAbruptCompletion3 = !(_step3 = yield _awaitAsyncGenerator(_iterator3.next())).done; _iteratorAbruptCompletion3 = false) {
          const tx = _step3.value;
          {
            yield tx;
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
   * Fetch a transaction on the storage by it's id.
   *
   * @param {string} txId The transaction id to fetch
   * @returns {Promise<IHistoryTx | null>} The transaction or null if not on storage
   */
  async getTx(txId) {
    return this.store.getTx(txId);
  }

  /**
   * Get the transactions being spent by the given inputs if they belong in our wallet.
   *
   * @param {Input[]} inputs A list of inputs
   * @returns {AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}>}
   */
  getSpentTxs(inputs) {
    var _this4 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion4 = false;
      var _didIteratorError4 = false;
      var _iteratorError4;
      try {
        for (var _iterator4 = _asyncIterator(inputs.entries()), _step4; _iteratorAbruptCompletion4 = !(_step4 = yield _awaitAsyncGenerator(_iterator4.next())).done; _iteratorAbruptCompletion4 = false) {
          const [index, input] = _step4.value;
          {
            const tx = yield _awaitAsyncGenerator(_this4.getTx(input.hash));
            // Ignore unknown transactions
            if (tx === null) continue;
            yield {
              tx,
              input,
              index
            };
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
   * Add a transaction on storage.
   *
   * @param {IHistoryTx} tx The transaction
   * @returns {Promise<void>}
   */
  async addTx(tx) {
    await this.store.saveTx(tx);
  }

  /**
   * Process the transaction history to calculate the metadata.
   * @returns {Promise<void>}
   */
  async processHistory() {
    await this.store.preProcessHistory();
    await (0, _storage.processHistory)(this, {
      rewardLock: this.version?.reward_spend_min_blocks
    });
  }

  /**
   * Iterate on all tokens on the storage.
   *
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  getAllTokens() {
    var _this5 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion5 = false;
      var _didIteratorError5 = false;
      var _iteratorError5;
      try {
        for (var _iterator5 = _asyncIterator(_this5.store.tokenIter()), _step5; _iteratorAbruptCompletion5 = !(_step5 = yield _awaitAsyncGenerator(_iterator5.next())).done; _iteratorAbruptCompletion5 = false) {
          const token = _step5.value;
          {
            yield token;
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

  /**
   * Iterate on all registered tokens of the wallet.
   *
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  getRegisteredTokens() {
    var _this6 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion6 = false;
      var _didIteratorError6 = false;
      var _iteratorError6;
      try {
        for (var _iterator6 = _asyncIterator(_this6.store.registeredTokenIter()), _step6; _iteratorAbruptCompletion6 = !(_step6 = yield _awaitAsyncGenerator(_iterator6.next())).done; _iteratorAbruptCompletion6 = false) {
          const token = _step6.value;
          {
            yield token;
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

  /**
   * Get a token from storage along with the metadata of the wallet transactions.
   *
   * @param {string} token Token uid to fetch
   * @returns {Promise<(ITokenData & Partial<ITokenMetadata>)|null>}
   */
  async getToken(token) {
    return this.store.getToken(token);
  }

  /**
   * Regsiter a token.
   * @param {ITokenData} token Token data to register
   * @returns {Promise<void>}
   */
  async registerToken(token) {
    await this.store.registerToken(token);
  }

  /**
   * Unregister a token from the wallet.
   * @param {Promise<void>} tokenUid Token uid to unregister.
   * @returns {Promise<void>}
   */
  async unregisterToken(tokenUid) {
    await this.store.unregisterToken(tokenUid);
  }

  /**
   * Return if a token is registered.
   * @param tokenUid - Token id.
   * @returns {Promise<boolean>}
   */
  async isTokenRegistered(tokenUid) {
    return this.store.isTokenRegistered(tokenUid);
  }

  /**
   * Process the locked utxos to unlock them if the lock has expired.
   * Will process both timelocked and heightlocked utxos.
   *
   * We will wait for any previous execution to finish before starting the next one.
   *
   * @param {number} height The network height to use as reference to unlock utxos
   * @returns {Promise<void>}
   */
  async unlockUtxos(height) {
    // Will wait for the previous execution to finish before starting the next one
    // This is to prevent multiple calls to this method to run in parallel and "double unlock" utxos
    this.utxoUnlockWait = this.utxoUnlockWait.then(() => this.processLockedUtxos(height));
  }

  /**
   * Iterate on all utxos of the wallet.
   * @returns {AsyncGenerator<IUtxo, any, unknown>}
   */
  getAllUtxos() {
    var _this7 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion7 = false;
      var _didIteratorError7 = false;
      var _iteratorError7;
      try {
        for (var _iterator7 = _asyncIterator(_this7.store.utxoIter()), _step7; _iteratorAbruptCompletion7 = !(_step7 = yield _awaitAsyncGenerator(_iterator7.next())).done; _iteratorAbruptCompletion7 = false) {
          const utxo = _step7.value;
          {
            yield utxo;
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

  /**
   * Select utxos matching the request and do not select any utxos marked for inputs.
   *
   * @param {Omit<IUtxoFilterOptions, 'reward_lock'>} [options={}] Options to filter utxos and stop when the target is found.
   * @returns {AsyncGenerator<IUtxo, any, unknown>}
   */
  selectUtxos(options = {}) {
    var _this8 = this;
    return _wrapAsyncGenerator(function* () {
      const filterSelected = utxo => {
        const utxoId = `${utxo.txId}:${utxo.index}`;
        return !_this8.utxosSelectedAsInput.has(utxoId);
      };
      const newFilter = utxo => {
        const optionsFilter = options.filter_method ? options.filter_method(utxo) : true;
        const selectedFilter = filterSelected(utxo);
        if (options.only_available_utxos) {
          // We need to check if the utxo is selected as an input since we only want available utxos.
          return selectedFilter && optionsFilter;
        }
        // Only check the filter method if we don't care about available utxos.
        return optionsFilter;
      };
      const newOptions = {
        ...options,
        filter_method: newFilter
      };
      if (_this8.version?.reward_spend_min_blocks) {
        newOptions.reward_lock = _this8.version.reward_spend_min_blocks;
      }
      var _iteratorAbruptCompletion8 = false;
      var _didIteratorError8 = false;
      var _iteratorError8;
      try {
        for (var _iterator8 = _asyncIterator(_this8.store.selectUtxos(newOptions)), _step8; _iteratorAbruptCompletion8 = !(_step8 = yield _awaitAsyncGenerator(_iterator8.next())).done; _iteratorAbruptCompletion8 = false) {
          const utxo = _step8.value;
          {
            yield utxo;
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
   * Match the selected balance for the given authority and token.
   *
   * @param {OutputValueType} singleBalance The balance we want to match
   * @param {string} token The token uid
   * @param {OutputValueType} authorities The authorities we want to match
   * @param {string} changeAddress change address to use
   * @param {boolean} chooseInputs If we can add new inputs to the transaction
   * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs that match the balance
   * @internal
   */
  async matchBalanceSelection(singleBalance, token, authorities, changeAddress, chooseInputs) {
    const newInputs = [];
    const newOutputs = [];
    const options = {
      authorities,
      token,
      only_available_utxos: true
    };
    const isAuthority = authorities > 0;
    if (isAuthority) {
      options.max_utxos = Number(singleBalance);
    } else {
      options.target_amount = singleBalance;
    }
    if (singleBalance > 0) {
      if (!chooseInputs) {
        // We cannot choose inputs, so we fail
        throw new Error(`Insufficient funds in the given inputs for ${token}, missing ${singleBalance} more tokens.`);
      }
      // We have a surplus of this token on the outputs, so we need to find utxos to match
      let foundAmount = 0n;
      var _iteratorAbruptCompletion9 = false;
      var _didIteratorError9 = false;
      var _iteratorError9;
      try {
        for (var _iterator9 = _asyncIterator(this.selectUtxos(options)), _step9; _iteratorAbruptCompletion9 = !(_step9 = await _iterator9.next()).done; _iteratorAbruptCompletion9 = false) {
          const utxo = _step9.value;
          {
            if (isAuthority) {
              foundAmount += 1n;
            } else {
              foundAmount += utxo.value;
            }
            newInputs.push({
              txId: utxo.txId,
              index: utxo.index,
              token: utxo.token,
              address: utxo.address,
              value: utxo.value,
              authorities: utxo.authorities
            });
          }
        }
      } catch (err) {
        _didIteratorError9 = true;
        _iteratorError9 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion9 && _iterator9.return != null) {
            await _iterator9.return();
          }
        } finally {
          if (_didIteratorError9) {
            throw _iteratorError9;
          }
        }
      }
      if (foundAmount < singleBalance) {
        // XXX: Insufficient funds
        throw new Error(`Insufficient funds, found ${foundAmount} but requested ${singleBalance}`);
      } else if (foundAmount > singleBalance) {
        if (isAuthority) {
          // Since we use max_utxos for authorities we should stop before we select more utxos than
          // required, so there should be no need to add an authority change
          throw new Error('This should never happen, authorities should be exact');
        } else {
          // Add change output
          newOutputs.push({
            type: (0, _address.getAddressType)(changeAddress, this.config.getNetwork()),
            token,
            authorities: 0n,
            value: foundAmount - singleBalance,
            address: changeAddress,
            timelock: null
          });
        }
      }
    } else if (singleBalance < 0) {
      // We have a surplus of this token on the inputs, so we need to add a change output
      if (isAuthority) {
        for (let i = 0; i < -singleBalance; i++) {
          newOutputs.push({
            type: (0, _address.getAddressType)(changeAddress, this.config.getNetwork()),
            token,
            authorities,
            value: authorities,
            address: changeAddress,
            timelock: null
          });
        }
      } else {
        newOutputs.push({
          type: (0, _address.getAddressType)(changeAddress, this.config.getNetwork()),
          token,
          authorities: 0n,
          value: -singleBalance,
          address: changeAddress,
          timelock: null
        });
      }
    }
    return {
      inputs: newInputs,
      outputs: newOutputs
    };
  }

  /**
   * Generate inputs and outputs so that the transaction balance is filled.
   *
   * @param {string} token Token uid
   * @param {Record<'funds'|'mint'|'melt', number>} balance Balance of funds and authorities for a token on the transaction
   * @param {IFillTxOptions} [options={}]
   * @param {string} options.changeAddress Address to send change to
   * @param {boolean} [options.skipAuthorities=false] If we should fill authorities or only funds
   * @param {boolean} [options.chooseInputs=true] If we can choose inputs when needed or not
   * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs to fill the transaction
   * @internal
   */
  async matchTokenBalance(token, balance, {
    changeAddress,
    skipAuthorities = true,
    chooseInputs = true
  } = {}) {
    const addressForChange = changeAddress || (await this.getCurrentAddress());
    // balance holds the balance of all tokens on the transaction
    const newInputs = [];
    const newOutputs = [];
    // match funds
    const {
      inputs: fundsInputs,
      outputs: fundsOutputs
    } = await this.matchBalanceSelection(balance.funds, token, 0n, addressForChange, chooseInputs);
    newInputs.push(...fundsInputs);
    newOutputs.push(...fundsOutputs);
    if (!(skipAuthorities || token === _constants.NATIVE_TOKEN_UID)) {
      // Match authority balance (only possible for custom tokens)
      // match mint
      const {
        inputs: mintInputs,
        outputs: mintOutputs
      } = await this.matchBalanceSelection(balance.mint, token, 1n, addressForChange, chooseInputs);
      // match melt
      const {
        inputs: meltInputs,
        outputs: meltOutputs
      } = await this.matchBalanceSelection(balance.melt, token, 2n, addressForChange, chooseInputs);
      newInputs.push(...mintInputs, ...meltInputs);
      newOutputs.push(...mintOutputs, ...meltOutputs);
    }
    return {
      inputs: newInputs,
      outputs: newOutputs
    };
  }

  /**
   * Check the balance of the transaction and add inputs and outputs to match the funds and authorities.
   * It will fail if we do not have enough funds or authorities and it will fail if we try to add too many inputs or outputs.
   *
   * @param tx The incomplete transaction we need to fill
   * @param {IFillTxOptions} [options={}] options to use a change address.
   *
   * @async
   * @returns {Promise<void>}
   */
  async fillTx(token, tx, options = {}) {
    const tokenBalance = await _transaction.default.calculateTxBalanceToFillTx(token, tx);
    const {
      inputs: newInputs,
      outputs: newOutputs
    } = await this.matchTokenBalance(token, tokenBalance, options);

    // Validate if we will add too many inputs/outputs
    const max_inputs = this.version?.max_number_inputs || _constants.MAX_INPUTS;
    const max_outputs = this.version?.max_number_outputs || _constants.MAX_OUTPUTS;
    if (tx.inputs.length + newInputs.length > max_inputs || tx.outputs.length + newOutputs.length > max_outputs) {
      // we have more inputs/outputs than what can be sent on the transaction
      throw new Error('When over the maximum amount of inputs/outputs');
    }
    return {
      inputs: newInputs,
      outputs: newOutputs
    };
  }

  /**
   * Mark an utxo as selected as input
   *
   * @param {IUtxoId} utxo The Data to identify the utxo
   * @param {boolean} markAs Mark the utxo as this value
   * @param {number|undefined} ttl Unmark the utxo after this amount os ms passed
   *
   * @async
   * @returns {Promise<void>}
   */
  async utxoSelectAsInput(utxo, markAs, ttl) {
    const tx = await this.getTx(utxo.txId);
    if (!tx || !tx.outputs[utxo.index]) {
      return;
    }
    if (markAs && tx.outputs[utxo.index].spent_by !== null) {
      // Already spent, no need to mark as selected_as_input
      return;
    }
    const utxoId = `${utxo.txId}:${utxo.index}`;
    if (markAs) {
      this.utxosSelectedAsInput.set(utxoId, markAs);
      // if a ttl is given, we should reverse
      if (ttl) {
        setTimeout(() => {
          if (this.utxosSelectedAsInput.has(utxoId)) {
            this.utxosSelectedAsInput.delete(utxoId);
          }
        }, ttl);
      }
    } else {
      this.utxosSelectedAsInput.delete(utxoId);
    }
  }

  /**
   * Iterate over all locked utxos and unlock them if needed
   * When a utxo is unlocked, the balances and metadatas are updated
   * and the utxo is removed from the locked utxos.
   *
   * @param {number} height The new height of the best chain
   */
  async processLockedUtxos(height) {
    const nowTs = Math.floor(Date.now() / 1000);
    var _iteratorAbruptCompletion10 = false;
    var _didIteratorError10 = false;
    var _iteratorError10;
    try {
      for (var _iterator10 = _asyncIterator(this.store.iterateLockedUtxos()), _step10; _iteratorAbruptCompletion10 = !(_step10 = await _iterator10.next()).done; _iteratorAbruptCompletion10 = false) {
        const lockedUtxo = _step10.value;
        {
          await (0, _storage.processUtxoUnlock)(this, lockedUtxo, {
            nowTs,
            rewardLock: this.version?.reward_spend_min_blocks || 0,
            currentHeight: height
          });
        }
      }
    } catch (err) {
      _didIteratorError10 = true;
      _iteratorError10 = err;
    } finally {
      try {
        if (_iteratorAbruptCompletion10 && _iterator10.return != null) {
          await _iterator10.return();
        }
      } finally {
        if (_didIteratorError10) {
          throw _iteratorError10;
        }
      }
    }
  }

  /**
   * Check if an utxo is selected as input.
   *
   * @param {IUtxoId} utxo The utxo we want to check if it is selected as input
   * @returns {Promise<boolean>}
   * @example
   * const isSelected = await isUtxoSelectedAsInput({ txId: 'tx1', index: 0 });
   */
  async isUtxoSelectedAsInput(utxo) {
    const utxoId = `${utxo.txId}:${utxo.index}`;
    return this.utxosSelectedAsInput.has(utxoId);
  }

  /**
   * Iterate on all locked utxos.
   * Used to check if the utxos are still locked.
   *
   * @returns {AsyncGenerator<IUtxoId>}
   */
  utxoSelectedAsInputIter() {
    var _this9 = this;
    return _wrapAsyncGenerator(function* () {
      for (const [utxoStr, isSelected] of _this9.utxosSelectedAsInput.entries()) {
        if (isSelected) {
          const [txId, index] = utxoStr.split(':');
          yield {
            txId,
            index: parseInt(index, 10)
          };
        }
      }
    })();
  }

  /**
   * Helper to check if the access data exists before returning it.
   * Having the accessData as null means the wallet is not initialized so we should throw an error.
   *
   * @returns {Promise<IWalletAccessData>} The access data.
   * @internal
   */
  async _getValidAccessData() {
    const accessData = await this.getAccessData();
    if (!accessData) {
      throw new _errors.UninitializedWalletError();
    }
    return accessData;
  }

  /**
   * Get the wallet's access data if the wallet is initialized.
   *
   * @returns {Promise<IWalletAccessData | null>}
   */
  async getAccessData() {
    return this.store.getAccessData();
  }

  /**
   * Save the access data, initializing the wallet.
   *
   * @param {IWalletAccessData} data The wallet access data
   * @returns {Promise<void>}
   */
  async saveAccessData(data) {
    return this.store.saveAccessData(data);
  }

  /**
   * Get the wallet's metadata.
   *
   * @returns {Promise<IWalletData>}
   */
  async getWalletData() {
    return this.store.getWalletData();
  }

  /**
   * Get the wallet type, i.e. P2PKH or MultiSig.
   *
   * @returns {Promise<WalletType>}
   */
  async getWalletType() {
    const accessData = await this._getValidAccessData();
    return accessData.walletType;
  }

  /**
   * Set the current height
   * @param {number} height The current height
   * @returns {Promise<void>} The current height of the network
   */
  async setCurrentHeight(height) {
    await this.store.setCurrentHeight(height);
  }

  /**
   * Get the current height
   * @returns {Promise<number>} The current height
   */
  async getCurrentHeight() {
    return this.store.getCurrentHeight();
  }

  /**
   * Return wheather the wallet is readonly, i.e. was started without the private key.
   * @returns {Promise<boolean>}
   */
  async isReadonly() {
    const accessData = await this._getValidAccessData();
    return (accessData.walletFlags & _types.WALLET_FLAGS.READONLY) > 0;
  }

  /**
   * Decrypt and return the main private key of the wallet.
   *
   * @param {string} pinCode Pin to unlock the private key
   * @returns {Promise<string>} The HDPrivateKey in string format.
   */
  async getMainXPrivKey(pinCode) {
    const accessData = await this._getValidAccessData();
    if (accessData.mainKey === undefined) {
      throw new Error('Private key is not present on this wallet.');
    }

    // decryptData handles pin validation
    return (0, _crypto.decryptData)(accessData.mainKey, pinCode);
  }

  /**
   * Get account path xprivkey if available.
   *
   * @param {string} pinCode
   * @returns {Promise<string>}
   */
  async getAcctPathXPrivKey(pinCode) {
    const accessData = await this._getValidAccessData();
    if (!accessData.acctPathKey) {
      throw new Error('Private key is not present on this wallet.');
    }

    // decryptData handles pin validation
    return (0, _crypto.decryptData)(accessData.acctPathKey, pinCode);
  }

  /**
   * Decrypt and return the auth private key of the wallet.
   *
   * @param {string} pinCode Pin to unlock the private key
   * @returns {Promise<string>} The Auth HDPrivateKey in string format.
   */
  async getAuthPrivKey(pinCode) {
    const accessData = await this._getValidAccessData();
    if (accessData.authKey === undefined) {
      throw new Error('Private key is not present on this wallet.');
    }

    // decryptData handles pin validation
    return (0, _crypto.decryptData)(accessData.authKey, pinCode);
  }

  /**
   * Handle storage operations for a wallet being stopped.
   * @param {{
   *   connection?: FullNodeConnection;
   *   cleanStorage?: boolean;
   *   cleanAddresses?: boolean;
   *   cleanTokens?: boolean;
   * }} Options to handle stop
   * @returns {Promise<void>}
   */
  async handleStop({
    connection,
    cleanStorage = false,
    cleanAddresses = false,
    cleanTokens = false
  } = {}) {
    if (connection) {
      var _iteratorAbruptCompletion11 = false;
      var _didIteratorError11 = false;
      var _iteratorError11;
      try {
        for (var _iterator11 = _asyncIterator(this.getAllAddresses()), _step11; _iteratorAbruptCompletion11 = !(_step11 = await _iterator11.next()).done; _iteratorAbruptCompletion11 = false) {
          const addressInfo = _step11.value;
          {
            connection.unsubscribeAddress(addressInfo.base58);
          }
        }
      } catch (err) {
        _didIteratorError11 = true;
        _iteratorError11 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion11 && _iterator11.return != null) {
            await _iterator11.return();
          }
        } finally {
          if (_didIteratorError11) {
            throw _iteratorError11;
          }
        }
      }
      connection.removeMetricsHandlers();
    }
    this.version = null;
    if (cleanStorage || cleanAddresses || cleanTokens) {
      await this.cleanStorage(cleanStorage, cleanAddresses, cleanTokens);
    }
  }

  /**
   * Clean the storage data.
   *
   * @param {boolean} [cleanHistory=false] If we should clean the history data
   * @param {boolean} [cleanAddresses=false] If we should clean the address data
   * @param {boolean} [cleanTokens=false] If we should clean the registered tokens
   * @returns {Promise<void>}
   */
  async cleanStorage(cleanHistory = false, cleanAddresses = false, cleanTokens = false) {
    return this.store.cleanStorage(cleanHistory, cleanAddresses, cleanTokens);
  }

  /**
   * Check if the pin is correct
   *
   * @param {string} pinCode - Pin to check
   * @returns {Promise<boolean>}
   * @throws {Error} if the wallet is not initialized
   * @throws {Error} if the wallet does not have the private key
   */
  async checkPin(pinCode) {
    const accessData = await this._getValidAccessData();
    if (!accessData.mainKey) {
      throw new Error('Cannot check pin without the private key.');
    }
    return (0, _crypto.checkPassword)(accessData.mainKey, pinCode);
  }

  /**
   * Check if the password is correct
   *
   * @param {string} password - Password to check
   * @returns {Promise<boolean>}
   * @throws {Error} if the wallet is not initialized
   * @throws {Error} if the wallet does not have the private key
   */
  async checkPassword(password) {
    const accessData = await this._getValidAccessData();
    if (!accessData.words) {
      throw new Error('Cannot check password without the words.');
    }
    return (0, _crypto.checkPassword)(accessData.words, password);
  }

  /**
   * Change the wallet pin.
   * @param {string} oldPin Old pin to unlock data.
   * @param {string} newPin New pin to lock data.
   * @returns {Promise<void>}
   */
  async changePin(oldPin, newPin) {
    const accessData = await this._getValidAccessData();
    const newAccessData = _wallet.default.changeEncryptionPin(accessData, oldPin, newPin);

    // Save the changes made
    await this.saveAccessData(newAccessData);
  }

  /**
   * Change the wallet password.
   *
   * @param {string} oldPassword Old password
   * @param {string} newPassword New password
   * @returns {Promise<void>}
   */
  async changePassword(oldPassword, newPassword) {
    const accessData = await this._getValidAccessData();
    const newAccessData = _wallet.default.changeEncryptionPassword(accessData, oldPassword, newPassword);

    // Save the changes made
    await this.saveAccessData(newAccessData);
  }

  /**
   * Set the wallet gap limit.
   * @param {number} value New gap limit to use.
   * @returns {Promise<void>}
   */
  async setGapLimit(value) {
    return this.store.setGapLimit(value);
  }

  /**
   * Get the wallet gap limit.
   * @returns {Promise<number>}
   */
  async getGapLimit() {
    if ((await this.getScanningPolicy()) !== _types.SCANNING_POLICY.GAP_LIMIT) {
      throw new Error('Wallet is not configured to use gap limit');
    }
    return this.store.getGapLimit();
  }

  /**
   * Get the index limit.
   * @returns {Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'>>}
   */
  async getIndexLimit() {
    return this.store.getIndexLimit();
  }

  /**
   * Get the scanning policy.
   * @returns {Promise<AddressScanPolicy>}
   */
  async getScanningPolicy() {
    return this.store.getScanningPolicy();
  }

  /**
   * Set the scanning policy data.
   * @param {AddressScanPolicyData | null} data
   * @returns {Promise<void>}
   */
  async setScanningPolicyData(data) {
    if (!data) return;
    await this.store.setScanningPolicyData(data);
  }

  /**
   * Get the scanning policy data.
   * @returns {Promise<AddressScanPolicyData>}
   */
  async getScanningPolicyData() {
    return this.store.getScanningPolicyData();
  }

  /**
   * Return if the loaded wallet was started from a hardware wallet.
   * @returns {Promise<boolean>}
   */
  async isHardwareWallet() {
    const accessData = await this._getValidAccessData();
    return (accessData.walletFlags & _types.WALLET_FLAGS.HARDWARE) > 0;
  }

  /**
   * Return if the nano contract is registered for the given address based on ncId.
   * @param ncId Nano Contract ID.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId) {
    return this.store.isNanoContractRegistered(ncId);
  }

  /**
   * Iterate on all registered nano contracts of the wallet.
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<INcData>}
   */
  getRegisteredNanoContracts() {
    var _this10 = this;
    return _wrapAsyncGenerator(function* () {
      var _iteratorAbruptCompletion12 = false;
      var _didIteratorError12 = false;
      var _iteratorError12;
      try {
        for (var _iterator12 = _asyncIterator(_this10.store.registeredNanoContractsIter()), _step12; _iteratorAbruptCompletion12 = !(_step12 = yield _awaitAsyncGenerator(_iterator12.next())).done; _iteratorAbruptCompletion12 = false) {
          const ncData = _step12.value;
          {
            yield ncData;
          }
        }
      } catch (err) {
        _didIteratorError12 = true;
        _iteratorError12 = err;
      } finally {
        try {
          if (_iteratorAbruptCompletion12 && _iterator12.return != null) {
            yield _awaitAsyncGenerator(_iterator12.return());
          }
        } finally {
          if (_didIteratorError12) {
            throw _iteratorError12;
          }
        }
      }
    })();
  }

  /**
   * Get nano contract data.
   * @param ncId Nano Contract ID.
   * @returns An instance of Nano Contract data.
   */
  async getNanoContract(ncId) {
    return this.store.getNanoContract(ncId);
  }

  /**
   * Register nano contract data instance.
   * @param ncId Nano Contract ID.
   * @param ncValue Nano Contract basic information.
   */
  async registerNanoContract(ncId, ncValue) {
    return this.store.registerNanoContract(ncId, ncValue);
  }

  /**
   * Unregister nano contract.
   * @param ncId Nano Contract ID.
   */
  async unregisterNanoContract(ncId) {
    return this.store.unregisterNanoContract(ncId);
  }

  /**
   * Update nano contract registered address
   * @param ncId Nano Contract ID.
   * @param address New registered address
   */
  async updateNanoContractRegisteredAddress(ncId, address) {
    if (!(await this.isAddressMine(address))) {
      throw new Error('Registered address must belong to the wallet.');
    }
    return this.store.updateNanoContractRegisteredAddress(ncId, address);
  }
}
exports.Storage = Storage;