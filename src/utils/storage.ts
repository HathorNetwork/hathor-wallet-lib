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
  OutputValueType,
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
    return [HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.POLLING_HTTP_API];
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

    // Always generate the shielded address pair at the same BIP32 index (when
    // shielded keys are available). deriveShieldedAddressFromStorage returns
    // null on wallets without scan/spend xpubs, so legacy-only wallets are a
    // no-op here. Check existence first to avoid "Already have this address"
    // errors on re-loads.
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
  const {
    lastLoadedAddressIndex,
    lastUsedAddressIndex,
    shieldedLastLoadedAddressIndex,
    shieldedLastUsedAddressIndex,
  } = await storage.getWalletData();
  const scanPolicyData = await storage.getScanningPolicyData();
  if (!isGapLimitScanPolicy(scanPolicyData)) {
    // This error should never happen, but this enforces scanPolicyData typing
    throw new Error(
      'Wallet is configured to use gap-limit but the scan policy data is not configured as gap-limit'
    );
  }
  const { gapLimit } = scanPolicyData;

  // Check both the legacy and shielded chains independently. loadAddresses
  // derives a legacy + shielded pair at each BIP32 index, so we extend
  // whichever chain is furthest behind its gap. Omitting the shielded chain
  // here silently caps owned shielded-address discovery at the legacy chain's
  // loaded range, so a wallet receiving on shielded indexes beyond the
  // legacy-used range would never load (and thus never decrypt) them.
  const legacyNeedMore = lastUsedAddressIndex + gapLimit > lastLoadedAddressIndex;
  // Only check the shielded gap when shielded keys are available.
  const hasShieldedKeys = !!(await storage.getAccessData())?.spendXpubkey;
  const shieldedNeedMore =
    hasShieldedKeys && shieldedLastUsedAddressIndex + gapLimit > shieldedLastLoadedAddressIndex;

  if (!legacyNeedMore && !shieldedNeedMore) {
    return null;
  }

  // Use the minimum of the two lastLoaded indexes as the starting point so the
  // lagging chain catches up, and extend up to whichever target is furthest.
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
  // Order chronologically (oldest first) so a tx spending a previous tx's
  // shielded UTXO finds the parent already decoded + persisted when the
  // wallet-owned shielded input is enriched (processNewTx's bare-shielded-input
  // lookback). The store yields newest-first by default for UI purposes; pass
  // `order: 'asc'` so we walk the timeline forward without buffering the whole
  // history into memory.
  //
  // No explicit per-tx input-deletion pass is needed: spent UTXOs are not
  // re-saved because processNewTx gates UTXO creation on `spent_by === null`,
  // and the fullnode reliably stamps `spent_by` on both transparent and shielded
  // outputs (to_json_extended), so a spend seen during the walk leaves the
  // parent's UTXO unsaved rather than resurrected.
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

    // SEPARATED model: `input.index` is an absolute on-chain index spanning the
    // transparent outputs then the shielded outputs, so resolve it via the
    // arithmetic resolver rather than a positional `outputs[index]` read — which
    // would wrongly reject (or misread) a shielded input whose index is
    // >= outputs.length.
    const resolved = transactionUtils.resolveSpentOutput(origTx, input.index);
    if (!resolved) {
      throw new Error('Spending an unexistent output');
    }

    if (resolved.kind === 'shielded') {
      // Shielded input: the spent UTXO is keyed by its absolute on-chain index
      // {tx_id, input.index}. Delete it so the selector can't keep offering a
      // spent shielded UTXO (next send would fail "input already spent").
      const shieldedUtxo = await storage.getUtxo({ txId: input.tx_id, index: input.index });
      if (shieldedUtxo) {
        await store.deleteUtxo(shieldedUtxo);
      }
      continue;
    }

    const { output } = resolved;
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
  await updateWalletMetadataFromProcessedTxData(storage, {
    legacyMaxIndexUsed,
    shieldedMaxIndexUsed,
    tokens,
  });
}

/**
 * The shielded-only fields of a saved UTXO: the `shielded` marker plus the
 * blinding factors a later unshield send needs to recompute the excess
 * blinding factor (dropping them makes the fullnode reject the unshield tx).
 * Shared by `creditOutput` and `processMetadataChanged` so the two save sites
 * cannot drift.
 */
