/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { LevelDBStore, MemoryStore, Storage } from '../../src/storage';
import { bestUtxoSelection, fastUtxoSelection } from '../../src/utils/utxo';
import walletUtils from '../../src/utils/wallet';

const DATA_DIR = './testdata.leveldb';

describe('bestUtxoSelection', () => {
  const utxos = [
    {
      txId: 'tx1',
      index: 0,
      value: 100n,
      token: '00',
      address: 'addr1',
      authorities: 0n,
    },
    {
      txId: 'tx2',
      index: 0,
      value: 200n,
      token: '00',
      address: 'addr2',
      authorities: 0n,
    },
    {
      txId: 'tx3',
      index: 0,
      value: 300n,
      token: '00',
      address: 'addr3',
      authorities: 0n,
    },
    {
      txId: 'tx4',
      index: 0,
      value: 400n,
      token: '01',
      address: 'addr4',
      authorities: 0n,
    },
    {
      txId: 'tx5',
      index: 0,
      value: 500n,
      token: '01',
      address: 'addr5',
      authorities: 0n,
    },
    {
      txId: 'tx6',
      index: 0,
      value: 600n,
      token: '01',
      address: 'addr6',
      authorities: 0n,
    },
  ];

  async function addUtxosToStore(store) {
    for (const utxo of utxos) {
      await store.saveUtxo(utxo);
    }
  }

  /**
   * Should select the best utxos to use in a transaction
   * @param {IStore} store
   */
  async function testBestUtxoSelection(store) {
    await addUtxosToStore(store);
    await store.setCurrentHeight(1);
    const storage = new Storage(store);

    // State of the utxos:
    // 00: 100 + 200 + 300 = 600
    // 01: 400 + 500 + 600 = 1500

    // Trying to select more than available will return no utxos
    await expect(bestUtxoSelection(storage, '00', 601n)).resolves.toMatchObject({
      utxos: [],
      amount: 0n,
    });
    await expect(bestUtxoSelection(storage, '01', 1501n)).resolves.toMatchObject({
      utxos: [],
      amount: 0n,
    });

    // Trying to select the available amount will return all utxos of that token
    const x = await bestUtxoSelection(storage, '00', 600n);
    await expect(bestUtxoSelection(storage, '00', 600n)).resolves.toMatchObject({
      utxos: [utxos[2], utxos[1], utxos[0]],
      amount: 600n,
    });
    await expect(bestUtxoSelection(storage, '01', 1500n)).resolves.toMatchObject({
      utxos: [utxos[5], utxos[4], utxos[3]],
      amount: 1500n,
    });

    // Trying to select an amount and an utxo with that amount exists will return only that utxo
    await expect(bestUtxoSelection(storage, '00', 100n)).resolves.toMatchObject({
      utxos: [utxos[0]],
      amount: 100n,
    });
    await expect(bestUtxoSelection(storage, '00', 200n)).resolves.toMatchObject({
      utxos: [utxos[1]],
      amount: 200n,
    });
    await expect(bestUtxoSelection(storage, '00', 300n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(bestUtxoSelection(storage, '01', 400n)).resolves.toMatchObject({
      utxos: [utxos[3]],
      amount: 400n,
    });
    await expect(bestUtxoSelection(storage, '01', 500n)).resolves.toMatchObject({
      utxos: [utxos[4]],
      amount: 500n,
    });
    await expect(bestUtxoSelection(storage, '01', 600n)).resolves.toMatchObject({
      utxos: [utxos[5]],
      amount: 600n,
    });

    // Trying to select an amount that can be fulfilled with 1 utxo will select the smallest utxo that can fulfill it
    await expect(bestUtxoSelection(storage, '00', 101n)).resolves.toMatchObject({
      utxos: [utxos[1]],
      amount: 200n,
    });
    await expect(bestUtxoSelection(storage, '00', 201n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(bestUtxoSelection(storage, '01', 300n)).resolves.toMatchObject({
      utxos: [utxos[3]],
      amount: 400n,
    });
    await expect(bestUtxoSelection(storage, '01', 401n)).resolves.toMatchObject({
      utxos: [utxos[4]],
      amount: 500n,
    });

    // Trying to select an amount that can be fulfilled with 2 utxos will select the smallest number of utxos that can fulfill it
    await expect(bestUtxoSelection(storage, '00', 301n)).resolves.toMatchObject({
      utxos: [utxos[2], utxos[1]],
      amount: 500n,
    });
    await expect(bestUtxoSelection(storage, '00', 501n)).resolves.toMatchObject({
      utxos: [utxos[2], utxos[1], utxos[0]],
      amount: 600n,
    });
    await expect(bestUtxoSelection(storage, '01', 601n)).resolves.toMatchObject({
      utxos: [utxos[5], utxos[4]],
      amount: 1100n,
    });
    await expect(bestUtxoSelection(storage, '01', 1101n)).resolves.toMatchObject({
      utxos: [utxos[5], utxos[4], utxos[3]],
      amount: 1500n,
    });
  }

  test('bestUtxoSelection with memory store', async () => {
    const store = new MemoryStore();
    await testBestUtxoSelection(store);
  });

  test('bestUtxoSelection with indexeddb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testBestUtxoSelection(store);
  });

  /**
   * Should select the highest utxos until the amount is fulfilled
   * @param {IStore} store
   */
  async function testFastUtxoSelection(store) {
    await addUtxosToStore(store);
    await store.setCurrentHeight(1);
    const storage = new Storage(store);

    // State of the utxos:
    // 00: 100 + 200 + 300 = 600
    // 01: 400 + 500 + 600 = 1500

    // Trying to select more than available will return no utxos
    await expect(fastUtxoSelection(storage, '00', 601n)).resolves.toMatchObject({
      utxos: [],
      amount: 0n,
    });
    await expect(fastUtxoSelection(storage, '01', 1501n)).resolves.toMatchObject({
      utxos: [],
      amount: 0n,
    });

    // Trying to select the available amount will return all utxos of that token, sorted by value descending
    await expect(fastUtxoSelection(storage, '00', 600n)).resolves.toMatchObject({
      utxos: [utxos[2], utxos[1], utxos[0]],
      amount: 600n,
    });
    await expect(fastUtxoSelection(storage, '01', 1500n)).resolves.toMatchObject({
      utxos: [utxos[5], utxos[4], utxos[3]],
      amount: 1500n,
    });

    // Selection will always return the highest utxos first until the amount is fulfilled
    await expect(fastUtxoSelection(storage, '00', 100n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(fastUtxoSelection(storage, '00', 200n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(fastUtxoSelection(storage, '00', 300n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(fastUtxoSelection(storage, '01', 400n)).resolves.toMatchObject({
      utxos: [utxos[5]],
      amount: 600n,
    });
    await expect(fastUtxoSelection(storage, '01', 500n)).resolves.toMatchObject({
      utxos: [utxos[5]],
      amount: 600n,
    });
    await expect(fastUtxoSelection(storage, '01', 600n)).resolves.toMatchObject({
      utxos: [utxos[5]],
      amount: 600n,
    });

    // Trying to select an amount that can be fulfilled with 1 utxo will select the biggest utxo that can fulfill it
    await expect(fastUtxoSelection(storage, '00', 101n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(fastUtxoSelection(storage, '00', 201n)).resolves.toMatchObject({
      utxos: [utxos[2]],
      amount: 300n,
    });
    await expect(fastUtxoSelection(storage, '01', 300n)).resolves.toMatchObject({
      utxos: [utxos[5]],
      amount: 600n,
    });
    await expect(fastUtxoSelection(storage, '01', 401n)).resolves.toMatchObject({
      utxos: [utxos[5]],
      amount: 600n,
    });

    // Trying to select any amount will select the smallest number of utxos that can fulfill it
    // Since we use the highest utxos first, we will always select the highest utxos first
    await expect(fastUtxoSelection(storage, '00', 301n)).resolves.toMatchObject({
      utxos: [utxos[2], utxos[1]],
      amount: 500n,
    });
    await expect(fastUtxoSelection(storage, '00', 501n)).resolves.toMatchObject({
      utxos: [utxos[2], utxos[1], utxos[0]],
      amount: 600n,
    });
    await expect(fastUtxoSelection(storage, '01', 601n)).resolves.toMatchObject({
      utxos: [utxos[5], utxos[4]],
      amount: 1100n,
    });
    await expect(fastUtxoSelection(storage, '01', 1101n)).resolves.toMatchObject({
      utxos: [utxos[5], utxos[4], utxos[3]],
      amount: 1500n,
    });
  }

  test('fastUtxoSelection with memory store', async () => {
    const store = new MemoryStore();
    await testFastUtxoSelection(store);
  });

  test('fastUtxoSelection with indexeddb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testFastUtxoSelection(store);
  });
});
