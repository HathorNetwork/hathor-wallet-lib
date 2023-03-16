/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import FullnodeConnection from '../new/connection';
import { IStorage, IAddressInfo, IHistoryTx, IBalance, ITokenMetadata, IAddressMetadata, IUtxo, IStore } from '../types';
import walletApi from '../api/wallet';

import { chunk } from 'lodash';
import axios, { AxiosError, AxiosResponse } from 'axios';
import helpers from '../utils/helpers';
import transactionUtils from '../utils/transaction';
import { deriveAddressP2PKH, deriveAddressP2SH } from '../utils/address';
import { MAX_ADDRESSES_GET, LOAD_WALLET_MAX_RETRY, LOAD_WALLET_RETRY_SLEEP } from '../constants';

/**
 * Derive requested addresses (if not already loaded), save them on storage then return them.
 * @param {number} startIndex Index to start loading addresses
 * @param {number} count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @returns {Promise<stringp[]>} List of loaded addresses in base58
 */
export async function loadAddresses(startIndex: number, count: number, storage: IStorage): Promise<string[]> {
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
    if (await storage.getWalletType() === 'p2pkh') {
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
 * Reload all addresses and transactions from the full node
 * @param {IStorage} storage Storage to be reloaded
 * @param {FullnodeConnection} connection Connection to be used to reload the storage
 * @returns {Promise<void>}
 */
export async function reloadStorage(storage: IStorage, connection: FullnodeConnection) {
  // unsub all addresses
  for await (const address of storage.getAllAddresses()) {
    connection.unsubscribeAddress(address.base58);
  }
  const accessData = await storage.getAccessData();
  if (accessData != null) {
    // Clean entire storage
    await storage.cleanStorage(true, true);
    // Reset access data
    await storage.saveAccessData(accessData);
  }
  return syncHistory(0, await storage.getGapLimit(), storage, connection);
}

/**
 * Fetch the history of the addresses and save it on storage.
 * Optionally process the history after loading it.
 *
 * @param {number} startIndex Index to start loading addresses
 * @param {number} count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @param {FullnodeConnection} connection Connection to the full node
 * @param {boolean} processHistory If we should process the history after loading it.
 */
export async function syncHistory(startIndex: number, count: number, storage: IStorage, connection: FullnodeConnection, processHistory: boolean = false) {
  let itStartIndex = startIndex;
  let itCount = count;
  let foundAnyTx = false;

  while (true) {
    const addresses = await loadAddresses(itStartIndex, itCount, storage);
    // subscribe to addresses
    connection.subscribeAddresses(addresses);
    for await (let gotTx of loadAddressHistory(addresses, storage)) {
      if (gotTx) {
        // This will signal we have found a transaction when syncing the history
        foundAnyTx = true;
      }
      // update UI
      connection.emit('wallet-partial-load-history', {
        addressesFound: storage.store.addressCount(),
        historyLength: storage.store.historyCount(),
      });
    }
    // check gap limit
    const fillGapLimit = await checkGapLimit(storage);
    if (fillGapLimit === null) {
      // gap limit is filled and we can stop loading addresses
      break;
    }
    itStartIndex = fillGapLimit.nextIndex;
    itCount = fillGapLimit.count;
  }
  if (foundAnyTx && processHistory) {
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
export async function *loadAddressHistory(addresses: string[], storage: IStorage): AsyncGenerator<boolean> {
  let foundAnyTx = false;
  // chunkify addresses
  const addressesChunks = chunk(addresses, MAX_ADDRESSES_GET);
  let retryCount = 0;

  for (let i=0; i<addressesChunks.length; i++) {
    let hasMore = true;
    let firstHash: string|null = null;
    let addrsToSearch = addressesChunks[i];

    while (hasMore === true) {
      let response: AxiosResponse<{
        success: true,
        history: IHistoryTx[],
        has_more: boolean,
        first_hash: string,
        first_address: string,
      } | { success: false, message: string }>;
      try {
        response = await walletApi.getAddressHistoryForAwait(addrsToSearch, firstHash);
      } catch(e: any) {
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
        if (err.code === 'ECONNABORTED' && err.response === undefined && err.message.toLowerCase().includes('timeout')) {
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
          firstHash = result.first_hash;
          const addrIndex = addrsToSearch.indexOf(result.first_address);
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
 * Check if the storage has at least `gapLimit` addresses loaded without any transaction.
 * If it doesn't, it will return the next index to load and the number of addresses to fill the gap.
 * @param {IStorage} storage The storage instance
 * @returns {Promise<{nextIndex: number, count: number}|null>}
 */
export async function checkGapLimit(storage: IStorage): Promise<{nextIndex: number, count: number}|null> {
  // check gap limit
  const { lastLoadedAddressIndex, lastUsedAddressIndex, gapLimit } = await storage.getWalletData();
  if ((lastUsedAddressIndex + gapLimit) > lastLoadedAddressIndex) {
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
 * @param {IStore} store IStore instance holding the history to be processed.
 * @param {{rewardLock: number}} [options={}] Use this configuration when processing the storage
 * @async
 * @returns {Promise<void>}
 */
export async function processHistory(store: IStore, { rewardLock }: { rewardLock?: number } = {}): Promise<void> {
  function getEmptyBalance(): IBalance {
    return {
      tokens: { unlocked: 0, locked: 0 },
      authorities: {
        mint: { unlocked: 0, locked: 0 },
        melt: { unlocked: 0, locked: 0 },
      }
    };
  }

  // We have an additive method to update metadata so we need to clean the current metadata before processing.
  await store.cleanMetadata();

  const nowTs = Math.floor(Date.now() / 1000);
  const isTimelocked = (timelock?: number | null) => (!!timelock) && timelock > nowTs;
  const currentHeight = await store.getCurrentHeight();
  const checkRewardLock = (blockHeight?: number) => (!!blockHeight) && (!!rewardLock) && ((blockHeight + rewardLock) < currentHeight);

  const allTokens = new Set<string>();
  let maxIndexUsed = -1;
  // Iterate on all txs of the history updating the metadata as we go
  for await (const tx of store.historyIter()) {
    if (tx.is_voided) {
      // Ignore voided transactions
      continue;
    }
    const txAddresses = new Set<string>();
    const txTokens = new Set<string>();
    const isHeightLocked = checkRewardLock(tx.height);

    for (const [index, output] of tx.outputs.entries()) {
      const isLocked = isTimelocked(output.decoded.timelock) || isHeightLocked;

      // Skip data outputs since they do not have an address and do not "belong" in a wallet
      if (!output.decoded.address) continue;
      const addressInfo = await store.getAddress(output.decoded.address);
      // if address is not in wallet, ignore
      if (!addressInfo) continue;

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
      allTokens.add(output.token);
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
            tokenMeta.balance.authorities.mint.locked += 1;
            addressMeta.balance.get(output.token)!.authorities.mint.locked += 1;
          }
          if (transactionUtils.isMelt(output)) {
            tokenMeta.balance.authorities.melt.locked += 1;
            addressMeta.balance.get(output.token)!.authorities.melt.locked += 1;
          }
        } else {
          if (transactionUtils.isMint(output)) {
            tokenMeta.balance.authorities.mint.unlocked += 1;
            addressMeta.balance.get(output.token)!.authorities.mint.unlocked += 1;
          }
          if (transactionUtils.isMelt(output)) {
            tokenMeta.balance.authorities.melt.unlocked += 1;
            addressMeta.balance.get(output.token)!.authorities.melt.unlocked += 1;
          }
        }
      } else {
        if (isLocked) {
          tokenMeta.balance.tokens.locked += output.value;
          addressMeta.balance.get(output.token)!.tokens.locked += output.value;
        } else {
          tokenMeta.balance.tokens.unlocked += output.value;
          addressMeta.balance.get(output.token)!.tokens.unlocked += output.value;
        }
      }

      // Add utxo to the storage if unspent
      if (output.spent_by === null) {
        await store.saveUtxo({
          txId: tx.tx_id,
          index,
          type: tx.version,
          authorities: transactionUtils.isAuthorityOutput(output) ? output.value : 0,
          address: output.decoded.address,
          token: output.token,
          value: output.value,
          timelock: output.decoded.timelock || null,
          height: tx.height || null,
        });
      }

      await store.editToken(output.token, tokenMeta);
      await store.editAddress(output.decoded.address, addressMeta);
    }
    for (const input of tx.inputs) {
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
      allTokens.add(input.token);

      if (isAuthority) {
        if (transactionUtils.isMint(input)) {
          tokenMeta.balance.authorities.mint.unlocked -= 1;
          addressMeta.balance.get(input.token)!.authorities.mint.unlocked -= 1;
        }
        if (transactionUtils.isMelt(input)) {
          tokenMeta.balance.authorities.melt.unlocked -= 1;
          addressMeta.balance.get(input.token)!.authorities.melt.unlocked -= 1;
        }
      } else {
        tokenMeta.balance.tokens.unlocked -= input.value;
        addressMeta.balance.get(input.token)!.tokens.unlocked -= input.value;
      }

      // save address and token metadata
      await store.editToken(input.token, tokenMeta);
      await store.editAddress(input.decoded.address, addressMeta);
    }

    for (const token of txTokens) {
      const tokenMeta = await store.getTokenMeta(token);
      if (tokenMeta === null) continue;
      tokenMeta.numTransactions += 1;
      await store.editToken(token, tokenMeta);
    }
    for (const address of txAddresses) {
      const addressMeta = await store.getAddressMeta(address);
      if (addressMeta === null) continue;
      addressMeta.numTransactions += 1;
      await store.editAddress(address, addressMeta);
    }
  }

  // maxIndexUsed -1 means we didn't find any address in the transactions
  // so we don't need to update the wallet data
  if (maxIndexUsed > -1) {
    // Update wallet data
    const walletData = await store.getWalletData();
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
  for (const uid of allTokens) {
    const tokenInfo = await store.getToken(uid);
    if (!tokenInfo) {
      // this is a new token, we need to get the token data from api
      const result: {
        success: true;
        name: string;
        symbol: string;
      } | { success: false, message: string } = await new Promise((resolve) => {
        return walletApi.getGeneralTokenInfo(uid, resolve);
      });

      if (!result.success) {
        throw new Error(result.message);
      }

      const { name, symbol } = result;
      const tokenData = { uid, name, symbol };
      // saveToken will ignore the meta and save only the token config
      await store.saveToken(tokenData);
    }
  }
}