function shieldedUtxoSaveFields(o: { blindingFactor?: string; assetBlindingFactor?: string }): {
  shielded: true;
  blindingFactor?: string;
  assetBlindingFactor?: string;
} {
  return {
    shielded: true,
    blindingFactor: o.blindingFactor,
    assetBlindingFactor: o.assetBlindingFactor,
  };
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
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index }, false);
    }
  }

  // Parallel loop over owned shielded outputs (SEPARATED model). A metadata
  // update (first_block confirmation, height change, …) must re-save the
  // shielded UTXO at its absolute on-chain index `T + s` while PRESERVING
  // `shielded: true` + the blinding factors. Dropping the shielded handling
  // here strips those fields on confirmation, so the next unshield send can't
  // compute the excess blinding factor and the fullnode rejects the tx
  // ("full-unshield tx … must carry an unshield balance header"). Owned slots
  // are gated on the decoded marker `value !== undefined`.
  const transparentCount = tx.outputs.length;
  for (const [sIndex, so] of (tx.shielded_outputs ?? []).entries()) {
    if (so.value === undefined) continue;
    const address = so.decoded?.address;
    if (!address) continue;
    if (!(await storage.isAddressMine(address))) continue;

    const onChainIndex = transparentCount + sIndex;
    if ((so.spent_by ?? null) === null) {
      await store.saveUtxo({
        txId: tx.tx_id,
        index: onChainIndex,
        type: tx.version,
        authorities: transactionUtils.isAuthorityOutput({
          token_data: so.token_data ?? 0,
        })
          ? so.value
          : 0n,
        address,
        token: so.token ?? NATIVE_TOKEN_UID,
        value: so.value,
        timelock: so.decoded?.timelock || null,
        height: tx.height || null,
        ...shieldedUtxoSaveFields(so),
      });
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index: onChainIndex })) {
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index: onChainIndex }, false);
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
  // Update wallet data
  const walletData = await store.getWalletData();

  // Update the legacy chain tracking
  if (legacyMaxIndexUsed > -1) {
    // If legacyMaxIndexUsed is -1 it means we didn't find any tx, so we don't need to update the wallet data
    if (walletData.lastUsedAddressIndex <= legacyMaxIndexUsed) {
      if (walletData.currentAddressIndex <= legacyMaxIndexUsed) {
        await store.setCurrentAddressIndex(
          Math.min(legacyMaxIndexUsed + 1, walletData.lastLoadedAddressIndex)
        );
      }
      await store.setLastUsedAddressIndex(legacyMaxIndexUsed);
    }
  }

  // Update the shielded chain tracking. Without this the wallet's shielded
  // gap-limit never advances and owned shielded addresses beyond the gap are
  // never loaded/decrypted.
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
 * @param {string} [options.pinCode] PIN code for shielded-output decryption
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

  /**
   * Per-output processing body shared by the transparent output loop and the
   * owned-shielded output loop. Performs: balance credit (locked/unlocked,
   * authority mint/melt accounting), per-chain max-index advance, address +
   * token metadata creation, txTokens/txAddresses tracking (drives
   * numTransactions), UTXO save gated on `spent_by === null` (with shielded
   * flag + blinding factors for shielded outputs), locked-UTXO save, and the
   * spent → `utxoSelectAsInput(false)` cleanup.
   *
   * @param output The output to credit. For transparent outputs this is the
   *   `ITransparentOutput`; for owned shielded outputs it is the in-place
   *   decoded `IHistoryShieldedOutput` (value/token/decoded/blindingFactor set).
   * @param onChainIndex The absolute on-chain index of the output. For
   *   transparent outputs this is the position in `tx.outputs[]`; for shielded
   *   outputs it is `tx.outputs.length + sIndex`.
   * @param isShielded Whether the output is a (decoded, owned) shielded output.
   */
  async function creditOutput(
    output: {
      value: OutputValueType;
      token: string;
      token_data?: number;
      decoded: { address?: string; timelock?: number | null };
      spent_by?: string | null;
      blindingFactor?: string;
      assetBlindingFactor?: string;
    },
    onChainIndex: number,
    isShielded: boolean
  ): Promise<void> {
    // Skip data outputs since they do not have an address and do not "belong" in a wallet
    const { address } = output.decoded;
    if (!address) return;
    const addressInfo = await store.getAddress(address);
    // if address is not in wallet, ignore
    if (!addressInfo) return;

    // Check if this output is locked
    const isLocked = transactionUtils.isOutputLocked(output, { refTs: nowTs }) || isHeightLocked;

    const isAuthority: boolean = transactionUtils.isAuthorityOutput({
      token_data: output.token_data ?? 0,
    });
    let addressMeta = await store.getAddressMeta(address);
    let tokenMeta = await store.getTokenMeta(output.token);

    // Track the max address index per chain. The shielded chain tracking is
    // essential: omitting it caps owned shielded-address discovery at the
    // legacy gap limit, so funds received on shielded indexes beyond the gap
    // are never re-loaded and never decrypted.
    if (addressInfo.addressType === 'shielded-spend') {
      if (addressInfo.bip32AddressIndex > shieldedMaxIndexUsed) {
        shieldedMaxIndexUsed = addressInfo.bip32AddressIndex;
      }
    } else if (addressInfo.bip32AddressIndex > legacyMaxIndexUsed) {
      // Legacy chain: undefined addressType (pre-shielded wallets), 'p2pkh' or 'p2sh'.
      legacyMaxIndexUsed = addressInfo.bip32AddressIndex;
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
    txAddresses.add(address);

    // calculate balance
    // The balance for authority outputs is the count of outputs
    // While the balance for non-authority outputs is the sum of the value.
    // The balance will also be split into unlocked and locked.
    // We will update both the address and token metadata separately.
    const isMint = transactionUtils.isMint({
      value: output.value,
      token_data: output.token_data ?? 0,
    });
    const isMelt = transactionUtils.isMelt({
      value: output.value,
      token_data: output.token_data ?? 0,
    });
    if (isAuthority) {
      if (isLocked) {
        if (isMint) {
          tokenMeta.balance.authorities.mint.locked += 1n;
          addressMeta.balance.get(output.token)!.authorities.mint.locked += 1n;
        }
        if (isMelt) {
          tokenMeta.balance.authorities.melt.locked += 1n;
          addressMeta.balance.get(output.token)!.authorities.melt.locked += 1n;
        }
      } else {
        if (isMint) {
          tokenMeta.balance.authorities.mint.unlocked += 1n;
          addressMeta.balance.get(output.token)!.authorities.mint.unlocked += 1n;
        }
        if (isMelt) {
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
    if ((output.spent_by ?? null) === null) {
      await store.saveUtxo({
        txId: tx.tx_id,
        index: onChainIndex,
        type: tx.version,
        authorities: isAuthority ? output.value : 0n,
        address,
        token: output.token,
        value: output.value,
        timelock: output.decoded.timelock || null,
        height: tx.height || null,
        // Preserve the shielded marker + blinding factors so a later unshield
        // send can recompute the excess blinding factor. Dropping these makes
        // the fullnode reject the unshield tx.
        ...(isShielded ? shieldedUtxoSaveFields(output) : {}),
      });
      if (isLocked) {
        // We will save this utxo on the index of locked utxos
        // So that later when it becomes unlocked we can update the balances with processUtxoUnlock
        await store.saveLockedUtxo({ tx, index: onChainIndex });
      }
    } else if (await storage.isUtxoSelectedAsInput({ txId: tx.tx_id, index: onChainIndex })) {
      // If the output is spent we remove it from the utxos selected_as_inputs if it's there
      await storage.utxoSelectAsInput({ txId: tx.tx_id, index: onChainIndex }, false);
    }

    await store.editTokenMeta(output.token, tokenMeta);
    await store.editAddressMeta(address, addressMeta);
  }

  // Decrypt wallet-owned shielded outputs IN PLACE before the output loops so
  // the owned-shielded loop can credit them. Skip when already decoded (e.g.
  // processHistory re-running on a previously decoded tx) — the gate is
  // `shielded_outputs.some(value !== undefined)`, the SEPARATED decoded marker.
  const alreadyDecoded = (tx.shielded_outputs ?? []).some(so => so.value !== undefined);
  if (
    !alreadyDecoded &&
    storage.shieldedCryptoProvider &&
    tx.shielded_outputs?.length &&
    pinCode !== undefined
  ) {
    try {
      const decoded = await processShieldedOutputs(
        storage,
        tx,
        storage.shieldedCryptoProvider,
        pinCode
      );
      if (decoded.length > 0) {
        // Persist the in-place decoded fields so later reads (getTxBalance,
        // re-processing) see the owned-marker fields without re-decrypting.
        await store.saveTx(tx);
      }
    } catch (e) {
      // processShieldedOutputs handles per-output rewind failures internally.
      // Reaching here means something unexpected went wrong at the
      // infrastructure level.
      storage.logger.error(
        'Unexpected error processing shielded outputs for tx',
        tx.tx_id,
        '- wallet may be missing shielded funds.',
        e
      );
    }
  }

  // Transparent outputs: on-chain index === position in tx.outputs[].
  for (const [index, output] of tx.outputs.entries()) {
    await creditOutput(output, index, false);
  }

  // Owned shielded outputs: credit each decoded slot at its absolute on-chain
  // index `T + s`. Non-owned/undecoded slots (value === undefined) are skipped
  // — the single ownership gate.
  const transparentCount = tx.outputs.length;
  for (const [sIndex, so] of (tx.shielded_outputs ?? []).entries()) {
    if (so.value === undefined) continue;
    await creditOutput(
      { ...so, value: so.value, token: so.token ?? NATIVE_TOKEN_UID },
      transparentCount + sIndex,
      true
    );
  }

  for (const input of tx.inputs) {
    // Inputs spending shielded outputs carry no transparent fields
    // (value/token/decoded are hidden in commitments). Their balance
    // handling lands with the receive pipeline in the next PR; here we
    // only need the type-level guard so transparent processing narrows.
    if (
      input.value === undefined ||
      input.token === undefined ||
      input.token_data === undefined ||
      input.decoded === undefined
    ) {
      continue;
    }
    // We ignore data inputs since they do not have an address
    if (!input.decoded.address) continue;

    const addressInfo = await store.getAddress(input.decoded.address);
    // This is not our address, ignore
    if (!addressInfo) continue;

    const isAuthority: boolean = transactionUtils.isAuthorityOutput({
      token_data: input.token_data,
    });
    let addressMeta = await store.getAddressMeta(input.decoded.address);
    let tokenMeta = await store.getTokenMeta(input.token);

    // We also check the index of the input addresses, but they should have
    // been processed as outputs of another transaction. Track per chain.
    if (addressInfo.addressType === 'shielded-spend') {
      if (addressInfo.bip32AddressIndex > shieldedMaxIndexUsed) {
        shieldedMaxIndexUsed = addressInfo.bip32AddressIndex;
      }
    } else if (addressInfo.bip32AddressIndex > legacyMaxIndexUsed) {
      legacyMaxIndexUsed = addressInfo.bip32AddressIndex;
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
      if (transactionUtils.isMint({ value: input.value, token_data: input.token_data })) {
        tokenMeta.balance.authorities.mint.unlocked -= 1n;
        addressMeta.balance.get(input.token)!.authorities.mint.unlocked -= 1n;
      }
      if (transactionUtils.isMelt({ value: input.value, token_data: input.token_data })) {
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
  // Resolve via the SEPARATED-model arithmetic resolver so a locked shielded
  // UTXO (on-chain index `T + s` >= outputs.length) lands on the right
  // shielded_outputs[] slot instead of an out-of-bounds positional read.
  const resolved = transactionUtils.resolveSpentOutput(tx, lockedUtxo.index);
  if (!resolved) return;
  const resolvedOutput = resolved.output;
  // Normalize to the fields used below. Owned shielded outputs carry
  // value/token only after decryption (value !== undefined); a non-owned slot
  // has nothing to unlock for us. Default token to native + token_data to 0.
  if (resolvedOutput.value === undefined) return;
  const output = {
    value: resolvedOutput.value,
    token: resolvedOutput.token ?? NATIVE_TOKEN_UID,
    token_data: resolvedOutput.token_data ?? 0,
    decoded: resolvedOutput.decoded,
  };
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
