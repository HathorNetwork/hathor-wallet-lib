"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MemoryStore = void 0;
var _lodash = require("lodash");
var _types = require("../types");
var _constants = require("../constants");
var _transaction = _interopRequireDefault(require("../utils/transaction"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _awaitAsyncGenerator(e) { return new _OverloadYield(e, 0); }
function _wrapAsyncGenerator(e) { return function () { return new AsyncGenerator(e.apply(this, arguments)); }; }
function AsyncGenerator(e) { var r, t; function resume(r, t) { try { var n = e[r](t), o = n.value, u = o instanceof _OverloadYield; Promise.resolve(u ? o.v : o).then(function (t) { if (u) { var i = "return" === r ? "return" : "next"; if (!o.k || t.done) return resume(i, t); t = e[i](t).value; } settle(n.done ? "return" : "normal", t); }, function (e) { resume("throw", e); }); } catch (e) { settle("throw", e); } } function settle(e, n) { switch (e) { case "return": r.resolve({ value: n, done: !0 }); break; case "throw": r.reject(n); break; default: r.resolve({ value: n, done: !1 }); } (r = r.next) ? resume(r.key, r.arg) : t = null; } this._invoke = function (e, n) { return new Promise(function (o, u) { var i = { key: e, arg: n, resolve: o, reject: u, next: null }; t ? t = t.next = i : (r = t = i, resume(e, n)); }); }, "function" != typeof e.return && (this.return = void 0); }
AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function () { return this; }, AsyncGenerator.prototype.next = function (e) { return this._invoke("next", e); }, AsyncGenerator.prototype.throw = function (e) { return this._invoke("throw", e); }, AsyncGenerator.prototype.return = function (e) { return this._invoke("return", e); };
function _OverloadYield(e, d) { this.v = e, this.k = d; } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const DEFAULT_ADDRESSES_WALLET_DATA = {
  lastLoadedAddressIndex: 0,
  lastUsedAddressIndex: -1,
  currentAddressIndex: -1
};
const DEFAULT_SCAN_POLICY_DATA = {
  policy: _types.SCANNING_POLICY.GAP_LIMIT,
  gapLimit: _constants.GAP_LIMIT
};
const DEFAULT_WALLET_DATA = {
  bestBlockHeight: 0,
  scanPolicyData: DEFAULT_SCAN_POLICY_DATA
};

/**
 * Get the ordering key for a transaction.
 * This will be used to sort the transactions by timestamp.
 *
 * @param {Pick<IHistoryTx, 'timestamp'|'tx_id'>} tx The transaction, at least with timestamp and tx_id
 * @returns {string} The ordering key for the transaction
 * @example
 * // returns '0000000f:cafe'
 * getOrderingKey({ tx_id: 'cafe', timestamp: 15 });
 * @example
 * // returns '5fbec5d0:abcdef'
 * getOrderingKey({ tx_id: 'abcdef', timestamp: 1606338000 });
 */
function getOrderingKey(tx) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(tx.timestamp, 0);
  return `${buf.toString('hex')}:${tx.tx_id}`;
}

/**
 * Get the parts of the ordering key.
 * This is meant to be used to decode the ordering key
 * so we can fetch the transaction from the storage.
 *
 * @param {string} key The ordering key of a transaction
 * @returns {{ timestamp: number, txId: string }}
 * @example
 * // returns { timestamp: 15, txId: 'cafe' }
 * getPartsFromOrderingKey('0000000f:cafe');
 * @example
 * // returns { timestamp: 1606338000, txId: 'abcdef' }
 * getPartsFromOrderingKey('5fbec5d0:abcdef');
 */
function getPartsFromOrderingKey(key) {
  const parts = key.split(':');
  const buf = Buffer.from(parts[0], 'hex');
  return {
    timestamp: buf.readUInt32BE(0),
    txId: parts[1]
  };
}
class MemoryStore {
  constructor() {
    /**
     * Map<base58, IAddressInfo>
     * where base58 is the address in base58
     */
    _defineProperty(this, "addresses", void 0);
    /**
     * Map<index, base58>
     * where index is the address index and base58 is the address in base58
     */
    _defineProperty(this, "addressIndexes", void 0);
    /**
     * Map<base58, IAddressMetadata>
     * where base58 is the address in base58
     */
    _defineProperty(this, "addressesMetadata", void 0);
    /**
     * Map<uid, ITokenData>
     * where uid is the token uid in hex
     */
    _defineProperty(this, "tokens", void 0);
    /**
     * Map<uid, ITokenMetadata>
     * where uid is the token uid in hex
     */
    _defineProperty(this, "tokensMetadata", void 0);
    /**
     * Map<uid, ITokenData>
     * where uid is the token uid in hex
     */
    _defineProperty(this, "registeredTokens", void 0);
    /**
     * Map<ncId, INcData>
     * where ncId is the nano contract id in hex
     */
    _defineProperty(this, "registeredNanoContracts", void 0);
    /**
     * Map<txId, IHistoryTx>
     * where txId is the transaction id in hex
     */
    _defineProperty(this, "history", void 0);
    /**
     * Array of `<timestamp>:<txId>` strings, which should be always sorted.
     * `timestamp` should be in uint32 representation
     * This will force the items to be ordered by timestamp.
     */
    _defineProperty(this, "historyTs", void 0);
    /**
     * Map<utxoid, IUtxo>
     * where utxoid is the txId + index, a string representation of IUtxoId
     */
    _defineProperty(this, "utxos", void 0);
    /**
     * Wallet access data
     */
    _defineProperty(this, "accessData", void 0);
    /**
     * Wallet metadata
     */
    _defineProperty(this, "walletData", void 0);
    /**
     * Generic storage for any other data
     */
    _defineProperty(this, "genericStorage", void 0);
    _defineProperty(this, "lockedUtxos", void 0);
    this.addresses = new Map();
    this.addressIndexes = new Map();
    this.addressesMetadata = new Map();
    this.tokens = new Map();
    this.tokensMetadata = new Map();
    this.registeredTokens = new Map();
    this.history = new Map();
    this.historyTs = [];
    this.utxos = new Map();
    this.accessData = null;
    this.genericStorage = {};
    this.lockedUtxos = new Map();
    this.registeredNanoContracts = new Map();
    this.walletData = (0, _lodash.cloneDeep)({
      ...DEFAULT_WALLET_DATA,
      ...DEFAULT_ADDRESSES_WALLET_DATA
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async validate() {
    // This is a noop since the memory store always starts clean.
  }

  /**
   * Prepare the store for history processing.
   */
  async preProcessHistory() {
    this.historyTs.sort();
  }

  /** ADDRESSES */

  /**
   * Iterate on all addresses
   *
   * @async
   * @returns {AsyncGenerator<IAddressInfo>}
   */
  addressIter() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      for (const addrInfo of _this.addresses.values()) {
        yield addrInfo;
      }
    })();
  }

  /**
   * Get the address info if it exists.
   *
   * @param {string} base58 Address in base58 to search
   * @async
   * @returns {Promise<IAddressInfo | null>} A promise with the address info or null if not in storage
   */
  async getAddress(base58) {
    return this.addresses.get(base58) || null;
  }

  /**
   * Get the metadata for an address if it exists.
   *
   * @param {string} base58 Address in base58 to search the metadata
   * @async
   * @returns {Promise<IAddressMetadata | null>} A promise with the address metadata or null if not in storage
   */
  async getAddressMeta(base58) {
    return this.addressesMetadata.get(base58) || null;
  }

  /**
   * Count the number of addresses in storage.
   * @async
   * @returns {Promise<number>} A promise with the number of addresses
   */
  async addressCount() {
    return this.addresses.size;
  }

  /**
   * Get the address info from its bip32 index.
   * @param index bip32 address index to search for
   * @async
   * @returns {Promise<IAddressInfo | null>} The address info or null if not in storage
   */
  async getAddressAtIndex(index) {
    const addr = this.addressIndexes.get(index);
    if (addr === undefined) {
      // We do not have this index loaded on storage, it should be generated instead
      return null;
    }
    return this.addresses.get(addr);
  }

  /**
   * Save the address in storage
   * @param {IAddressInfo} info Info on address to save
   * @async
   * @returns {Promise<void>}
   */
  async saveAddress(info) {
    if (!info.base58) {
      throw new Error('Invalid address');
    }
    if (this.addresses.has(info.base58)) {
      throw new Error('Already have this address');
    }

    // Saving address info
    this.addresses.set(info.base58, info);
    this.addressIndexes.set(info.bip32AddressIndex, info.base58);
    if (this.walletData.currentAddressIndex === -1) {
      this.walletData.currentAddressIndex = info.bip32AddressIndex;
    }
    if (info.bip32AddressIndex > this.walletData.lastLoadedAddressIndex) {
      this.walletData.lastLoadedAddressIndex = info.bip32AddressIndex;
    }
  }

  /**
   * Check that an address is in our storage.
   * @param {string} base58 Address to check.
   * @async
   * @returns A promise that resolves to wheather the address is saved in storage or no.
   */
  async addressExists(base58) {
    return this.addresses.has(base58);
  }

  /**
   * Get the current address.
   *
   * @param {boolean | undefined} markAsUsed If we should set the next address as current
   * @async
   * @returns {Promise<string>} The address in base58 format
   */
  async getCurrentAddress(markAsUsed) {
    const addressInfo = await this.getAddressAtIndex(this.walletData.currentAddressIndex);
    if (!addressInfo) {
      throw new Error('Current address is not loaded');
    }
    if (markAsUsed) {
      // Will move the address index only if we have not reached the gap limit
      this.walletData.currentAddressIndex = Math.min(this.walletData.lastLoadedAddressIndex, this.walletData.currentAddressIndex + 1);
    }
    return addressInfo.base58;
  }

  /**
   * Set the value of the current address index.
   * @param {number} index The index to set
   */
  async setCurrentAddressIndex(index) {
    this.walletData.currentAddressIndex = index;
  }

  /**
   * Edit address metadata.
   *
   * @param {string} base58 The address in base58 format
   * @param {IAddressMetadata} meta The metadata to save
   */
  async editAddressMeta(base58, meta) {
    this.addressesMetadata.set(base58, meta);
  }

  /* TRANSACTIONS */

  /**
   * Iterate on the transaction history ordered by timestamp.
   *
   * @param {string|undefined} tokenUid Only yield txs with this token.
   *
   * @async
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  historyIter(tokenUid) {
    var _this2 = this;
    return _wrapAsyncGenerator(function* () {
      /**
       * We iterate in reverse order so the most recent transactions are yielded first.
       * This is to maintain the behavior in the wallets and allow the user to see the most recent transactions first.
       */
      for (let i = _this2.historyTs.length - 1; i >= 0; i -= 1) {
        const orderKey = _this2.historyTs[i];
        const {
          txId
        } = getPartsFromOrderingKey(orderKey);
        const tx = _this2.history.get(txId);
        if (!tx) {
          // This should never happen since any transactions in historyTs should also be in history
          throw new Error('Transaction not found');
        }
        if (tokenUid === undefined) {
          yield tx;
          continue;
        }

        // If a tokenUid is passed, we only yield the transaction if it has the token in one of our addresses
        let found = false;
        for (const input of tx.inputs) {
          if (input.decoded.address && _this2.addresses.has(input.decoded.address) && input.token === tokenUid) {
            found = true;
            break;
          }
        }
        if (found) {
          yield tx;
          continue;
        }
        for (const output of tx.outputs) {
          if (output.decoded.address && _this2.addresses.has(output.decoded.address) && output.token === tokenUid) {
            found = true;
            break;
          }
        }
        if (found) {
          yield tx;
          continue;
        }
      }
    })();
  }

  /**
   * Get the size of the transaction history.
   *
   * @returns {Promise<number>} The size of the transaction history
   */
  async historyCount() {
    return this.history.size;
  }

  /**
   * Save a transaction on storage.
   * @param {IHistoryTx} tx The transaction to store
   * @async
   * @returns {Promise<void>}
   */
  async saveTx(tx) {
    // Protect ordering list from updates on the same transaction
    // We can check the historyTs but it's O(n) and this check is O(1).
    if (!this.history.has(tx.tx_id)) {
      // Add transaction to the ordering list
      // Wallets expect to show users the transactions in order of descending timestamp
      // This is so wallets can show the most recent transactions to users
      // The historyTs should be sorted to ensure the history order but this is not
      // done here due to the performance bottleneck it creates on big wallets.
      this.historyTs.push(getOrderingKey(tx));
    }
    this.history.set(tx.tx_id, tx);
    let maxIndex = this.walletData.lastUsedAddressIndex;
    for (const el of [...tx.inputs, ...tx.outputs]) {
      if (el.decoded.address && (await this.addressExists(el.decoded.address))) {
        const index = this.addresses.get(el.decoded.address).bip32AddressIndex;
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    }
    if (this.walletData.currentAddressIndex < maxIndex) {
      this.walletData.currentAddressIndex = Math.min(maxIndex + 1, this.walletData.lastLoadedAddressIndex);
    }
    this.walletData.lastUsedAddressIndex = maxIndex;
  }

  /**
   * Fetch a transaction in the storage by its id.
   * @param txId The transaction id
   * @async
   * @returns {Promise<IHistoryTx | null>} A promise with the transaction or null
   */
  async getTx(txId) {
    return this.history.get(txId) || null;
  }

  /** TOKENS */

  /**
   * Iterate on tokens with the available metadata
   *
   * @async
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  tokenIter() {
    var _this3 = this;
    return _wrapAsyncGenerator(function* () {
      for (const tokenInfo of _this3.tokens.values()) {
        const tokenMeta = _this3.tokensMetadata.get(tokenInfo.uid);
        yield {
          ...tokenInfo,
          ...tokenMeta
        };
      }
    })();
  }

  /**
   * Get a token on storage from the uid
   * @param tokenUid The token id to fetch
   * @returns {Promise<(ITokenData & Partial<ITokenMetadata>) | null>} The token data if present
   */
  async getToken(tokenUid) {
    const tokenConfig = this.tokens.get(tokenUid);
    if (tokenConfig === undefined) {
      return null;
    }
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
    const tokenMeta = this.tokensMetadata.get(tokenUid);
    return {
      ...tokenConfig,
      ...DEFAULT_TOKEN_META,
      ...tokenMeta
    };
  }

  /**
   * Fetch the token metadata from the storage.
   *
   * @param {string} tokenUid The token id to fetch metadata.
   * @returns {Promise<ITokenMetadata | null>} The token metadata if present
   */
  async getTokenMeta(tokenUid) {
    const tokenMeta = this.tokensMetadata.get(tokenUid);
    if (tokenMeta === undefined) {
      return null;
    }
    return tokenMeta;
  }

  /**
   * Save a token on storage
   * @param {ITokenData} tokenConfig Token config
   * @param {ITokenMetadata|undefined} [meta] The token metadata
   * @async
   * @returns {Promise<void>}
   */
  async saveToken(tokenConfig, meta) {
    if (this.tokens.has(tokenConfig.uid)) {
      throw new Error('Already have this token');
    }
    this.tokens.set(tokenConfig.uid, tokenConfig);
    if (meta !== undefined) {
      this.tokensMetadata.set(tokenConfig.uid, meta);
    }
  }

  /**
   * Iterate on registered tokens.
   *
   * @async
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  registeredTokenIter() {
    var _this4 = this;
    return _wrapAsyncGenerator(function* () {
      for (const tokenConfig of _this4.registeredTokens.values()) {
        const tokenMeta = _this4.tokensMetadata.get(tokenConfig.uid);
        yield {
          ...tokenConfig,
          ...tokenMeta
        };
      }
    })();
  }

  /**
   * Register a token.
   *
   * Obs: we require the token data because the token being registered may not be on our storage yet.
   *
   * @param token Token config to register
   * @async
   * @returns {Promise<void>}
   */
  async registerToken(token) {
    this.registeredTokens.set(token.uid, token);
  }

  /**
   * Unregister a token.
   *
   * @param {string} tokenUid Token id
   * @async
   * @returns {Promise<void>}
   */
  async unregisterToken(tokenUid) {
    this.registeredTokens.delete(tokenUid);
  }

  /**
   * Return if a token uid is registered or not.
   *
   * @param {string} tokenUid - Token id
   * @returns {Promise<boolean>}
   */
  async isTokenRegistered(tokenUid) {
    return this.registeredTokens.has(tokenUid);
  }

  /**
   * Edit token metadata on storage.
   * @param {string} tokenUid Token id to edit
   * @param {Partial<ITokenMetadata>} meta Metadata to save
   * @returns {Promise<void>}
   */
  async editTokenMeta(tokenUid, meta) {
    this.tokensMetadata.set(tokenUid, meta);
  }

  /** UTXOS */

  /**
   * Iterate on all available utxos.
   * @async
   * @returns {AsyncGenerator<IUtxo>}
   */
  utxoIter() {
    var _this5 = this;
    return _wrapAsyncGenerator(function* () {
      for (const utxo of _this5.utxos.values()) {
        yield utxo;
      }
    })();
  }

  /**
   * Fetch utxos based on a selection criteria
   * @param {IUtxoFilterOptions} options Options to filter utxos
   * @async
   * @returns {AsyncGenerator<IUtxo>}
   */
  selectUtxos(options) {
    var _this6 = this;
    return _wrapAsyncGenerator(function* () {
      const networkHeight = yield _awaitAsyncGenerator(_this6.getCurrentHeight());
      const nowTs = Math.floor(Date.now() / 1000);
      const isTimeLocked = timestamp => !!timestamp && nowTs < timestamp;
      const isHeightLocked = utxo => {
        if (!_transaction.default.isBlock({
          version: utxo.type
        })) {
          // Only blocks can be reward locked
          return false;
        }
        return _transaction.default.isHeightLocked(utxo.height, networkHeight, options.reward_lock);
      };
      const isLocked = utxo => isTimeLocked(utxo.timelock || 0) || isHeightLocked(utxo);
      const token = options.token || _constants.NATIVE_TOKEN_UID;
      const authorities = options.authorities || 0;
      if (options.max_amount && options.target_amount) {
        throw new Error('invalid options');
      }
      let sumAmount = 0n;
      let utxoNum = 0;

      // Map.prototype.values() is an iterable but orderBy returns an array
      // Both work with for...of so we can use them interchangeably
      let iter;
      if (options.order_by_value) {
        // Sort by value as requested in options.order_by_value
        iter = (0, _lodash.orderBy)(Array.from(_this6.utxos.values()), ['value'], [options.order_by_value]);
      } else {
        iter = _this6.utxos.values();
      }
      for (const utxo of iter) {
        if (options.only_available_utxos && isLocked(utxo)) {
          // Skip locked utxos if we only want available utxos
          continue;
        }
        let authority_match;
        if (authorities === 0) {
          authority_match = utxo.authorities === 0n;
        } else {
          authority_match = (utxo.authorities & authorities) > 0;
        }
        if (options.filter_method && !options.filter_method(utxo) || options.amount_bigger_than && utxo.value <= options.amount_bigger_than || options.amount_smaller_than && utxo.value >= options.amount_smaller_than || options.filter_address && utxo.address !== options.filter_address || !authority_match || utxo.token !== token) {
          // This utxo has failed a filter constraint
          continue;
        }
        if (options.max_amount && sumAmount + utxo.value > options.max_amount) {
          // If this utxo is returned we would pass the max_amount
          // We continue to ensure we have the closest to max_amount
          continue;
        }
        yield utxo;
        utxoNum += 1;
        if (!isLocked(utxo)) {
          // sumAmount is used to filter for a target_amount and max_amount
          // both only count unlocked utxos.
          sumAmount += utxo.value;
        }
        if (options.target_amount && sumAmount >= options.target_amount || options.max_utxos && utxoNum >= options.max_utxos) {
          // We have reached either the target amount or the max number of utxos requested
          return;
        }
      }
    })();
  }

  /**
   * Save an utxo on storage.
   * @param {IUtxo} utxo Utxo to save
   * @async
   * @returns {Promise<void>}
   */
  async saveUtxo(utxo) {
    this.utxos.set(`${utxo.txId}:${utxo.index}`, utxo);
  }

  /**
   * Save a locked utxo.
   * Used when a new utxo is received but it is either time locked or height locked.
   * The locked utxo index will be used to manage the locked utxos.
   *
   * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
   * @returns {Promise<void>}
   */
  async saveLockedUtxo(lockedUtxo) {
    this.lockedUtxos.set(`${lockedUtxo.tx.tx_id}:${lockedUtxo.index}`, lockedUtxo);
  }

  /**
   * Iterate over all locked utxos
   * @returns {AsyncGenerator<ILockedUtxo>}
   */
  iterateLockedUtxos() {
    var _this7 = this;
    return _wrapAsyncGenerator(function* () {
      for (const lockedUtxo of _this7.lockedUtxos.values()) {
        yield lockedUtxo;
      }
    })();
  }

  /**
   * Remove an utxo from the locked utxos if it became unlocked.
   *
   * @param lockedUtxo utxo that became unlocked
   * @returns {Promise<void>}
   */
  async unlockUtxo(lockedUtxo) {
    this.lockedUtxos.delete(`${lockedUtxo.tx.tx_id}:${lockedUtxo.index}`);
  }

  /** ACCESS DATA */

  /**
   * Save access data on storage.
   * @param {IWalletAccessData} data Access data to save
   * @async
   * @returns {Promise<void>}
   */
  async saveAccessData(data) {
    this.accessData = data;
  }

  /**
   * Fetch wallet access data on storage if present.
   * @async
   * @returns {Promise<IWalletAccessData | null>} A promise with the wallet access data.
   */
  async getAccessData() {
    return this.accessData;
  }

  /**
   * Get the last bip32 address index loaded on storage.
   * @async
   * @returns {Promise<number>}
   */
  async getLastLoadedAddressIndex() {
    return this.walletData.lastLoadedAddressIndex;
  }

  /**
   * Get the last bip32 address index used, i.e. with any transaction.
   * @async
   * @returns {Promise<number>}
   */
  async getLastUsedAddressIndex() {
    return this.walletData.lastUsedAddressIndex;
  }

  /**
   * Set the current best chain height.
   * @async
   * @param {number} height Height to set.
   */
  async setCurrentHeight(height) {
    this.walletData.bestBlockHeight = height;
  }

  /**
   * Set the last bip32 address index used on storage.
   * @param {number} index The index to set as last used address.
   */
  async setLastUsedAddressIndex(index) {
    this.walletData.lastUsedAddressIndex = index;
  }

  /**
   * Get the current best chain height.
   * @async
   * @returns {Promise<number>}
   */
  async getCurrentHeight() {
    return this.walletData.bestBlockHeight;
  }

  /**
   * Set the gap limit for this wallet.
   * @async
   * @param {number} value Gat limit to set.
   */
  async setGapLimit(value) {
    if (!this.walletData.scanPolicyData) {
      this.walletData.scanPolicyData = {
        policy: _types.SCANNING_POLICY.GAP_LIMIT,
        gapLimit: value
      };
      return;
    }
    if ((0, _types.isGapLimitScanPolicy)(this.walletData.scanPolicyData)) {
      this.walletData.scanPolicyData.gapLimit = value;
    }
  }

  /**
   * Get the current wallet gap limit.
   * @async
   * @returns {Promise<number>}
   */
  async getGapLimit() {
    if ((0, _types.isGapLimitScanPolicy)(this.walletData.scanPolicyData)) {
      if (!this.walletData.scanPolicyData.gapLimit) {
        this.walletData.scanPolicyData = {
          policy: _types.SCANNING_POLICY.GAP_LIMIT,
          gapLimit: _constants.GAP_LIMIT
        };
      }
      return this.walletData.scanPolicyData.gapLimit;
    }
    // Return default gap limit
    return _constants.GAP_LIMIT;
  }
  async getIndexLimit() {
    if (this.walletData.scanPolicyData?.policy === _types.SCANNING_POLICY.INDEX_LIMIT) {
      return {
        startIndex: this.walletData?.scanPolicyData?.startIndex || 0,
        endIndex: this.walletData?.scanPolicyData?.endIndex || 0
      };
    }
    return null;
  }

  /**
   * Get the configured address scanning policy.
   * @async
   * @returns {Promise<AddressScanPolicy>}
   */
  async getScanningPolicy() {
    return this.walletData.scanPolicyData?.policy || _types.SCANNING_POLICY.GAP_LIMIT;
  }
  async setScanningPolicyData(data) {
    this.walletData.scanPolicyData = data;
  }
  async getScanningPolicyData() {
    return this.walletData.scanPolicyData || DEFAULT_SCAN_POLICY_DATA;
  }

  /**
   * Get the wallet data.
   * @async
   * @returns {Promise<IWalletData>}
   */
  async getWalletData() {
    return this.walletData;
  }

  /**
   * Get an entry on the generic storage.
   * @param {string} key Key to fetch
   * @async
   * @returns {Promise<any>}
   */
  async getItem(key) {
    return this.genericStorage[key];
  }

  /**
   * Set an item on the generic storage.
   *
   * @param {string} key Key to store
   * @param {any} value Value to store
   * @async
   * @returns {Promise<void>}
   */
  async setItem(key, value) {
    this.genericStorage[key] = value;
  }

  /**
   * Clean the storage.
   * @param {boolean} cleanHistory if we should clean the transaction history.
   * @param {boolean} cleanAddresses if we should clean the addresses.
   * @param {boolean} cleanTokens if we should clean the registered tokens.
   * @async
   * @returns {Promise<void>}
   */
  async cleanStorage(cleanHistory = false, cleanAddresses = false, cleanTokens = false) {
    if (cleanHistory) {
      this.tokens = new Map();
      this.tokensMetadata = new Map();
      this.history = new Map();
      this.historyTs = [];
      this.utxos = new Map();
      this.lockedUtxos = new Map();
    }
    if (cleanAddresses) {
      this.addresses = new Map();
      this.addressIndexes = new Map();
      this.addressesMetadata = new Map();
      this.walletData = {
        ...this.walletData,
        ...DEFAULT_ADDRESSES_WALLET_DATA
      };
    }
    if (cleanTokens) {
      this.registeredTokens = new Map();
      this.registeredNanoContracts = new Map();
    }
  }

  /**
   * Clean the store metadata.
   *
   * This is used when processing the history to avoid keeping metadata from a voided tx.
   * `processHistory` is additive, so if we don't clean the metadata we are passive to keep stale metadata.
   * This is also true for utxos since processing txs that spent utxos will not remove the utxo from the store.
   *
   * @returns {Promise<void>}
   */
  async cleanMetadata() {
    this.tokensMetadata = new Map();
    this.addressesMetadata = new Map();
    this.utxos = new Map();
    this.lockedUtxos = new Map();
  }

  /**
   * Return if the nano contract is registered for the given address based on ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId) {
    return this.registeredNanoContracts.has(ncId);
  }

  /**
   * Iterate on registered nano contracts.
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<INcData>}
   */
  registeredNanoContractsIter() {
    var _this8 = this;
    return _wrapAsyncGenerator(function* () {
      for (const ncData of _this8.registeredNanoContracts.values()) {
        yield ncData;
      }
    })();
  }

  /**
   * Get a nano contract data on storage from the ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns Nano contract data instance.
   * @async
   */
  async getNanoContract(ncId) {
    return this.registeredNanoContracts.get(ncId) || null;
  }

  /**
   * Register a nano contract data.
   *
   * @param ncId Nano Contract ID.
   * @param ncValue Nano contract basic information.
   * @async
   */
  async registerNanoContract(ncId, ncValue) {
    this.registeredNanoContracts.set(ncId, ncValue);
  }

  /**
   * Unregister nano contract.
   *
   * @param ncId Nano Contract ID.
   */
  async unregisterNanoContract(ncId) {
    this.registeredNanoContracts.delete(ncId);
  }

  /**
   * Update nano contract registered address.
   *
   * @param ncId Nano Contract ID.
   * @param address Nano Contract registered address.
   */
  async updateNanoContractRegisteredAddress(ncId, address) {
    const currentNanoContractData = await this.getNanoContract(ncId);
    if (currentNanoContractData !== null) {
      this.registeredNanoContracts.set(ncId, Object.assign(currentNanoContractData, {
        address
      }));
    }
  }
}
exports.MemoryStore = MemoryStore;