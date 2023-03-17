/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import walletApi from '../../src/api/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import tx_history from '../__fixtures__/tx_history';
import { processHistory } from '../../src/utils/storage';


test('config version', () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const version = {foo: 'bar'};
  storage.setApiVersion(version);
  expect(storage.version).toBe(version);
});

test('store fetch methods', async () => {
  const getTokenApi = jest.spyOn(walletApi, 'getGeneralTokenInfo').mockImplementation((uid, resolve) => {
    resolve({
      success: true,
      name: 'Custom token',
      symbol: 'CTK',
    });
  });
  const store = new MemoryStore();
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveAddress({base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1});
  for (const tx of tx_history) {
    await store.saveTx(tx);
  }
  await processHistory(store);
  const storage = new Storage(store);

  let buf = [];
  for await (const a of storage.getAllAddresses()) {
    buf.push(a);
  }
  expect(buf).toHaveLength(2);
  await expect(storage.getAddressInfo('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ')).resolves.toMatchObject({
    base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
    bip32AddressIndex: 0,
    numTransactions: 2,
    balance: expect.anything(),
  });
  await expect(storage.getAddressAtIndex(1)).resolves.toMatchObject({
    base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    bip32AddressIndex: 1,
  });
  await expect(storage.isAddressMine('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ')).resolves.toBe(true);
  await expect(storage.isAddressMine('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAA')).resolves.toBe(false);

  async function* emptyIter() {}
  const historySpy = jest.spyOn(store, 'historyIter').mockImplementation(emptyIter);
  for await (const _ of storage.txHistory()) { continue };
  expect(historySpy).toHaveBeenCalled();

  await expect(storage.getTx('0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e')).resolves.toBeDefined();

  const tokenSpy = jest.spyOn(store, 'historyIter').mockImplementation(emptyIter);
  for await (const _ of storage.tokenHistory()) { continue };
  expect(tokenSpy).toHaveBeenCalledWith('00');

  getTokenApi.mockRestore();
});