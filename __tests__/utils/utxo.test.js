/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from "bitcore-lib";
import { LevelDBStore, MemoryStore, Storage } from "../../src/storage";
import { bestUtxoSelection, fastUtxoSelection } from "../../src/utils/utxo";

const DATA_DIR = './testdata.leveldb';

describe('bestUtxoSelection', () => {
  const utxos = [
    {
      txId: 'tx1',
      index: 0,
      value: 100,
      token: '00',
      address: 'addr1',
      authorities: 0,
    },
    {
      txId: 'tx2',
      index: 0,
      value: 200,
      token: '00',
      address: 'addr2',
      authorities: 0,
    },
    {
      txId: 'tx3',
      index: 0,
      value: 300,
      token: '00',
      address: 'addr3',
      authorities: 0,
    },
    {
      txId: 'tx4',
      index: 0,
      value: 400,
      token: '01',
      address: 'addr4',
      authorities: 0,
    },
    {
      txId: 'tx5',
      index: 0,
      value: 500,
      token: '01',
      address: 'addr5',
      authorities: 0,
    },
    {
      txId: 'tx6',
      index: 0,
      value: 600,
      token: '01',
      address: 'addr6',
      authorities: 0,
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
    await expect(bestUtxoSelection(storage, '00', 601)).resolves.toMatchObject({ utxos: [], amount: 0 });
    await expect(bestUtxoSelection(storage, '01', 1501)).resolves.toMatchObject({ utxos: [], amount: 0 });

    // Trying to select the available amount will return all utxos of that token
    await expect(bestUtxoSelection(storage, '00', 600)).resolves.toMatchObject({ utxos: [utxos[2], utxos[1], utxos[0]], amount: 600 });
    await expect(bestUtxoSelection(storage, '01', 1500)).resolves.toMatchObject({ utxos: [utxos[5], utxos[4], utxos[3]], amount: 1500 });

    // Trying to select an amount and an utxo with that amount exists will return only that utxo
    await expect(bestUtxoSelection(storage, '00', 100)).resolves.toMatchObject({ utxos: [utxos[0]], amount: 100 });
    await expect(bestUtxoSelection(storage, '00', 200)).resolves.toMatchObject({ utxos: [utxos[1]], amount: 200 });
    await expect(bestUtxoSelection(storage, '00', 300)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(bestUtxoSelection(storage, '01', 400)).resolves.toMatchObject({ utxos: [utxos[3]], amount: 400 });
    await expect(bestUtxoSelection(storage, '01', 500)).resolves.toMatchObject({ utxos: [utxos[4]], amount: 500 });
    await expect(bestUtxoSelection(storage, '01', 600)).resolves.toMatchObject({ utxos: [utxos[5]], amount: 600 });

    // Trying to select an amount that can be fulfilled with 1 utxo will select the smallest utxo that can fulfill it
    await expect(bestUtxoSelection(storage, '00', 101)).resolves.toMatchObject({ utxos: [utxos[1]], amount: 200 });
    await expect(bestUtxoSelection(storage, '00', 201)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(bestUtxoSelection(storage, '01', 300)).resolves.toMatchObject({ utxos: [utxos[3]], amount: 400 });
    await expect(bestUtxoSelection(storage, '01', 401)).resolves.toMatchObject({ utxos: [utxos[4]], amount: 500 });

    // Trying to select an amount that can be fulfilled with 2 utxos will select the smallest number of utxos that can fulfill it
    await expect(bestUtxoSelection(storage, '00', 301)).resolves.toMatchObject({ utxos: [utxos[2], utxos[1]], amount: 500 });
    await expect(bestUtxoSelection(storage, '00', 501)).resolves.toMatchObject({ utxos: [utxos[2], utxos[1], utxos[0]], amount: 600 });
    await expect(bestUtxoSelection(storage, '01', 601)).resolves.toMatchObject({ utxos: [utxos[5], utxos[4]], amount: 1100 });
    await expect(bestUtxoSelection(storage, '01', 1101)).resolves.toMatchObject({ utxos: [utxos[5], utxos[4], utxos[3]], amount: 1500 });
  }

  test('bestUtxoSelection with memory store', async () => {
    const store = new MemoryStore();
    await testBestUtxoSelection(store);
  });

  test('bestUtxoSelection with indexeddb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = crypto.Hash.sha256(xpriv.xpubkey).toString('hex');
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
    await expect(fastUtxoSelection(storage, '00', 601)).resolves.toMatchObject({ utxos: [], amount: 0 });
    await expect(fastUtxoSelection(storage, '01', 1501)).resolves.toMatchObject({ utxos: [], amount: 0 });

    // Trying to select the available amount will return all utxos of that token, sorted by value descending
    await expect(fastUtxoSelection(storage, '00', 600)).resolves.toMatchObject({ utxos: [utxos[2], utxos[1], utxos[0]], amount: 600 });
    await expect(fastUtxoSelection(storage, '01', 1500)).resolves.toMatchObject({ utxos: [utxos[5], utxos[4], utxos[3]], amount: 1500 });

    // Selection will always return the highest utxos first until the amount is fulfilled
    await expect(fastUtxoSelection(storage, '00', 100)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(fastUtxoSelection(storage, '00', 200)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(fastUtxoSelection(storage, '00', 300)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(fastUtxoSelection(storage, '01', 400)).resolves.toMatchObject({ utxos: [utxos[5]], amount: 600 });
    await expect(fastUtxoSelection(storage, '01', 500)).resolves.toMatchObject({ utxos: [utxos[5]], amount: 600 });
    await expect(fastUtxoSelection(storage, '01', 600)).resolves.toMatchObject({ utxos: [utxos[5]], amount: 600 });

    // Trying to select an amount that can be fulfilled with 1 utxo will select the biggest utxo that can fulfill it
    await expect(fastUtxoSelection(storage, '00', 101)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(fastUtxoSelection(storage, '00', 201)).resolves.toMatchObject({ utxos: [utxos[2]], amount: 300 });
    await expect(fastUtxoSelection(storage, '01', 300)).resolves.toMatchObject({ utxos: [utxos[5]], amount: 600 });
    await expect(fastUtxoSelection(storage, '01', 401)).resolves.toMatchObject({ utxos: [utxos[5]], amount: 600 });

    // Trying to select any amount will select the smallest number of utxos that can fulfill it
    // Since we use the highest utxos first, we will always select the highest utxos first
    await expect(fastUtxoSelection(storage, '00', 301)).resolves.toMatchObject({ utxos: [utxos[2], utxos[1]], amount: 500 });
    await expect(fastUtxoSelection(storage, '00', 501)).resolves.toMatchObject({ utxos: [utxos[2], utxos[1], utxos[0]], amount: 600 });
    await expect(fastUtxoSelection(storage, '01', 601)).resolves.toMatchObject({ utxos: [utxos[5], utxos[4]], amount: 1100 });
    await expect(fastUtxoSelection(storage, '01', 1101)).resolves.toMatchObject({ utxos: [utxos[5], utxos[4], utxos[3]], amount: 1500 });
  }

  test('fastUtxoSelection with memory store', async () => {
    const store = new MemoryStore();
    await testFastUtxoSelection(store);
  });

  test('fastUtxoSelection with indexeddb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = crypto.Hash.sha256(xpriv.xpubkey).toString('hex');
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testFastUtxoSelection(store);
  });
});
