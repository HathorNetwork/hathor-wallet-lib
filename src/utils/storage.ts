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
  ITokenData,
  TokenVersion,
  IShieldedOutputEntry,
} from '../types';
import walletApi from '../api/wallet';
import helpers from './helpers';
import transactionUtils from './transaction';
import {
  deriveAddressP2PKH,
  deriveAddressP2SH,
  deriveShieldedAddressFromStorage,
  getAddressFromPubkey,
} from './address';
import { processShieldedOutputs } from '../shielded/processing';
import { xpubStreamSyncHistory, manualStreamSyncHistory } from '../sync/stream';
import {
  NATIVE_TOKEN_UID,
  NATIVE_TOKEN_UID_HEX,
  MAX_ADDRESSES_GET,
  LOAD_WALLET_MAX_RETRY,
  LOAD_WALLET_RETRY_SLEEP,
  CREATE_TOKEN_TX_VERSION,
  ON_CHAIN_BLUEPRINTS_VERSION,
} from '../constants';
import { AddressHistorySchema, GeneralTokenInfoSchema } from '../api/schemas/wallet';
import CreateTokenTransaction from '../models/create_token_transaction';
import { DEFAULT_ADDRESS_META } from '../storage/storage';

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
      // This address is already generated, we can skip legacy derivation
      addresses.push(storageAddr.base58);
    } else {
      // derive legacy address at index i
      let address: IAddressInfo;
      if ((await storage.getWalletType()) === 'p2pkh') {
        address = await deriveAddressP2PKH(i, storage);
      } else {
        address = await deriveAddressP2SH(i, storage);
      }
      await storage.saveAddress(address);
      addresses.push(address.base58);
    }

    // Always generate shielded address pair at the same index (if keys are available).
    // Check existence first to avoid "Already have this address" error on re-loads.
    const shieldedResult = await deriveShieldedAddressFromStorage(i, storage);
    if (shieldedResult) {
      if (!(await storage.isAddressMine(shieldedResult.shieldedAddress.base58))) {
        await storage.saveAddress(shieldedResult.shieldedAddress);
      }
      if (!(await storage.isAddressMine(shieldedResult.spendAddress.base58))) {
        await storage.saveAddress(shieldedResult.spendAddress);
      }
      // Only the spend-derived P2PKH is subscribed for tx notifications.
      // The user-facing shielded address (scan+spend pubkeys) is NOT subscribed
      // because the fullnode indexes transactions by on-chain script address,
      // not by the shielded address format.
      addresses.push(shieldedResult.spendAddress.base58);
    }
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
  shouldProcessHistory?: boolean,
  pinCode?: string
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
    await storage.processHistory(pinCode);
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
  storage: IStorage,
  saveTxs: boolean = true
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
          if (saveTxs) {
            await storage.addTx(tx);
          }
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
    case SCANNING_POLICY.SINGLE_ADDRESS:
      return {
        nextIndex: 0,
        count: 1,
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
    case SCANNING_POLICY.SINGLE_ADDRESS:
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
  const { lastLoadedAddressIndex, shieldedLastLoadedAddressIndex, scanPolicyData } =
    await storage.getWalletData();
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
  // If either chain is below the end index, load more.
  // Use min so the lagging chain gets its addresses loaded.
  // Only consider shielded cursor when shielded keys are available.
  const hasShieldedKeys = !!(await storage.getAccessData())?.spendXpubkey;
  const lastLoaded = hasShieldedKeys
    ? Math.min(lastLoadedAddressIndex, shieldedLastLoadedAddressIndex)
    : lastLoadedAddressIndex;
  if (lastLoaded < limits.endIndex) {
    return {
      nextIndex: lastLoaded + 1,
      count: limits.endIndex - lastLoaded,
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
  const {
    lastLoadedAddressIndex,
    lastUsedAddressIndex,
    shieldedLastLoadedAddressIndex,
    shieldedLastUsedAddressIndex,
  } = await storage.getWalletData();
  const scanPolicyData = await storage.getScanningPolicyData();
  if (!isGapLimitScanPolicy(scanPolicyData)) {
    throw new Error(
      'Wallet is configured to use gap-limit but the scan policy data is not configured as gap-limit'
    );
  }
  const { gapLimit } = scanPolicyData;

  // Check both legacy and shielded chains independently.
  const legacyNeedMore = lastUsedAddressIndex + gapLimit > lastLoadedAddressIndex;
  // Only check shielded gap if shielded keys are available (spendXpubkey exists).
  const hasShieldedKeys = !!(await storage.getAccessData())?.spendXpubkey;
  const shieldedNeedMore =
    hasShieldedKeys && shieldedLastUsedAddressIndex + gapLimit > shieldedLastLoadedAddressIndex;

  if (!legacyNeedMore && !shieldedNeedMore) {
    return null;
  }

  // loadAddresses generates both legacy and shielded at each BIP32 index,
  // so we need to satisfy whichever chain is furthest behind.
  // Use the minimum of the two lastLoaded as the starting point, so that
  // the lagging chain gets its addresses loaded.
  const legacyTarget = legacyNeedMore ? lastUsedAddressIndex + gapLimit : lastLoadedAddressIndex;
  let shieldedTarget: number;
  if (!hasShieldedKeys) {
    shieldedTarget = legacyTarget;
  } else if (shieldedNeedMore) {
    shieldedTarget = shieldedLastUsedAddressIndex + gapLimit;
  } else {
    shieldedTarget = shieldedLastLoadedAddressIndex;
  }
  const maxTarget = Math.max(legacyTarget, shieldedTarget);
  const minLastLoaded = hasShieldedKeys
    ? Math.min(lastLoadedAddressIndex, shieldedLastLoadedAddressIndex)
    : lastLoadedAddressIndex;

  const nextIndex = minLastLoaded + 1;
  const count = Math.max(maxTarget - minLastLoaded, 1);

  return { nextIndex, count };
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
  { rewardLock, pinCode }: { rewardLock?: number; pinCode?: string } = {}
): Promise<void> {
  const { store } = storage;
  // We have an additive method to update metadata so we need to clean the current metadata before processing.
  await store.cleanMetadata();

  const nowTs = Math.floor(Date.now() / 1000);
  const currentHeight = await store.getCurrentHeight();

  const tokens = new Set<string>();
  let legacyMaxIndexUsed = -1;
  let shieldedMaxIndexUsed = -1;
  // Iterate on all txs of the history updating the metadata as we go.
  // Order chronologically (oldest first) so that a tx spending a previous tx's
  // shielded UTXO finds that UTXO already saved when the wallet-owned shielded
  // input is resolved (see the UTXO-lookup branch in processNewTx's input
  // enrichment). The store yields newest-first by default for UI purposes;
  // pass `order: 'asc'` so we walk the timeline forward without buffering
  // the entire history into an array first.
  for await (const tx of store.historyIter(undefined, { order: 'asc' })) {
    const processedData = await processNewTx(storage, tx, {
      rewardLock,
      nowTs,
      currentHeight,
      pinCode,
    });
    legacyMaxIndexUsed = Math.max(legacyMaxIndexUsed, processedData.legacyMaxAddressIndex);
    shieldedMaxIndexUsed = Math.max(shieldedMaxIndexUsed, processedData.shieldedMaxAddressIndex);
    for (const token of processedData.tokens) {
      tokens.add(token);
    }
    // After cleanMetadata wipes UTXOs, processNewTx re-saves outputs based on
    // their `spent_by` flag — but the fullnode doesn't always send spent_by
    // set on an output before we've seen the spending tx (especially for
    // shielded txs, where the fullnode updates the origin tx's metadata
    // asynchronously). So we also have to re-apply the per-tx input
    // deletion: for each transparent input, find the origin tx's output
    // that's being spent and delete that UTXO from storage. Without this,
    // processHistory can resurrect a UTXO that was already spent by a
    // later tx and the next send picks it, producing "input already spent"
    // at the fullnode.
    for (const input of tx.inputs) {
      const origTx = await storage.getTx(input.tx_id);
      if (!origTx) continue;
      if (input.index >= origTx.outputs.length) continue; // shielded branch handled elsewhere
      // Resolve the spent output via the sparse-decode-aware helper so the
      // positional `origTx.outputs[input.index]` doesn't mistakenly return
      // a different decoded shielded entry whose `onChainIndex` doesn't
      // match the input's index.
      const output = transactionUtils.findSpentOutput(origTx, input.index);
      if (!output?.decoded?.address) continue;
      if (!(await storage.isAddressMine(output.decoded.address))) continue;
      await store.deleteUtxo({
        txId: input.tx_id,
        index: input.index,
        token: output.token,
        address: output.decoded.address,
        authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0n,
        value: output.value,
        timelock: output.decoded.timelock ?? null,
        type: origTx.version,
        height: origTx.height ?? null,
      });
    }
  }

  // Update wallet data
  await updateWalletMetadataFromProcessedTxData(storage, {
    legacyMaxIndexUsed,
    shieldedMaxIndexUsed,
    tokens,
  });
}

export async function processSingleTx(
  storage: IStorage,
  tx: IHistoryTx,
  { rewardLock, pinCode }: { rewardLock?: number; pinCode?: string } = {}
): Promise<void> {
  const { store } = storage;
  const nowTs = Math.floor(Date.now() / 1000);
  const currentHeight = await store.getCurrentHeight();

  const tokens = new Set<string>();
  const processedData = await processNewTx(storage, tx, {
    rewardLock,
    nowTs,
    currentHeight,
    pinCode,
  });
  const legacyMaxIndexUsed = processedData.legacyMaxAddressIndex;
  const shieldedMaxIndexUsed = processedData.shieldedMaxAddressIndex;
  for (const token of processedData.tokens) {
    tokens.add(token);
  }

  for (const input of tx.inputs) {
    const origTx = await storage.getTx(input.tx_id);
    if (!origTx) {
      // The tx being spent is not from the wallet.
      continue;
    }

    const totalOutputs = origTx.outputs.length + (origTx.shielded_outputs?.length ?? 0);
    if (totalOutputs <= input.index) {
      throw new Error('Spending an unexistent output');
    }

    // Shielded inputs: addTx normalizes shielded entries OUT of origTx.outputs,
    // so input.index targets a position that's no longer in outputs[]. Look up
    // the UTXO directly by {tx_id, index} and delete it. Without this, the
    // wallet's UTXO selector keeps offering the spent shielded UTXO and the
    // next send fails on-chain ("input has already been spent").
    //
    // Delete unconditionally when a UTXO exists at this slot. The
    // structural check above (input.index >= origTx.outputs.length AND
    // totalOutputs > input.index) already proves the slot falls inside
    // parent.shielded_outputs[], so it IS a shielded input regardless of
    // how the local UTXO record happens to be flagged. A previous
    // version gated on `shieldedUtxo?.shielded`, which silently leaked
    // legacy/corrupted records back to the selector.
    // Shielded inputs may reference a slot whose position in
    // origTx.outputs[] differs from the on-chain absolute index (sparse
    // decode). Try an onChainIndex match first; if any shielded entry
    // claims this on-chain index, the input is shielded — delete the
    // shielded UTXO by (txId, on-chain idx). The previous gate
    // `input.index >= origTx.outputs.length` only caught the case where
    // the wallet decoded EVERY shielded output of the parent, missing the
    // sparse-decode case where the wallet's outputs[] still has room at
    // position `input.index` but the entry there isn't the right one.
    const resolved = transactionUtils.findSpentOutput(origTx, input.index);
    const isShieldedSpend =
      input.index >= origTx.outputs.length ||
      (resolved !== undefined && transactionUtils.isShieldedOutputEntry(resolved));
    if (isShieldedSpend) {
      const shieldedUtxo = await storage.getUtxo({
        txId: input.tx_id,
        index: input.index,
      });
      if (shieldedUtxo) {
        await store.deleteUtxo(shieldedUtxo);
      }
      continue;
    }

    const output = resolved;
    if (!output) continue;
    if (!output.decoded?.address) {
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
  await updateWalletMetadataFromProcessedTxData(storage, {
    legacyMaxIndexUsed,
    shieldedMaxIndexUsed,
    tokens,
  });
}

/**
 * Some metadata changed and may need processing.
 * void txs are not treated here.
 * Only idempodent changes should be processed here since this can be called multiple times.
 */
export async function processMetadataChanged(storage: IStorage, tx: IHistoryTx): Promise<void> {
  const { store } = storage;

  for (let index = 0; index < tx.outputs.length; index++) {
    const output = tx.outputs[index];

    if (!output.decoded.address) {
      // Tx is ours but output is not from an address.
      continue;
    }

    if (!(await storage.isAddressMine(output.decoded.address))) {
      // Address is not ours.
      continue;
    }

    if (output.spent_by === null) {
      // Preserve shielded fields and use the on-chain absolute index for
      // shielded entries — same logic as the saveUtxo loop in processNewTx.
      // Without this, a metadata update (first_block confirmation, height
      // change, etc.) overwrites a correctly-saved shielded UTXO with a
      // bare record missing `shielded: true` / `blindingFactor`. The next
      // send then can't compute the excess blinding factor for the
      // unshield path and the fullnode rejects with
      // "full-unshield tx … must carry an unshield balance header".
      const isShielded = transactionUtils.isShieldedOutputEntry(output);
      let utxoIndex = index;
      if (isShielded) {
        const recorded = (output as IShieldedOutputEntry & { onChainIndex?: number }).onChainIndex;
        if (recorded !== undefined) {
          utxoIndex = recorded;
        } else {
          const oc = (output as IShieldedOutputEntry).commitment;
          const shielded = tx.shielded_outputs ?? [];
          const matchIdx = shielded.findIndex(s => s.commitment === oc);
          if (matchIdx >= 0) {
            const transparentLen = tx.outputs.filter(
              o => !transactionUtils.isShieldedOutputEntry(o)
            ).length;
            utxoIndex = transparentLen + matchIdx;
          }
        }
      }
      await store.saveUtxo({
        txId: tx.tx_id,
        index: utxoIndex,
        type: tx.version,
        authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0n,
        address: output.decoded.address,
        token: output.token,
        value: output.value,
        timelock: output.decoded.timelock || null,
        height: tx.height || null,
        ...(isShielded
          ? {
              shielded: true,
              blindingFactor: (output as IShieldedOutputEntry).blindingFactor,
              assetBlindingFactor: (output as IShieldedOutputEntry).assetBlindingFactor,
            }
          : {}),
      });
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index }, false);
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
  ): Promise<
    GeneralTokenInfoSchema | { success: true; name: string; symbol: string; version?: TokenVersion }
  > {
    let retryCount = 0;

    if (uid === NATIVE_TOKEN_UID) {
      const nativeToken = storage.getNativeTokenData();
      return {
        success: true,
        name: nativeToken.name,
        symbol: nativeToken.symbol,
        version: nativeToken.version,
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

      const { name, symbol, version } = response;
      const tokenData: ITokenData = { uid, name, symbol, version: version ?? undefined };

      await storage.addToken(tokenData);
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
  {
    legacyMaxIndexUsed,
    shieldedMaxIndexUsed,
    tokens,
  }: { legacyMaxIndexUsed: number; shieldedMaxIndexUsed: number; tokens: Set<string> }
): Promise<void> {
  const { store } = storage;
  const walletData = await store.getWalletData();

  // Update legacy chain tracking
  if (legacyMaxIndexUsed > -1) {
    if (walletData.lastUsedAddressIndex <= legacyMaxIndexUsed) {
      if (walletData.currentAddressIndex <= legacyMaxIndexUsed) {
        await store.setCurrentAddressIndex(
          Math.min(legacyMaxIndexUsed + 1, walletData.lastLoadedAddressIndex)
        );
      }
      await store.setLastUsedAddressIndex(legacyMaxIndexUsed);
    }
  }

  // Update shielded chain tracking
  if (shieldedMaxIndexUsed > -1) {
    if (walletData.shieldedLastUsedAddressIndex <= shieldedMaxIndexUsed) {
      if (walletData.shieldedCurrentAddressIndex <= shieldedMaxIndexUsed) {
        await store.setCurrentAddressIndex(
          Math.min(shieldedMaxIndexUsed + 1, walletData.shieldedLastLoadedAddressIndex),
          { legacy: false }
        );
      }
      await store.setLastUsedAddressIndex(shieldedMaxIndexUsed, { legacy: false });
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
 * @param {string} [options.pinCode] PIN code for shielded output decryption
 * @returns {Promise<{ legacyMaxAddressIndex: number, shieldedMaxAddressIndex: number, tokens: Set<string> }>}
 */
export async function processNewTx(
  storage: IStorage,
  tx: IHistoryTx,
  {
    rewardLock,
    nowTs,
    currentHeight,
    pinCode,
  }: { rewardLock?: number; nowTs?: number; currentHeight?: number; pinCode?: string } = {}
): Promise<{
  legacyMaxAddressIndex: number;
  shieldedMaxAddressIndex: number;
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

  if (tx.is_voided && tx.nc_id && tx.first_block && tx.nc_seqnum != null) {
    // If a nano transaction is voided but has first block
    // we need to increase the seqnum of the caller address
    if (!tx.nc_address) {
      throw new Error(`Nano contract tx(${tx.tx_id}) with caller address ${tx.nc_address}`);
    }
    const caller = tx.nc_address;
    const callerAddressInfo = await store.getAddress(caller);
    // if address is not in wallet, ignore
    if (callerAddressInfo) {
      // create metadata for address if it does not exist
      let seqnumMeta = await store.getSeqnumMeta(caller);
      if (seqnumMeta == null) {
        seqnumMeta = -1;
      }

      if (tx.nc_seqnum > seqnumMeta) {
        seqnumMeta = tx.nc_seqnum;
      }
      await store.editSeqnumMeta(caller, seqnumMeta);
    }
  }

  // We ignore voided transactions
  if (tx.is_voided)
    return {
      legacyMaxAddressIndex: -1,
      shieldedMaxAddressIndex: -1,
      tokens: new Set(),
    };

  const isHeightLocked = transactionUtils.isHeightLocked(tx.height, currentHeight, rewardLock);
  const txAddresses = new Set<string>();
  const txTokens = new Set<string>();
  let legacyMaxIndexUsed = -1;
  let shieldedMaxIndexUsed = -1;

  // Hydrate transparent input `token` fields from `token_data` using the tx's
  // tokens list. Some fullnode ws payloads omit `token` on inputs (the schema
  // keeps it optional since shielded inputs legitimately don't carry it), and
  // the balance-update input loop below skips inputs whose `token` is
  // undefined. Without this hydration the balance drifts upward on every
  // processHistory cycle: output values get added, input debits get dropped.
  // For create-token txs, token index 1 is the tx's own hash (the token being
  // created), and token index 0 is always the native token (HTR).
  const txTokensArray = tx.version === CREATE_TOKEN_TX_VERSION ? [tx.tx_id] : tx.tokens ?? [];
  for (const input of tx.inputs) {
    if (input.token !== undefined) continue;
    if (input.token_data === undefined) continue;
    if (input.token_data === 0) {
      input.token = NATIVE_TOKEN_UID;
      continue;
    }
    const tokenIdx = input.token_data & 0x7f; // strip TOKEN_AUTHORITY_MASK (0x80)
    if (tokenIdx >= 1 && tokenIdx <= txTokensArray.length) {
      input.token = txTokensArray[tokenIdx - 1];
    }
  }

  // Snapshot the previously-stored copy of this tx (if any) BEFORE any
  // store.saveTx call below overwrites it. Used later to recover enriched
  // shielded-input fields (value/token/token_data) on re-delivery, after the
  // spent UTXO has already been deleted by a prior call.
  const previouslyStoredTx = await store.getTx(tx.tx_id);

  // Decrypt shielded outputs and append decoded entries to tx.outputs BEFORE the main loop.
  // This unifies the processing: the same loop handles transparent + decoded shielded outputs.
  // Skip if already decoded (e.g., processHistory re-processing a previously processed tx).
  const alreadyDecoded = tx.outputs.some(o => transactionUtils.isShieldedOutputEntry(o));
  if (
    !alreadyDecoded &&
    storage.shieldedCryptoProvider &&
    tx.shielded_outputs?.length &&
    pinCode !== undefined
  ) {
    try {
      // Capture transparent output count before appending decoded shielded outputs.
      // result.index from processShieldedOutputs uses this same count as base,
      // so (result.index - transparentCount) gives the shielded_outputs array index.
      const transparentCount = tx.outputs.length;

      const shieldedResults = await processShieldedOutputs(
        storage,
        tx,
        storage.shieldedCryptoProvider,
        pinCode
      );
      for (const result of shieldedResults) {
        const walletTokenUid =
          result.tokenUid === NATIVE_TOKEN_UID_HEX ? NATIVE_TOKEN_UID : result.tokenUid;
        const so = tx.shielded_outputs[result.index - transparentCount];

        // Append decoded shielded output to tx.outputs so the main loop processes it
        // alongside transparent outputs (UTXO creation, balance, metadata).
        //
        // `onChainIndex` carries the actual absolute index the fullnode uses to
        // resolve this output (`transparentCount + shielded_idx`). We need it
        // because the saveUtxo loop iterates `tx.outputs.entries()` positionally
        // — and when only SOME shielded outputs are owned/decoded, the
        // appended-at-the-end position no longer matches the on-chain absolute
        // index. Spending a UTXO indexed by position fails OP_EQUALVERIFY when
        // the fullnode resolves to a different shielded_outputs slot than the
        // one we signed for.
        tx.outputs.push({
          type: 'shielded',
          value: result.decrypted.value,
          token_data: so?.token_data ?? 0,
          script: so?.script ?? '',
          decoded: { ...so?.decoded, address: result.address },
          token: walletTokenUid,
          // Preserve the spent_by the fullnode reported on the parent
          // shielded output. hathor-core's _shielded_output_to_json
          // populates this exactly the same way it does for transparent
          // outputs. Falling back to null when the field is absent
          // (e.g. on sender-local insert before any spend update has
          // arrived) so downstream `output.spent_by !== null` works
          // identically for shielded and transparent.
          spent_by: so?.spent_by ?? null,
          commitment: so?.commitment ?? '',
          range_proof: so?.range_proof ?? '',
          ephemeral_pubkey: so?.ephemeral_pubkey ?? '',
          asset_commitment: so?.asset_commitment,
          surjection_proof: so?.surjection_proof,
          blindingFactor: result.decrypted.blindingFactor.toString('hex'),
          assetBlindingFactor: result.decrypted.assetBlindingFactor?.toString('hex'),
          onChainIndex: result.index,
        } as IShieldedOutputEntry & { onChainIndex: number });
      }
      if (shieldedResults.length > 0) {
        await store.saveTx(tx);
      }
    } catch (e) {
      // processShieldedOutputs handles per-output rewind failures internally.
      // If we get here, something unexpected went wrong at the infrastructure level.
      storage.logger.error(
        'Unexpected error processing shielded outputs for tx',
        tx.tx_id,
        '- wallet may be missing shielded funds.',
        e
      );
    }
  }

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

    // Track the max address index per chain
    if (addressInfo.addressType === 'shielded-spend') {
      if (addressInfo.bip32AddressIndex > shieldedMaxIndexUsed) {
        shieldedMaxIndexUsed = addressInfo.bip32AddressIndex;
      }
    } else if (
      !addressInfo.addressType ||
      addressInfo.addressType === 'p2pkh' ||
      addressInfo.addressType === 'p2sh'
    ) {
      if (addressInfo.bip32AddressIndex > legacyMaxIndexUsed) {
        legacyMaxIndexUsed = addressInfo.bip32AddressIndex;
      }
    }

    // create metadata for address and token if it does not exist
    if (!addressMeta) {
      addressMeta = { ...DEFAULT_ADDRESS_META };
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
      const isShielded = transactionUtils.isShieldedOutputEntry(output);
      // For shielded entries, use the on-chain absolute index. New decodes
      // record `onChainIndex` directly on the appended entry; older cached
      // entries (without onChainIndex) require us to recover it by matching
      // the entry's commitment back to its position in `tx.shielded_outputs`.
      // For transparent entries, the entries() position IS the on-chain index.
      let utxoIndex = index;
      if (isShielded) {
        const recorded = (output as IShieldedOutputEntry & { onChainIndex?: number }).onChainIndex;
        if (recorded !== undefined) {
          utxoIndex = recorded;
        } else {
          // Older cached entries lack `onChainIndex` — recover it by matching
          // commitment back to `tx.shielded_outputs` position.
          const oc = (output as IShieldedOutputEntry).commitment;
          const shielded = tx.shielded_outputs ?? [];
          const matchIdx = shielded.findIndex(s => s.commitment === oc);
          if (matchIdx >= 0) {
            const transparentLen = tx.outputs.filter(
              o => !transactionUtils.isShieldedOutputEntry(o)
            ).length;
            utxoIndex = transparentLen + matchIdx;
          }
        }
      }
      await store.saveUtxo({
        txId: tx.tx_id,
        index: utxoIndex,
        type: tx.version,
        authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0n,
        address: output.decoded.address,
        token: output.token,
        value: output.value,
        timelock: output.decoded.timelock || null,
        height: tx.height || null,
        ...(isShielded
          ? {
              shielded: true,
              blindingFactor: (output as IShieldedOutputEntry).blindingFactor,
              assetBlindingFactor: (output as IShieldedOutputEntry).assetBlindingFactor,
            }
          : {}),
      });
      if (isLocked) {
        // We will save this utxo on the index of locked utxos
        // So that later when it becomes unlocked we can update the balances with processUtxoUnlock
        await store.saveLockedUtxo({ tx, index: utxoIndex });
      }
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index }, false);
    }

    await store.editTokenMeta(output.token, tokenMeta);
    await store.editAddressMeta(output.decoded.address, addressMeta);
  }

  // Shielded inputs arrive from the full node without decoded/value/token —
  // those fields are hidden in the commitment. For inputs that spend a
  // wallet-owned shielded UTXO, recover the decoded fields from the stored
  // UTXO before the main input loop runs. processHistory iterates chronologically
  // (see processHistory in this file) so the origin tx's shielded outputs have
  // already been decoded and their UTXOs saved by the time we reach a tx that
  // spends them.
  //
  // We also delete the spent shielded UTXO here as defense-in-depth. The
  // transparent path tracks spent_by via the on-chain output, so the output
  // loop above naturally skips saveUtxo for spent outputs
  // (`output.spent_by !== null`). Shielded outputs now thread spent_by
  // through the same way (see processNewTx output decode and
  // normalizeShieldedOutputs), so in steady state the same skip applies.
  // But shielded inputs cite their absolute on-chain index and we can't
  // always rely on the parent's spent_by update arriving in the same
  // websocket batch as the spending tx — so the explicit delete below
  // guarantees the spent UTXO is gone before selectUtxos runs again,
  // avoiding the "input has already been spent" failure on the next send.
  // Enrich shielded inputs. On first delivery the spent UTXO still exists in
  // storage — we read value/token/address off it, delete it, and continue. On
  // re-delivery the UTXO is gone, so we fall back to the enriched copy we
  // captured from the pre-save stored tx.
  for (const input of tx.inputs) {
    // Always check for a spent shielded UTXO so we delete it even when the
    // input is already enriched (e.g., from a prior pre-save step in
    // wallet.ts that populated decoded/value/token from the stored tx).
    // Without this, a subsequent re-delivery of the origin tx can re-save
    // its shielded outputs (processMetadataChanged/processSingleTx) and
    // resurrect the spent UTXO — leaving a double-spend trap for the next
    // send.
    const utxo = await storage.getUtxo({ txId: input.tx_id, index: input.index });
    // Detect shielded slot structurally: input.index is shielded iff it
    // points beyond the parent's transparent outputs into the parent's
    // shielded_outputs[] array. This is independent of the local UTXO's
    // `shielded` flag, which a buggy/legacy save might have stripped.
    let isShieldedSlot = !!utxo?.shielded;
    if (!isShieldedSlot) {
      const parentTx = await store.getTx(input.tx_id);
      if (parentTx && input.index >= parentTx.outputs.length) {
        isShieldedSlot = true;
      }
    }
    if (utxo && isShieldedSlot) {
      if (!input.decoded?.address || input.token === undefined) {
        input.decoded = { address: utxo.address };
        input.value = utxo.value;
        input.token = utxo.token;
        input.token_data = 0;
      }
      await store.deleteUtxo(utxo);
      continue;
    }
    if (input.decoded?.address && input.token !== undefined) continue;
    const storedInput = previouslyStoredTx?.inputs?.find(
      i => i.tx_id === input.tx_id && i.index === input.index
    );
    if (storedInput?.decoded?.address && storedInput.token !== undefined) {
      input.decoded = storedInput.decoded;
      input.value = storedInput.value;
      input.token = storedInput.token;
      input.token_data = storedInput.token_data ?? 0;
      continue;
    }
    // Last-resort transparent enrichment: some fullnode ws payloads omit
    // value/token/token_data/decoded on inputs, keeping only {tx_id, index}.
    // Without enrichment the balance-update input loop below would skip this
    // input (`continue` on `input.token === undefined`), leaving outputs
    // credited without a matching debit and causing upward balance drift.
    // Look up the origin tx (already in wallet storage because processHistory
    // iterates chronologically) and recover the output being spent.
    const origTx = await store.getTx(input.tx_id);
    if (!origTx) continue;
    // Sparse-decode-aware lookup. Positional outputs[input.index] would
    // return the wrong entry when the parent has shielded outputs that
    // were only partially decoded — the input would be enriched with the
    // wrong value/token/address and the spending tx's token-meta debit
    // would be off (per-tx delta off by an input's value).
    const origOutput = transactionUtils.findSpentOutput(origTx, input.index);
    if (!origOutput?.decoded?.address) continue;
    if (!(await storage.isAddressMine(origOutput.decoded.address))) continue;
    input.decoded = origOutput.decoded;
    input.value = origOutput.value;
    input.token = origOutput.token;
    input.token_data = origOutput.token_data ?? 0;
  }

  for (const input of tx.inputs) {
    // We ignore data inputs and shielded inputs we don't own. Wallet-owned
    // shielded inputs are enriched above so their decoded/value/token/token_data
    // are populated and flow through this loop like transparent inputs.
    if (!input.decoded?.address || input.token === undefined) continue;

    const addressInfo = await store.getAddress(input.decoded.address);
    // This is not our address, ignore
    if (!addressInfo) continue;

    // At this point input.token is defined (checked above), so all transparent fields exist.
    const isAuthority: boolean = transactionUtils.isAuthorityOutput({
      token_data: input.token_data!,
    });
    let addressMeta = await store.getAddressMeta(input.decoded.address);
    let tokenMeta = await store.getTokenMeta(input.token);

    // Track input address indices per chain
    if (addressInfo.addressType === 'shielded-spend') {
      if (addressInfo.bip32AddressIndex > shieldedMaxIndexUsed) {
        shieldedMaxIndexUsed = addressInfo.bip32AddressIndex;
      }
    } else if (
      !addressInfo.addressType ||
      addressInfo.addressType === 'p2pkh' ||
      addressInfo.addressType === 'p2sh'
    ) {
      if (addressInfo.bip32AddressIndex > legacyMaxIndexUsed) {
        legacyMaxIndexUsed = addressInfo.bip32AddressIndex;
      }
    }

    // create metadata for address and token if it does not exist
    if (!addressMeta) {
      addressMeta = { ...DEFAULT_ADDRESS_META };
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
      if (transactionUtils.isMint({ value: input.value!, token_data: input.token_data! })) {
        tokenMeta.balance.authorities.mint.unlocked -= 1n;
        addressMeta.balance.get(input.token)!.authorities.mint.unlocked -= 1n;
      }
      if (transactionUtils.isMelt({ value: input.value!, token_data: input.token_data! })) {
        tokenMeta.balance.authorities.melt.unlocked -= 1n;
        addressMeta.balance.get(input.token)!.authorities.melt.unlocked -= 1n;
      }
    } else {
      tokenMeta.balance.tokens.unlocked -= input.value!;
      addressMeta.balance.get(input.token)!.tokens.unlocked -= input.value!;
    }

    // save address and token metadata
    await store.editTokenMeta(input.token, tokenMeta);
    await store.editAddressMeta(input.decoded!.address!, addressMeta);
  }

  // Nano contract and ocb transactions have the address used to sign the tx
  // and we must consider this to the address metadata
  // The IHistoryTx object has data from the full node that doesn't have the headers
  // only the nano parameters in the data
  if (tx.nc_id || tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
    let caller: string;
    if (tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
      if (!tx.nc_pubkey) {
        throw new Error(`OnChainBlueprint tx(${tx.tx_id}) with caller pubkey ${tx.nc_pubkey}`);
      }
      const callerAddress = getAddressFromPubkey(tx.nc_pubkey!, storage.config.getNetwork());
      caller = callerAddress.base58;
    } else {
      // This is a nano contract
      if (!tx.nc_address) {
        throw new Error(`Nano contract tx(${tx.tx_id}) with caller address ${tx.nc_address}`);
      }
      caller = tx.nc_address;
    }

    const callerAddressInfo = await store.getAddress(caller);
    // if address is not in wallet, ignore
    if (callerAddressInfo) {
      let addressMeta = await store.getAddressMeta(caller);
      if (!addressMeta) {
        // Save address meta in store, because the caller might be
        // the first transaction for this address
        addressMeta = { ...DEFAULT_ADDRESS_META };
        await store.editAddressMeta(caller, addressMeta);
      }

      txAddresses.add(caller);
    }

    if (callerAddressInfo && tx.nc_id && tx.nc_seqnum != null) {
      // update seqnum metadata if it's bigger
      const seqnumMeta = (await store.getSeqnumMeta(caller)) ?? -1;
      if (tx.nc_seqnum > seqnumMeta) {
        await store.editSeqnumMeta(caller, tx.nc_seqnum);
      }
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
    legacyMaxAddressIndex: legacyMaxIndexUsed,
    shieldedMaxAddressIndex: shieldedMaxIndexUsed,
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
  // Sparse-decode-aware lookup. Positional tx.outputs[lockedUtxo.index]
  // could return the wrong entry on a sparse-decoded parent.
  const output = transactionUtils.findSpentOutput(tx, lockedUtxo.index);
  // Skip data outputs since they do not have an address and do not "belong" in a wallet
  // This shouldn't happen, but we check it just in case
  if (!output?.decoded.address) return;

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
    addressMeta = { ...DEFAULT_ADDRESS_META };
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

/**
 * Extracts the ITokenData from the CreateTokenTransaction instance and save
 * the token on the storage.
 */
export async function addCreatedTokenFromTx(
  tx: CreateTokenTransaction,
  storage: IStorage
): Promise<void> {
  if (tx.version !== CREATE_TOKEN_TX_VERSION) {
    return;
  }

  if (!tx.hash) {
    throw new Error('Cannot infer UID from transaction without hash');
  }

  const tokenInfo: ITokenData = {
    uid: tx.hash,
    name: tx.name,
    symbol: tx.symbol,
    version: tx.tokenVersion,
  };

  await storage.addToken(tokenInfo);
}
