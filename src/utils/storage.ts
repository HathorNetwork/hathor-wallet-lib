/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { chunk } from 'lodash';
import axios, { AxiosError, AxiosResponse } from 'axios';

import FullnodeConnection from '../new/connection';
import {
  IStorage,
  IAddressInfo,
  IHistoryTx,
  IBalance,
  ILockedUtxo,
  isGapLimitScanPolicy,
  IScanPolicyLoadAddresses,
  isIndexLimitScanPolicy,
  SCANNING_POLICY,
  HistorySyncMode,
  HistorySyncFunction,
  WalletType,
  IUtxo,
} from '../types';
import walletApi from '../api/wallet';
import helpers from './helpers';
import transactionUtils from './transaction';
import { deriveAddressP2PKH, deriveAddressP2SH, getAddressFromPubkey } from './address';
import { xpubStreamSyncHistory, manualStreamSyncHistory } from '../sync/stream';
import {
  NATIVE_TOKEN_UID,
  MAX_ADDRESSES_GET,
  NANO_CONTRACTS_VERSION,
  LOAD_WALLET_MAX_RETRY,
  LOAD_WALLET_RETRY_SLEEP,
} from '../constants';
import { AddressHistorySchema, GeneralTokenInfoSchema } from '../api/schemas/wallet';

/**
 * Get history sync method for a given mode
 * @param {HistorySyncMode} mode The mode of the stream
 * @returns {HistorySyncFunction}
 */
export function getHistorySyncMethod(mode: HistorySyncMode): HistorySyncFunction {
  switch (mode) {
    case HistorySyncMode.MANUAL_STREAM_WS:
      return manualStreamSyncHistory;
    case HistorySyncMode.XPUB_STREAM_WS:
      return xpubStreamSyncHistory;
    case HistorySyncMode.POLLING_HTTP_API:
    default:
      return apiSyncHistory;
  }
}

