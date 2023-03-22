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

test('selecting utxos', async () => {
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

  // Should use the filter_method
  // filter_method returns true if the utxo is acceptable
  // it returns false if we do not want to use the utxo
  const wantedTx = '0000000419625e2587c225fb49f36278c9da681ec05e039125307b8aef3d3d30';
  const options = {
    filter_method: (utxo) => utxo.txId === wantedTx,
  };
  let buf = [];
  for await (const utxo of storage.selectUtxos(options)) {
    buf.push(utxo);
  }
  expect(buf).toHaveLength(1);
  expect(buf[0].txId).toBe(wantedTx);

  getTokenApi.mockRestore();
});

test('utxos selected as inputs', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.utxosSelectedAsInput.set('a-tx-id1:0', true);
  storage.utxosSelectedAsInput.set('a-tx-id2:0', true);

  // Should check if the utxo is selected as input
  await expect(storage.isUtxoSelectedAsInput({ txId: 'a-tx-id1', index: '0' })).resolves.toBe(true);
  await expect(storage.isUtxoSelectedAsInput({ txId: 'a-tx-id2', index: '0' })).resolves.toBe(true);
  await expect(storage.isUtxoSelectedAsInput({ txId: 'a-tx-id3', index: '0' })).resolves.toBe(false);

  // Iterate on all utxos selected as input
  let buf = [];
  for await (const u of storage.utxoSelectedAsInputIter()) {
    buf.push(u);
  }
  expect(buf).toHaveLength(2);
  expect(buf).toContainEqual({ txId: 'a-tx-id1', index: 0 });
  expect(buf).toContainEqual({ txId: 'a-tx-id2', index: 0 });

  const tx = {txId: 'a-tx-id3', outputs: [{ value: 10, token: '00', spent_by: null }] };
  const getTxSpy = jest.spyOn(storage, 'getTx').mockImplementation(async () => tx);
  // no timeout, mark as selected: true
  await storage.utxoSelectAsInput({ txId: 'a-tx-id3', index: 0 }, true);
  expect(storage.utxosSelectedAsInput.get('a-tx-id3:0')).toBe(true);
  // no timeout, mark as selected: false
  await storage.utxoSelectAsInput({ txId: 'a-tx-id3', index: 0 }, false);
  expect(storage.utxosSelectedAsInput.get('a-tx-id3:0')).toBeUndefined();

  // Selecting an utxo with a non existent output will be a no-op
  await storage.utxoSelectAsInput({ txId: 'a-tx-id3', index: 1 }, true);
  expect(storage.utxosSelectedAsInput.get('a-tx-id3:1')).toBeUndefined();
  // Same if transaction is not in the history
  getTxSpy.mockImplementation(async () => null);
  await storage.utxoSelectAsInput({ txId: 'a-tx-id4', index: 0 }, true);
  expect(storage.utxosSelectedAsInput.get('a-tx-id4:0')).toBeUndefined();
  // Or with a spent output
  getTxSpy.mockImplementation(async () => ({txId: 'a-tx-id3', outputs: [{ value: 10, token: '00', spent_by: 'a-tx-id5' }] }));
  await storage.utxoSelectAsInput({ txId: 'a-tx-id3', index: 0 }, true);
  expect(storage.utxosSelectedAsInput.get('a-tx-id3:0')).toBeUndefined();
});
