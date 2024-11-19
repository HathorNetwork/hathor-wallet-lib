"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports._updateTokensData = _updateTokensData;
exports.apiSyncHistory = apiSyncHistory;
exports.checkGapLimit = checkGapLimit;
exports.checkIndexLimit = checkIndexLimit;
exports.checkScanningPolicy = checkScanningPolicy;
exports.getHistorySyncMethod = getHistorySyncMethod;
exports.getSupportedSyncMode = getSupportedSyncMode;
exports.loadAddressHistory = loadAddressHistory;
exports.loadAddresses = loadAddresses;
exports.processHistory = processHistory;
exports.processNewTx = processNewTx;
exports.processUtxoUnlock = processUtxoUnlock;
exports.scanPolicyStartAddresses = scanPolicyStartAddresses;
var _lodash = require("lodash");
var _axios = _interopRequireDefault(require("axios"));
var _types = require("../types");
var _wallet = _interopRequireDefault(require("../api/wallet"));
var _helpers = _interopRequireDefault(require("./helpers"));
var _transaction = _interopRequireDefault(require("./transaction"));
var _address = require("./address");
var _stream = require("../sync/stream");
var _constants = require("../constants");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
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
/**
 * Get history sync method for a given mode
 * @param {HistorySyncMode} mode The mode of the stream
 * @returns {HistorySyncFunction}
 */
function getHistorySyncMethod(mode) {
  switch (mode) {
    case _types.HistorySyncMode.MANUAL_STREAM_WS:
      return _stream.manualStreamSyncHistory;
    case _types.HistorySyncMode.XPUB_STREAM_WS:
      return _stream.xpubStreamSyncHistory;
    case _types.HistorySyncMode.POLLING_HTTP_API:
    default:
      return apiSyncHistory;
  }
}
async function getSupportedSyncMode(storage) {
  const walletType = await storage.getWalletType();
  if (walletType === _types.WalletType.P2PKH) {
    return [_types.HistorySyncMode.MANUAL_STREAM_WS, _types.HistorySyncMode.POLLING_HTTP_API, _types.HistorySyncMode.XPUB_STREAM_WS];
  }
  if (walletType === _types.WalletType.MULTISIG) {
    return [_types.HistorySyncMode.POLLING_HTTP_API];
  }
  return [];
}

/**
 * Derive requested addresses (if not already loaded), save them on storage then return them.
 * @param {number} startIndex Index to start loading addresses
 * @param {number} count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @returns {Promise<stringp[]>} List of loaded addresses in base58
 */
async function loadAddresses(startIndex, count, storage) {
  const addresses = [];
  const stopIndex = startIndex + count;
  for (let i = startIndex; i < stopIndex; i++) {
    const storageAddr = await storage.getAddressAtIndex(i);
    if (storageAddr !== null) {
      // This address is already generated, we can skip derivation
      addresses.push(storageAddr.base58);
      continue;
    }
    // derive address at index i
    let address;
    if ((await storage.getWalletType()) === 'p2pkh') {
      address = await (0, _address.deriveAddressP2PKH)(i, storage);
    } else {
      address = await (0, _address.deriveAddressP2SH)(i, storage);
    }
    await storage.saveAddress(address);
    addresses.push(address.base58);
  }
  return addresses;
}

/**
 * Fetch the history of the addresses and save it on storage.
 * Optionally process the history after loading it.
 *
 * @param {number} startIndex Index to start loading addresses
 * @param {number} count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @param {FullnodeConnection} connection Connection to the full node
 * @param {boolean} shouldProcessHistory If we should process the history after loading it.
 */
