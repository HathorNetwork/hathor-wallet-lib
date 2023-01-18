/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import FullnodeConnection from '../new/connection';
import { IStorage, IAddressInfo, IHistoryTx } from '../types';
import walletApi from '../api/wallet';

import _ from 'lodash';
import axios, { AxiosError, AxiosResponse } from 'axios';
import helpers from '../utils/helpers';
import { deriveAddressP2PKH, deriveAddressP2SH } from '../utils/address';

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

export async function reloadStorage(storage: IStorage, connection: FullnodeConnection) {
  // unsub all addresses
  for await (const address of storage.getAllAddresses()) {
    connection.unsubscribeAddress(address.base58);
  }
  const walletData = storage.store
  // clean all data except for accessData
  // optionally end connection
  // setup connection
  // reload from gap-limit
  return syncHistory(0, 20, storage, connection);
}

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

export async function *loadAddressHistory(addresses: string[], storage: IStorage): AsyncGenerator<boolean> {
  let foundAnyTx = false;
  // chunkify addresses
  const addressesChunks = _.chunk(addresses, 20); // FIXME: MAX_ADDRESSES_GET
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

        if (retryCount > 5) { // FIXME: LOAD_WALLET_MAX_RETRY
          throw e;
        }

        retryCount++;
        await helpers.sleep(5000); // FIXME: LOAD_WALLET_RETRY_SLEEP
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

export async function checkGapLimit(storage: IStorage): Promise<{nextIndex: number, count: number}|null> {
  // check gap limit
  const {lastLoadedAddressIndex, lastUsedAddressIndex, gapLimit } = await storage.getWalletData();
  if ((lastUsedAddressIndex + gapLimit) > lastLoadedAddressIndex) {
    // we need to generate more addresses to fill the gap limit
    return {
      nextIndex: lastLoadedAddressIndex + 1,
      count: lastUsedAddressIndex + gapLimit - lastLoadedAddressIndex,
    };
  }
  return null;
}