export async function getSupportedSyncMode(storage: IStorage): Promise<HistorySyncMode[]> {
  const walletType = await storage.getWalletType();
  if (walletType === WalletType.P2PKH) {
    return [
      HistorySyncMode.MANUAL_STREAM_WS,
      HistorySyncMode.POLLING_HTTP_API,
      HistorySyncMode.XPUB_STREAM_WS,
    ];
  }
  if (walletType === WalletType.MULTISIG) {
    return [HistorySyncMode.POLLING_HTTP_API];
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
export async function loadAddresses(
  startIndex: number,
  count: number,
  storage: IStorage
): Promise<string[]> {
  const addresses: string[] = [];
  const stopIndex = startIndex + count;
  for (let i = startIndex; i < stopIndex; i++) {
    const storageAddr = await storage.getAddressAtIndex(i);
    if (storageAddr !== null) {
      // This address is already generated, we can skip derivation
      addresses.push(storageAddr.base58);
      continue;
    }
    // derive address at index i
    let address: IAddressInfo;
    if ((await storage.getWalletType()) === 'p2pkh') {
      address = await deriveAddressP2PKH(i, storage);
    } else {
      address = await deriveAddressP2SH(i, storage);
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
export async function apiSyncHistory(
  startIndex: number,
  count: number,
  storage: IStorage,
  connection: FullnodeConnection,
  shouldProcessHistory: boolean = false
) {
  let itStartIndex = startIndex;
  let itCount = count;
  let foundAnyTx = false;

  while (true) {
    const addresses = await loadAddresses(itStartIndex, itCount, storage);
    // subscribe to addresses
    connection.subscribeAddresses(addresses);
    for await (const gotTx of loadAddressHistory(addresses, storage)) {
      if (gotTx) {
        // This will signal we have found a transaction when syncing the history
        foundAnyTx = true;
      }
      // update UI
      connection.emit('wallet-load-partial-update', {
        addressesFound: await storage.store.addressCount(),
        historyLength: await storage.store.historyCount(),
      });
    }

    // Check if we need to load more addresses from the address scanning policy
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
export async function* loadAddressHistory(
  addresses: string[],
  storage: IStorage
): AsyncGenerator<boolean> {
  let foundAnyTx = false;
  // chunkify addresses
  const addressesChunks = chunk(addresses, MAX_ADDRESSES_GET);
  let retryCount = 0;

  for (let i = 0; i < addressesChunks.length; i++) {
    let hasMore = true;
    let firstHash: string | null = null;
    let addrsToSearch = addressesChunks[i];

    while (hasMore === true) {
      let response: AxiosResponse<AddressHistorySchema>;
      try {
        response = await walletApi.getAddressHistoryForAwait(addrsToSearch, firstHash);
      } catch (e: unknown) {
        if (!axios.isAxiosError(e)) {
          // We only treat AxiosError
          throw e;
        }
        const err = e as AxiosError;
        // We will retry the request that fails with client timeout
        // in this request error we don't have the response because
        // the client closed the connection
        //
        // There are some error reports about it (https://github.com/axios/axios/issues/2716)
        // Besides that, there are some problems happening in newer axios versions (https://github.com/axios/axios/issues/2710)
        // One user that opened a PR for axios said he is checking the timeout error with the message includes condition
        // https://github.com/axios/axios/pull/2874#discussion_r403753852
        if (
          err.code === 'ECONNABORTED' &&
          err.response === undefined &&
          err.message.toLowerCase().includes('timeout')
        ) {
          // in this case we retry
          continue;
        }

        if (retryCount > LOAD_WALLET_MAX_RETRY) {
          throw e;
        }

        retryCount++;
        await helpers.sleep(LOAD_WALLET_RETRY_SLEEP);
        continue;
      }
      // Request has succeeded, reset retry count
      retryCount = 0;
      const result = response.data;

      if (result.success) {
        for (const tx of result.history) {
          foundAnyTx = true;
          await storage.addTx(tx);
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
}

/**
 * Get the starting addresses to load from the scanning policy
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses>}
 */
export async function scanPolicyStartAddresses(
  storage: IStorage
): Promise<IScanPolicyLoadAddresses> {
  const scanPolicy = await storage.getScanningPolicy();
  let limits;
  switch (scanPolicy) {
    case SCANNING_POLICY.INDEX_LIMIT:
      limits = await storage.getIndexLimit();
      if (!limits) {
        // This should not happen but it enforces the limits type
        throw new Error('Index limit is not configured');
      }
      return {
        nextIndex: limits.startIndex,
        count: limits.endIndex - limits.startIndex + 1,
      };
    case SCANNING_POLICY.GAP_LIMIT:
    default:
      return {
        nextIndex: 0,
        count: await storage.getGapLimit(),
      };
  }
}

/**
 * Use the correct method for the configured address scanning policy to check if we should
 * load more addresses
 * @param {IStorage} storage The storage instance
 * @returns {Promise<IScanPolicyLoadAddresses|null>}
 */
export async function checkScanningPolicy(
  storage: IStorage
): Promise<IScanPolicyLoadAddresses | null> {
  const scanPolicy = await storage.getScanningPolicy();
  switch (scanPolicy) {
    case SCANNING_POLICY.INDEX_LIMIT:
      return checkIndexLimit(storage);
    case SCANNING_POLICY.GAP_LIMIT:
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
export async function checkIndexLimit(storage: IStorage): Promise<IScanPolicyLoadAddresses | null> {
  if ((await storage.getScanningPolicy()) !== SCANNING_POLICY.INDEX_LIMIT) {
    // Since the wallet is not configured to use index-limit this is a no-op
    return null;
  }
  const { lastLoadedAddressIndex, scanPolicyData } = await storage.getWalletData();
  if (!isIndexLimitScanPolicy(scanPolicyData)) {
    // This error should never happen, but this enforces scanPolicyData typing
    throw new Error(
      'Wallet is configured to use index-limit but the scan policy data is not configured as index-limit'
    );
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
      count: limits.endIndex - lastLoadedAddressIndex,
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
export async function checkGapLimit(storage: IStorage): Promise<IScanPolicyLoadAddresses | null> {
  if ((await storage.getScanningPolicy()) !== SCANNING_POLICY.GAP_LIMIT) {
    // Since the wallet is not configured to use gap-limit this is a no-op
    return null;
  }
  // check gap limit
  const { lastLoadedAddressIndex, lastUsedAddressIndex } = await storage.getWalletData();
  const scanPolicyData = await storage.getScanningPolicyData();
  if (!isGapLimitScanPolicy(scanPolicyData)) {
    // This error should never happen, but this enforces scanPolicyData typing
    throw new Error(
      'Wallet is configured to use gap-limit but the scan policy data is not configured as gap-limit'
    );
  }
  const { gapLimit } = scanPolicyData;
  if (lastUsedAddressIndex + gapLimit > lastLoadedAddressIndex) {
    // we need to generate more addresses to fill the gap limit
    return {
      nextIndex: lastLoadedAddressIndex + 1,
      count: lastUsedAddressIndex + gapLimit - lastLoadedAddressIndex,
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
export async function processHistory(
  storage: IStorage,
  { rewardLock }: { rewardLock?: number } = {}
): Promise<void> {
  const { store } = storage;
  // We have an additive method to update metadata so we need to clean the current metadata before processing.
  await store.cleanMetadata();

  const nowTs = Math.floor(Date.now() / 1000);
  const currentHeight = await store.getCurrentHeight();

  const tokens = new Set<string>();
  let maxIndexUsed = -1;
  // Iterate on all txs of the history updating the metadata as we go
  for await (const tx of store.historyIter()) {
    const processedData = await processNewTx(storage, tx, { rewardLock, nowTs, currentHeight });
    maxIndexUsed = Math.max(maxIndexUsed, processedData.maxAddressIndex);
    for (const token of processedData.tokens) {
      tokens.add(token);
    }
  }

  // Update wallet data
  await updateWalletMetadataFromProcessedTxData(storage, { maxIndexUsed, tokens });
}

export async function processSingleTx(
  storage: IStorage,
  tx: IHistoryTx,
  { rewardLock }: { rewardLock?: number } = {}
): Promise<void> {
  const { store } = storage;
  const nowTs = Math.floor(Date.now() / 1000);
  const currentHeight = await store.getCurrentHeight();

  const tokens = new Set<string>();
  const processedData = await processNewTx(storage, tx, { rewardLock, nowTs, currentHeight });
  const maxIndexUsed = processedData.maxAddressIndex;
  for (const token of processedData.tokens) {
    tokens.add(token);
  }

  for (const input of tx.inputs) {
    const origTx = await storage.getTx(input.tx_id);
    if (!origTx) {
      // The tx being spent is not from the wallet.
      continue;
    }

    if (origTx.outputs.length <= input.index) {
      throw new Error('Spending an unexistent output');
    }

    const output = origTx.outputs[input.index];
    if (!output.decoded.address) {
      // Tx is ours but output is not from an address.
      continue;
    }

    if (!(await storage.isAddressMine(output.decoded.address))) {
      // Address is not ours.
      continue;
    }

    // Now we get the utxo object to be deleted from the store
    const utxo: IUtxo = {
      txId: input.tx_id,
      index: input.index,
      token: output.token,
      address: output.decoded.address,
      authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0n,
      value: output.value,
      timelock: output.decoded?.timelock ?? null,
      type: origTx.version,
      height: origTx.height ?? null,
    };

    // Delete utxo
    await store.deleteUtxo(utxo);
  }

  // Update wallet data in the store
  await updateWalletMetadataFromProcessedTxData(storage, { maxIndexUsed, tokens });
}

/**
 * Some metadata changed and may need processing.
 * void txs are not treated here.
 * Only idempodent changes should be processed here since this can be called multiple times.
 */
export async function processMetadataChanged(storage: IStorage, tx: IHistoryTx): Promise<void> {
  const { store } = storage;

  let outputIndex = -1;
  for (const output of tx.outputs) {
    outputIndex++;

    if (!output.decoded.address) {
      // Tx is ours but output is not from an address.
      continue;
    }

    if (!(await storage.isAddressMine(output.decoded.address))) {
      // Address is not ours.
      continue;
    }

    if (output.spent_by === null) {
      await store.saveUtxo({
        txId: tx.tx_id,
        index: outputIndex,
        type: tx.version,
        authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0n,
        address: output.decoded.address,
        token: output.token,
        value: output.value,
        timelock: output.decoded.timelock || null,
        height: tx.height || null,
      });
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index: outputIndex })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index: outputIndex }, false);
    }
  }
}

/**
 * Fetch and save the data of the token set on the storage
 * @param {IStorage} storage - Storage to save the tokens.
 * @param {Set<string>} tokens - set of tokens to fetch and save.
 * @returns {Promise<void>}
 */
export async function _updateTokensData(storage: IStorage, tokens: Set<string>): Promise<void> {
  async function fetchTokenData(
    uid: string
  ): Promise<GeneralTokenInfoSchema | { success: true; name: string; symbol: string }> {
    let retryCount = 0;

    if (uid === NATIVE_TOKEN_UID) {
      const nativeToken = storage.getNativeTokenData();
      return {
        success: true,
        name: nativeToken.name,
        symbol: nativeToken.symbol,
      };
    }

    while (retryCount <= 5) {
      try {
        // Fetch and return the api response
        const result: GeneralTokenInfoSchema = await new Promise((resolve, reject) => {
          walletApi.getGeneralTokenInfo(uid, resolve).catch(err => reject(err));
        });
        return result;
      } catch (err: unknown) {
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

  const { store } = storage;
  for (const uid of tokens) {
    const tokenInfo = await store.getToken(uid);
    if (!tokenInfo) {
      // The only error that can be thrown is 'too many retries'
      const response = await fetchTokenData(uid);

      if (!response.success) {
        throw new Error(response.message);
      }

      const { name, symbol } = response;
      const tokenData = { uid, name, symbol };
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
async function updateWalletMetadataFromProcessedTxData(
  storage: IStorage,
  { maxIndexUsed, tokens }: { maxIndexUsed: number; tokens: Set<string> }
): Promise<void> {
  const { store } = storage;
  // Update wallet data
  const walletData = await store.getWalletData();
  if (maxIndexUsed > -1) {
    // If maxIndexUsed is -1 it means we didn't find any tx, so we don't need to update the wallet data
    if (walletData.lastUsedAddressIndex <= maxIndexUsed) {
      if (walletData.currentAddressIndex <= maxIndexUsed) {
        await store.setCurrentAddressIndex(
          Math.min(maxIndexUsed + 1, walletData.lastLoadedAddressIndex)
        );
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
export async function processNewTx(
  storage: IStorage,
  tx: IHistoryTx,
  {
    rewardLock,
    nowTs,
    currentHeight,
  }: { rewardLock?: number; nowTs?: number; currentHeight?: number } = {}
): Promise<{
  maxAddressIndex: number;
  tokens: Set<string>;
}> {
  function getEmptyBalance(): IBalance {
    return {
      tokens: { unlocked: 0n, locked: 0n },
      authorities: {
        mint: { unlocked: 0n, locked: 0n },
        melt: { unlocked: 0n, locked: 0n },
      },
    };
  }

  const { store } = storage;

  // We ignore voided transactions
  if (tx.is_voided)
    return {
      maxAddressIndex: -1,
      tokens: new Set(),
    };

  const isHeightLocked = transactionUtils.isHeightLocked(tx.height, currentHeight, rewardLock);
  const txAddresses = new Set<string>();
  const txTokens = new Set<string>();
  let maxIndexUsed = -1;

  for (const [index, output] of tx.outputs.entries()) {
    // Skip data outputs since they do not have an address and do not "belong" in a wallet
    if (!output.decoded.address) continue;
    const addressInfo = await store.getAddress(output.decoded.address);
    // if address is not in wallet, ignore
    if (!addressInfo) continue;

    // Check if this output is locked
    const isLocked = transactionUtils.isOutputLocked(output, { refTs: nowTs }) || isHeightLocked;

    const isAuthority: boolean = transactionUtils.isAuthorityOutput(output);
    let addressMeta = await store.getAddressMeta(output.decoded.address);
    let tokenMeta = await store.getTokenMeta(output.token);

    // check if the current address is the highest index used
    // Update the max index used if it is
    if (addressInfo.bip32AddressIndex > maxIndexUsed) {
      maxIndexUsed = addressInfo.bip32AddressIndex;
    }

    // create metadata for address and token if it does not exist
    if (!addressMeta) {
      addressMeta = { numTransactions: 0, balance: new Map<string, IBalance>() };
    }
    if (!tokenMeta) {
      tokenMeta = { numTransactions: 0, balance: getEmptyBalance() };
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
        if (transactionUtils.isMint(output)) {
          tokenMeta.balance.authorities.mint.locked += 1n;
          addressMeta.balance.get(output.token)!.authorities.mint.locked += 1n;
        }
        if (transactionUtils.isMelt(output)) {
          tokenMeta.balance.authorities.melt.locked += 1n;
          addressMeta.balance.get(output.token)!.authorities.melt.locked += 1n;
        }
      } else {
        if (transactionUtils.isMint(output)) {
          tokenMeta.balance.authorities.mint.unlocked += 1n;
          addressMeta.balance.get(output.token)!.authorities.mint.unlocked += 1n;
        }
        if (transactionUtils.isMelt(output)) {
          tokenMeta.balance.authorities.melt.unlocked += 1n;
          addressMeta.balance.get(output.token)!.authorities.melt.unlocked += 1n;
        }
      }
    } else if (isLocked) {
      tokenMeta.balance.tokens.locked += output.value;
      addressMeta.balance.get(output.token)!.tokens.locked += output.value;
    } else {
      tokenMeta.balance.tokens.unlocked += output.value;
      addressMeta.balance.get(output.token)!.tokens.unlocked += output.value;
    }

    // Add utxo to the storage if unspent
    // This is idempotent so it's safe to call it multiple times
    if (output.spent_by === null) {
      await store.saveUtxo({
        txId: tx.tx_id,
        index,
        type: tx.version,
        authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0n,
        address: output.decoded.address,
        token: output.token,
        value: output.value,
        timelock: output.decoded.timelock || null,
        height: tx.height || null,
      });
      if (isLocked) {
        // We will save this utxo on the index of locked utxos
        // So that later when it becomes unlocked we can update the balances with processUtxoUnlock
        await store.saveLockedUtxo({ tx, index });
      }
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index }, false);
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

    const isAuthority: boolean = transactionUtils.isAuthorityOutput(input);
    let addressMeta = await store.getAddressMeta(input.decoded.address);
    let tokenMeta = await store.getTokenMeta(input.token);

    // We also check the index of the input addresses, but they should have been processed as outputs of another transaction.
    if (addressInfo.bip32AddressIndex > maxIndexUsed) {
      maxIndexUsed = addressInfo.bip32AddressIndex;
    }

    // create metadata for address and token if it does not exist
    if (!addressMeta) {
      addressMeta = { numTransactions: 0, balance: new Map<string, IBalance>() };
    }
    if (!tokenMeta) {
      tokenMeta = { numTransactions: 0, balance: getEmptyBalance() };
    }
    if (!addressMeta.balance.has(input.token)) {
      // Add the current token to the address balance if not present
      addressMeta.balance.set(input.token, getEmptyBalance());
    }

    // update counters
    txTokens.add(input.token);
    txAddresses.add(input.decoded.address);

    if (isAuthority) {
      if (transactionUtils.isMint(input)) {
        tokenMeta.balance.authorities.mint.unlocked -= 1n;
        addressMeta.balance.get(input.token)!.authorities.mint.unlocked -= 1n;
      }
      if (transactionUtils.isMelt(input)) {
        tokenMeta.balance.authorities.melt.unlocked -= 1n;
        addressMeta.balance.get(input.token)!.authorities.melt.unlocked -= 1n;
      }
    } else {
      tokenMeta.balance.tokens.unlocked -= input.value;
      addressMeta.balance.get(input.token)!.tokens.unlocked -= input.value;
    }

    // save address and token metadata
    await store.editTokenMeta(input.token, tokenMeta);
    await store.editAddressMeta(input.decoded.address, addressMeta);
  }

  // Nano contract transactions have the address used to sign the tx
  // and we must consider this to the address metadata
  if (tx.version === NANO_CONTRACTS_VERSION) {
    const caller = getAddressFromPubkey(tx.nc_pubkey!, storage.config.getNetwork());
    const callerAddressInfo = await store.getAddress(caller.base58);
    // if address is not in wallet, ignore
    if (callerAddressInfo) {
      // create metadata for address if it does not exist
      let addressMeta = await store.getAddressMeta(caller.base58);
      if (!addressMeta) {
        addressMeta = { numTransactions: 0, balance: new Map<string, IBalance>() };
        await store.editAddressMeta(caller.base58, addressMeta);
      }
      txAddresses.add(caller.base58);
    }
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
    tokens: txTokens,
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
export async function processUtxoUnlock(
  storage: IStorage,
  lockedUtxo: ILockedUtxo,
  {
    rewardLock,
    nowTs,
    currentHeight,
  }: { rewardLock?: number; nowTs?: number; currentHeight?: number } = {}
): Promise<void> {
  function getEmptyBalance(): IBalance {
    return {
      tokens: { unlocked: 0n, locked: 0n },
      authorities: {
        mint: { unlocked: 0n, locked: 0n },
        melt: { unlocked: 0n, locked: 0n },
      },
    };
  }

  const { store } = storage;

  const { tx } = lockedUtxo;
  const output = tx.outputs[lockedUtxo.index];
  // Skip data outputs since they do not have an address and do not "belong" in a wallet
  // This shouldn't happen, but we check it just in case
  if (!output.decoded.address) return;

  const isTimelocked = transactionUtils.isOutputLocked(output, { refTs: nowTs });
  const isHeightLocked = transactionUtils.isHeightLocked(tx.height, currentHeight, rewardLock);
  if (isTimelocked || isHeightLocked) {
    // This utxo is still locked, no need to process it
    return;
  }

  const addressInfo = await store.getAddress(output.decoded.address);
  // if address is not in wallet, ignore
  if (!addressInfo) return;

  const isAuthority: boolean = transactionUtils.isAuthorityOutput(output);
  let addressMeta = await store.getAddressMeta(output.decoded.address);
  let tokenMeta = await store.getTokenMeta(output.token);

  // create metadata for address and token if it does not exist
  // This should not happen, but we check so that typescript compiler can guarantee the type
  if (!addressMeta) {
    addressMeta = { numTransactions: 0, balance: new Map<string, IBalance>() };
  }
  if (!tokenMeta) {
    tokenMeta = { numTransactions: 0, balance: getEmptyBalance() };
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
    if (transactionUtils.isMint(output)) {
      // remove from locked balance
      tokenMeta.balance.authorities.mint.locked -= 1n;
      addressMeta.balance.get(output.token)!.authorities.mint.locked -= 1n;
      // Add to the unlocked balance
      tokenMeta.balance.authorities.mint.unlocked += 1n;
      addressMeta.balance.get(output.token)!.authorities.mint.unlocked += 1n;
    }
    if (transactionUtils.isMelt(output)) {
      // remove from locked balance
      tokenMeta.balance.authorities.melt.locked -= 1n;
      addressMeta.balance.get(output.token)!.authorities.melt.locked -= 1n;
      // Add to the unlocked balance
      tokenMeta.balance.authorities.melt.unlocked += 1n;
      addressMeta.balance.get(output.token)!.authorities.melt.unlocked += 1n;
    }
  } else {
    // remove from locked balance
    tokenMeta.balance.tokens.locked -= output.value;
    addressMeta.balance.get(output.token)!.tokens.locked -= output.value;
    // Add to the unlocked balance
    tokenMeta.balance.tokens.unlocked += output.value;
    addressMeta.balance.get(output.token)!.tokens.unlocked += output.value;
  }

  await store.editTokenMeta(output.token, tokenMeta);
  await store.editAddressMeta(output.decoded.address, addressMeta);
  // Remove utxo from locked utxos so that it is not processed again
  await store.unlockUtxo(lockedUtxo);
}