async function apiSyncHistory(startIndex, count, storage, connection, shouldProcessHistory = false) {
  let itStartIndex = startIndex;
  let itCount = count;
  let foundAnyTx = false;
  while (true) {
    const addresses = await loadAddresses(itStartIndex, itCount, storage);
    // subscribe to addresses
    connection.subscribeAddresses(addresses);
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(loadAddressHistory(addresses, storage)), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const gotTx = _step.value;
        {
          if (gotTx) {
            // This will signal we have found a transaction when syncing the history
            foundAnyTx = true;
          }
          // update UI
          connection.emit('wallet-load-partial-update', {
            addressesFound: await storage.store.addressCount(),
            historyLength: await storage.store.historyCount()
          });
        }
      }

      // Check if we need to load more addresses from the address scanning policy
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
    const loadMoreAddresses = await checkScanningPolicy(storage);
    if (loadMoreAddresses === null) {
      // No more addresses to load
      break;
    }
    // The scanning policy configured requires more addresses to be loaded
    itStartIndex = loadMoreAddresses.nextIndex;
    itCount = loadMoreAddresses.count;
  }
  if (foundAnyTx && shouldProcessHistory) {
    await storage.processHistory();
  }
}

/**
 * Fetch the tx history for a chunkified list of addresses.
 * This method returns an AsyncGenerator so that the caller can update the UI if any transaction is found during the load process.
 *
 * @param {stringp[]} addresses List of addresses to load history
 * @param {IStorage} storage The storage to load the addresses
 * @returns {AsyncGenerator<boolean>} If we found any transaction in the history
 */
function loadAddressHistory(_x, _x2) {
  return _loadAddressHistory.apply(this, arguments);
}
/**
 * Get the starting addresses to load from the scanning policy
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses>}
 */
function _loadAddressHistory() {
  _loadAddressHistory = _wrapAsyncGenerator(function* (addresses, storage) {
    let foundAnyTx = false;
    // chunkify addresses
    const addressesChunks = (0, _lodash.chunk)(addresses, _constants.MAX_ADDRESSES_GET);
    let retryCount = 0;
    for (let i = 0; i < addressesChunks.length; i++) {
      let hasMore = true;
      let firstHash = null;
      let addrsToSearch = addressesChunks[i];
      while (hasMore === true) {
        let response;
        try {
          response = yield _awaitAsyncGenerator(_wallet.default.getAddressHistoryForAwait(addrsToSearch, firstHash));
        } catch (e) {
          if (!_axios.default.isAxiosError(e)) {
            // We only treat AxiosError
            throw e;
          }
          const err = e;
          // We will retry the request that fails with client timeout
          // in this request error we don't have the response because
          // the client closed the connection
          //
          // There are some error reports about it (https://github.com/axios/axios/issues/2716)
          // Besides that, there are some problems happening in newer axios versions (https://github.com/axios/axios/issues/2710)
          // One user that opened a PR for axios said he is checking the timeout error with the message includes condition
          // https://github.com/axios/axios/pull/2874#discussion_r403753852
          if (err.code === 'ECONNABORTED' && err.response === undefined && err.message.toLowerCase().includes('timeout')) {
            // in this case we retry
            continue;
          }
          if (retryCount > _constants.LOAD_WALLET_MAX_RETRY) {
            throw e;
          }
          retryCount++;
          yield _awaitAsyncGenerator(_helpers.default.sleep(_constants.LOAD_WALLET_RETRY_SLEEP));
          continue;
        }
        // Request has succeeded, reset retry count
        retryCount = 0;
        const result = response.data;
        if (result.success) {
          for (const tx of result.history) {
            foundAnyTx = true;
            yield _awaitAsyncGenerator(storage.addTx(tx));
          }
          hasMore = result.has_more;
          if (hasMore) {
            // prepare next page parameters
            firstHash = result.first_hash || null;
            const addrIndex = addrsToSearch.indexOf(result.first_address || '');
            if (addrIndex === -1) {
              throw Error('Invalid address returned from the server.');
            }
            addrsToSearch = addrsToSearch.slice(addrIndex);
          } else {
            // Signal that we have more data to update the UI
            yield foundAnyTx;
          }
        } else {
          throw new Error(result.message);
        }
      }
    }
  });
  return _loadAddressHistory.apply(this, arguments);
}
async function scanPolicyStartAddresses(storage) {
  const scanPolicy = await storage.getScanningPolicy();
  let limits;
  switch (scanPolicy) {
    case _types.SCANNING_POLICY.INDEX_LIMIT:
      limits = await storage.getIndexLimit();
      if (!limits) {
        // This should not happen but it enforces the limits type
        throw new Error('Index limit is not configured');
      }
      return {
        nextIndex: limits.startIndex,
        count: limits.endIndex - limits.startIndex + 1
      };
    case _types.SCANNING_POLICY.GAP_LIMIT:
    default:
      return {
        nextIndex: 0,
        count: await storage.getGapLimit()
      };
  }
}

/**
 * Use the correct method for the configured address scanning policy to check if we should
 * load more addresses
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
async function checkScanningPolicy(storage) {
  const scanPolicy = await storage.getScanningPolicy();
  switch (scanPolicy) {
    case _types.SCANNING_POLICY.INDEX_LIMIT:
      return checkIndexLimit(storage);
    case _types.SCANNING_POLICY.GAP_LIMIT:
      return checkGapLimit(storage);
    default:
      return null;
  }
}

/**
 * Check if the addresses loaded in storage are within policy specifications.
 * If it doesn't, it will return the next index to load and the number of addresses to fill the gap.
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
async function checkIndexLimit(storage) {
  if ((await storage.getScanningPolicy()) !== _types.SCANNING_POLICY.INDEX_LIMIT) {
    // Since the wallet is not configured to use index-limit this is a no-op
    return null;
  }
  const {
    lastLoadedAddressIndex,
    scanPolicyData
  } = await storage.getWalletData();
  if (!(0, _types.isIndexLimitScanPolicy)(scanPolicyData)) {
    // This error should never happen, but this enforces scanPolicyData typing
    throw new Error('Wallet is configured to use index-limit but the scan policy data is not configured as index-limit');
  }
  const limits = await storage.getIndexLimit();
  if (!limits) {
    // This should not happen but it enforces the limits type
    return null;
  }
  // If the last loaded address is below the end index, load addresses until we reach the end index
  if (lastLoadedAddressIndex < limits.endIndex) {
    return {
      nextIndex: lastLoadedAddressIndex + 1,
      count: limits.endIndex - lastLoadedAddressIndex
    };
  }

  // Index limit does not automatically load more addresses, only if configured by the user.
  return null;
}

/**
 * Check if the storage has at least `gapLimit` addresses loaded without any transaction.
 * If it doesn't, it will return the next index to load and the number of addresses to fill the gap.
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
async function checkGapLimit(storage) {
  if ((await storage.getScanningPolicy()) !== _types.SCANNING_POLICY.GAP_LIMIT) {
    // Since the wallet is not configured to use gap-limit this is a no-op
    return null;
  }
  // check gap limit
  const {
    lastLoadedAddressIndex,
    lastUsedAddressIndex
  } = await storage.getWalletData();
  const scanPolicyData = await storage.getScanningPolicyData();
  if (!(0, _types.isGapLimitScanPolicy)(scanPolicyData)) {
    // This error should never happen, but this enforces scanPolicyData typing
    throw new Error('Wallet is configured to use gap-limit but the scan policy data is not configured as gap-limit');
  }
  const {
    gapLimit
  } = scanPolicyData;
  if (lastUsedAddressIndex + gapLimit > lastLoadedAddressIndex) {
    // we need to generate more addresses to fill the gap limit
    return {
      nextIndex: lastLoadedAddressIndex + 1,
      count: lastUsedAddressIndex + gapLimit - lastLoadedAddressIndex
    };
  }
  return null;
}

/**
 * Process the history of transactions and create metadata to be used by the wallet.
 *
 * History processing is a complex and nuanced method so we created a utility to avoid errors on other store implementations.
 * This utility only uses the store methods so it can be used by any store implementation.
 *
 * @param {IStorage} storage Storage instance.
 * @param {{rewardLock: number}} [options={}] Use this configuration when processing the storage
 * @async
 * @returns {Promise<void>}
 */
async function processHistory(storage, {
  rewardLock
} = {}) {
  const {
    store
  } = storage;
  // We have an additive method to update metadata so we need to clean the current metadata before processing.
  await store.cleanMetadata();
  const nowTs = Math.floor(Date.now() / 1000);
  const currentHeight = await store.getCurrentHeight();
  const tokens = new Set();
  let maxIndexUsed = -1;
  // Iterate on all txs of the history updating the metadata as we go
  var _iteratorAbruptCompletion2 = false;
  var _didIteratorError2 = false;
  var _iteratorError2;
  try {
    for (var _iterator2 = _asyncIterator(store.historyIter()), _step2; _iteratorAbruptCompletion2 = !(_step2 = await _iterator2.next()).done; _iteratorAbruptCompletion2 = false) {
      const tx = _step2.value;
      {
        const processedData = await processNewTx(storage, tx, {
          rewardLock,
          nowTs,
          currentHeight
        });
        maxIndexUsed = Math.max(maxIndexUsed, processedData.maxAddressIndex);
        for (const token of processedData.tokens) {
          tokens.add(token);
        }
      }
    }

    // Update wallet data
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
  await updateWalletMetadataFromProcessedTxData(storage, {
    maxIndexUsed,
    tokens
  });
}

/**
 * Fetch and save the data of the token set on the storage
 * @param {IStorage} storage - Storage to save the tokens.
 * @param {Set<string>} tokens - set of tokens to fetch and save.
 * @returns {Promise<void>}
 */
async function _updateTokensData(storage, tokens) {
  async function fetchTokenData(uid) {
    let retryCount = 0;
    if (uid === _constants.NATIVE_TOKEN_UID) {
      const nativeToken = storage.getNativeTokenData();
      return {
        success: true,
        name: nativeToken.name,
        symbol: nativeToken.symbol
      };
    }
    while (retryCount <= 5) {
      try {
        // Fetch and return the api response
        const result = await new Promise((resolve, reject) => {
          _wallet.default.getGeneralTokenInfo(uid, resolve).catch(err => reject(err));
        });
        return result;
      } catch (err) {
        storage.logger.error(err);
        // This delay will give us the exponential backoff intervals of
        // 500ms, 1s, 2s, 4s and 8s
        const delay = 500 * 2 ** retryCount;
        // Increase the retry counter and try again
        retryCount += 1;
        // Wait `delay` ms before another attempt
        await new Promise(resolve => {
          setTimeout(resolve, delay);
        });
        continue;
      }
    }
    throw new Error(`Too many attempts at fetchTokenData for ${uid}`);
  }
  const {
    store
  } = storage;
  for (const uid of tokens) {
    const tokenInfo = await store.getToken(uid);
    if (!tokenInfo) {
      // The only error that can be thrown is 'too many retries'
      const response = await fetchTokenData(uid);
      if (!response.success) {
        throw new Error(response.message);
      }
      const {
        name,
        symbol
      } = response;
      const tokenData = {
        uid,
        name,
        symbol
      };
      // saveToken will ignore the meta and save only the token config
      await store.saveToken(tokenData);
    }
  }
}

/**
 * Update the store wallet data based on accumulated data from processed txs.
 * @param {IStorage} storage Storage instance.
 * @param {Object} options
 * @param {number} options.maxIndexUsed The maximum index used in the processed txs
 * @param {Set<string>} options.tokens A set of tokens found in the processed txs
 */
async function updateWalletMetadataFromProcessedTxData(storage, {
  maxIndexUsed,
  tokens
}) {
  const {
    store
  } = storage;
  // Update wallet data
  const walletData = await store.getWalletData();
  if (maxIndexUsed > -1) {
    // If maxIndexUsed is -1 it means we didn't find any tx, so we don't need to update the wallet data
    if (walletData.lastUsedAddressIndex <= maxIndexUsed) {
      if (walletData.currentAddressIndex <= maxIndexUsed) {
        await store.setCurrentAddressIndex(Math.min(maxIndexUsed + 1, walletData.lastLoadedAddressIndex));
      }
      await store.setLastUsedAddressIndex(maxIndexUsed);
    }
  }

  // Update token config
  // Up until now we have updated the tokens metadata, but the token config may be missing
  // So we will check if we have each token found, if not we will fetch the token config from the api.
  await _updateTokensData(storage, tokens);
}

/**
 * Process a new transaction, adding or creating the metadata for the addresses and tokens involved.
 * Will update relevant wallet data and utxos.
 * The return object contains the max address index used and the tokens found in the transaction.
 *
 * @param {IStorage} storage Storage instance.
 * @param {IHistoryTx} tx The new transaction to be processed
 * @param {Object} [options]
 * @param {number} [options.rewardLock] The reward lock of the network
 * @param {number} [options.nowTs] The current timestamp
 * @param {number} [options.currentHeight] The current height of the best chain
 * @returns {Promise<{ maxAddressIndex: number, tokens: Set<string> }>}
 */
async function processNewTx(storage, tx, {
  rewardLock,
  nowTs,
  currentHeight
} = {}) {
  function getEmptyBalance() {
    return {
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
    };
  }
  const {
    store
  } = storage;

  // We ignore voided transactions
  if (tx.is_voided) return {
    maxAddressIndex: -1,
    tokens: new Set()
  };
  const isHeightLocked = _transaction.default.isHeightLocked(tx.height, currentHeight, rewardLock);
  const txAddresses = new Set();
  const txTokens = new Set();
  let maxIndexUsed = -1;
  for (const [index, output] of tx.outputs.entries()) {
    // Skip data outputs since they do not have an address and do not "belong" in a wallet
    if (!output.decoded.address) continue;
    const addressInfo = await store.getAddress(output.decoded.address);
    // if address is not in wallet, ignore
    if (!addressInfo) continue;

    // Check if this output is locked
    const isLocked = _transaction.default.isOutputLocked(output, {
      refTs: nowTs
    }) || isHeightLocked;
    const isAuthority = _transaction.default.isAuthorityOutput(output);
    let addressMeta = await store.getAddressMeta(output.decoded.address);
    let tokenMeta = await store.getTokenMeta(output.token);

    // check if the current address is the highest index used
    // Update the max index used if it is
    if (addressInfo.bip32AddressIndex > maxIndexUsed) {
      maxIndexUsed = addressInfo.bip32AddressIndex;
    }

    // create metadata for address and token if it does not exist
    if (!addressMeta) {
      addressMeta = {
        numTransactions: 0,
        balance: new Map()
      };
    }
    if (!tokenMeta) {
      tokenMeta = {
        numTransactions: 0,
        balance: getEmptyBalance()
      };
    }
    if (!addressMeta.balance.has(output.token)) {
      // Add the current token to the address balance if not present
      addressMeta.balance.set(output.token, getEmptyBalance());
    }

    // update metadata
    txTokens.add(output.token);
    txAddresses.add(output.decoded.address);

    // calculate balance
    // The balance for authority outputs is the count of outputs
    // While the balance for non-authority outputs is the sum of the value.
    // The balance will also be split into unlocked and locked.
    // We will update both the address and token metadata separately.
    if (isAuthority) {
      if (isLocked) {
        if (_transaction.default.isMint(output)) {
          tokenMeta.balance.authorities.mint.locked += 1n;
          addressMeta.balance.get(output.token).authorities.mint.locked += 1n;
        }
        if (_transaction.default.isMelt(output)) {
          tokenMeta.balance.authorities.melt.locked += 1n;
          addressMeta.balance.get(output.token).authorities.melt.locked += 1n;
        }
      } else {
        if (_transaction.default.isMint(output)) {
          tokenMeta.balance.authorities.mint.unlocked += 1n;
          addressMeta.balance.get(output.token).authorities.mint.unlocked += 1n;
        }
        if (_transaction.default.isMelt(output)) {
          tokenMeta.balance.authorities.melt.unlocked += 1n;
          addressMeta.balance.get(output.token).authorities.melt.unlocked += 1n;
        }
      }
    } else if (isLocked) {
      tokenMeta.balance.tokens.locked += output.value;
      addressMeta.balance.get(output.token).tokens.locked += output.value;
    } else {
      tokenMeta.balance.tokens.unlocked += output.value;
      addressMeta.balance.get(output.token).tokens.unlocked += output.value;
    }

    // Add utxo to the storage if unspent
    // This is idempotent so it's safe to call it multiple times
    if (output.spent_by === null) {
      await store.saveUtxo({
        txId: tx.tx_id,
        index,
        type: tx.version,
        authorities: _transaction.default.isAuthorityOutput(output) ? output.value : 0n,
        address: output.decoded.address,
        token: output.token,
        value: output.value,
        timelock: output.decoded.timelock || null,
        height: tx.height || null
      });
      if (isLocked) {
        // We will save this utxo on the index of locked utxos
        // So that later when it becomes unlocked we can update the balances with processUtxoUnlock
        await store.saveLockedUtxo({
          tx,
          index
        });
      }
    } else if (await storage.isUtxoSelectedAsInput({
      txId: tx.tx_id,
      index
    })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({
        txId: tx.tx_id,
        index
      }, false);
    }
    await store.editTokenMeta(output.token, tokenMeta);
    await store.editAddressMeta(output.decoded.address, addressMeta);
  }
  for (const input of tx.inputs) {
    // We ignore data inputs since they do not have an address
    if (!input.decoded.address) continue;
    const addressInfo = await store.getAddress(input.decoded.address);
    // This is not our address, ignore
    if (!addressInfo) continue;
    const isAuthority = _transaction.default.isAuthorityOutput(input);
    let addressMeta = await store.getAddressMeta(input.decoded.address);
    let tokenMeta = await store.getTokenMeta(input.token);

    // We also check the index of the input addresses, but they should have been processed as outputs of another transaction.
    if (addressInfo.bip32AddressIndex > maxIndexUsed) {
      maxIndexUsed = addressInfo.bip32AddressIndex;
    }

    // create metadata for address and token if it does not exist
    if (!addressMeta) {
      addressMeta = {
        numTransactions: 0,
        balance: new Map()
      };
    }
    if (!tokenMeta) {
      tokenMeta = {
        numTransactions: 0,
        balance: getEmptyBalance()
      };
    }
    if (!addressMeta.balance.has(input.token)) {
      // Add the current token to the address balance if not present
      addressMeta.balance.set(input.token, getEmptyBalance());
    }

    // update counters
    txTokens.add(input.token);
    txAddresses.add(input.decoded.address);
    if (isAuthority) {
      if (_transaction.default.isMint(input)) {
        tokenMeta.balance.authorities.mint.unlocked -= 1n;
        addressMeta.balance.get(input.token).authorities.mint.unlocked -= 1n;
      }
      if (_transaction.default.isMelt(input)) {
        tokenMeta.balance.authorities.melt.unlocked -= 1n;
        addressMeta.balance.get(input.token).authorities.melt.unlocked -= 1n;
      }
    } else {
      tokenMeta.balance.tokens.unlocked -= input.value;
      addressMeta.balance.get(input.token).tokens.unlocked -= input.value;
    }

    // save address and token metadata
    await store.editTokenMeta(input.token, tokenMeta);
    await store.editAddressMeta(input.decoded.address, addressMeta);
  }
  for (const token of txTokens) {
    const tokenMeta = await store.getTokenMeta(token);
    if (tokenMeta === null) continue;
    tokenMeta.numTransactions += 1;
    await store.editTokenMeta(token, tokenMeta);
  }
  for (const address of txAddresses) {
    const addressMeta = await store.getAddressMeta(address);
    if (addressMeta === null) continue;
    addressMeta.numTransactions += 1;
    await store.editAddressMeta(address, addressMeta);
  }
  return {
    maxAddressIndex: maxIndexUsed,
    tokens: txTokens
  };
}

/**
 * Process locked utxo and update the balances.
 * If the utxo is still locked nothing is done.
 *
 * @param {IStorage} storage Storage instance.
 * @param {ILockedUtxo} lockedUtxo The utxo to be unlocked
 * @param {Object} [options]
 * @param {number} [options.rewardLock] The reward lock of the network
 * @param {number} [options.nowTs] The current timestamp
 * @param {number} [options.currentHeight] The current height of the best chain
 * @returns {Promise<void>}
 */
async function processUtxoUnlock(storage, lockedUtxo, {
  rewardLock,
  nowTs,
  currentHeight
} = {}) {
  function getEmptyBalance() {
    return {
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
    };
  }
  const {
    store
  } = storage;
  const {
    tx
  } = lockedUtxo;
  const output = tx.outputs[lockedUtxo.index];
  // Skip data outputs since they do not have an address and do not "belong" in a wallet
  // This shouldn't happen, but we check it just in case
  if (!output.decoded.address) return;
  const isTimelocked = _transaction.default.isOutputLocked(output, {
    refTs: nowTs
  });
  const isHeightLocked = _transaction.default.isHeightLocked(tx.height, currentHeight, rewardLock);
  if (isTimelocked || isHeightLocked) {
    // This utxo is still locked, no need to process it
    return;
  }
  const addressInfo = await store.getAddress(output.decoded.address);
  // if address is not in wallet, ignore
  if (!addressInfo) return;
  const isAuthority = _transaction.default.isAuthorityOutput(output);
  let addressMeta = await store.getAddressMeta(output.decoded.address);
  let tokenMeta = await store.getTokenMeta(output.token);

  // create metadata for address and token if it does not exist
  // This should not happen, but we check so that typescript compiler can guarantee the type
  if (!addressMeta) {
    addressMeta = {
      numTransactions: 0,
      balance: new Map()
    };
  }
  if (!tokenMeta) {
    tokenMeta = {
      numTransactions: 0,
      balance: getEmptyBalance()
    };
  }
  if (!addressMeta.balance.has(output.token)) {
    // Add the current token to the address balance if not present
    addressMeta.balance.set(output.token, getEmptyBalance());
  }

  // update balance
  // The balance for authority outputs is the count of outputs
  // While the balance for non-authority outputs is the sum of the value.
  // Since this is processing a locked utxo that became unlocked we will
  // add the value or count to the unlocked balance and remove it from the locked balance
  if (isAuthority) {
    if (_transaction.default.isMint(output)) {
      // remove from locked balance
      tokenMeta.balance.authorities.mint.locked -= 1n;
      addressMeta.balance.get(output.token).authorities.mint.locked -= 1n;
      // Add to the unlocked balance
      tokenMeta.balance.authorities.mint.unlocked += 1n;
      addressMeta.balance.get(output.token).authorities.mint.unlocked += 1n;
    }
    if (_transaction.default.isMelt(output)) {
      // remove from locked balance
      tokenMeta.balance.authorities.melt.locked -= 1n;
      addressMeta.balance.get(output.token).authorities.melt.locked -= 1n;
      // Add to the unlocked balance
      tokenMeta.balance.authorities.melt.unlocked += 1n;
      addressMeta.balance.get(output.token).authorities.melt.unlocked += 1n;
    }
  } else {
    // remove from locked balance
    tokenMeta.balance.tokens.locked -= output.value;
    addressMeta.balance.get(output.token).tokens.locked -= output.value;
    // Add to the unlocked balance
    tokenMeta.balance.tokens.unlocked += output.value;
    addressMeta.balance.get(output.token).tokens.unlocked += output.value;
  }
  await store.editTokenMeta(output.token, tokenMeta);
  await store.editAddressMeta(output.decoded.address, addressMeta);
  // Remove utxo from locked utxos so that it is not processed again
  await store.unlockUtxo(lockedUtxo);
}