/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HATHOR_TOKEN_CONFIG } from "../../../src/constants";
import { LevelDBStore } from "../../../src/storage";
import tx_history from "../../__fixtures__/tx_history";
import walletApi from "../../../src/api/wallet";
import { HDPrivateKey } from "bitcore-lib";
import { encryptData } from "../../../src/utils/crypto";
import { WalletType } from "../../../src/types";
import { processHistory } from "../../../src/utils/storage";

function _addr_index_key(index) {
  const buf = Buffer.alloc(4);
  buf.writeUint32BE(index);
  return buf.toString('hex');
}

const DATA_DIR = './testdata.leveldb';

test('addresses methods', async () => {
  const xpriv = HDPrivateKey();
  const store = new LevelDBStore(DATA_DIR, xpriv.xpubkey);
  const addrBatch = store.addressIndex.addressesDB.batch();
  addrBatch.put('a', { base58: 'a', bip32AddressIndex: 2 });
  addrBatch.put('b', { base58: 'b', bip32AddressIndex: 1 });
  addrBatch.put('c', { base58: 'c', bip32AddressIndex: 3 });
  await addrBatch.write();
  const indexBatch = store.addressIndex.addressesIndexDB.batch();
  indexBatch.put(_addr_index_key(2), 'a');
  indexBatch.put(_addr_index_key(1), 'b');
  indexBatch.put(_addr_index_key(3), 'c');
  await indexBatch.write();
  const metaBatch = store.addressIndex.addressesMetaDB.batch();
  metaBatch.put('a', {numTransactions: 6, balance: {}});
  metaBatch.put('b', {numTransactions: 5, balance: {}});
  await metaBatch.write();

  const values = [];
  for await (const info of store.addressIter()) {
    values.push(info.base58);
  }
  // The order should follow the index ordering
  expect(values).toStrictEqual(['b', 'a', 'c']);

  await expect(store.getAddress('b')).resolves.toStrictEqual({ base58: 'b', bip32AddressIndex: 1 });
  await expect(store.getAddressMeta('b')).resolves.toMatchObject({ numTransactions: 5 });
  await expect(store.addressCount()).resolves.toEqual(3);
  await expect(store.getAddressAtIndex(3)).resolves.toStrictEqual({ base58: 'c', bip32AddressIndex: 3 });

  await expect(store.getCurrentAddress()).rejects.toThrow('Current address is not loaded');
  await expect(store.walletIndex.getCurrentAddressIndex()).resolves.toEqual(-1);
  await expect(store.walletIndex.getLastLoadedAddressIndex()).resolves.toEqual(0);
  await store.saveAddress({
    base58: 'd',
    bip32AddressIndex: 10,
  });
  await expect(store.walletIndex.getCurrentAddressIndex()).resolves.toEqual(10);
  await expect(store.walletIndex.getLastLoadedAddressIndex()).resolves.toEqual(10);
  await store.saveAddress({
    base58: 'e',
    bip32AddressIndex: 11,
  });
  await expect(store.walletIndex.getCurrentAddressIndex()).resolves.toEqual(10);
  await expect(store.walletIndex.getLastLoadedAddressIndex()).resolves.toEqual(11);

  await expect(store.getAddressAtIndex(10)).resolves.toMatchObject({
    base58: 'd',
    bip32AddressIndex: 10,
  });
  await expect(store.addressCount()).resolves.toEqual(5);
  await expect(store.addressExists('e')).resolves.toEqual(true);
  await expect(store.addressExists('f')).resolves.toEqual(false);
  await expect(store.getCurrentAddress()).resolves.toEqual('d');
  await expect(store.getCurrentAddress(true)).resolves.toEqual('d');
  await expect(store.getCurrentAddress()).resolves.toEqual('e');

  // clear database directory
  await store.destroy();
});

test('history methods', async () => {
  const xpriv = HDPrivateKey();
  const store = new LevelDBStore(DATA_DIR, xpriv.xpubkey);
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveAddress({base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1});

  for (const tx of tx_history) {
    await store.saveTx(tx);
  }
  await expect(store.historyCount()).resolves.toEqual(11);
  let txsBuf = [];
  for await (const tx of store.historyIter()) {
    txsBuf.push(tx);
  }
  expect(txsBuf).toHaveLength(11);
  txsBuf = [];
  for await (const tx of store.historyIter('01')) {
    txsBuf.push(tx);
  }
  expect(txsBuf).toHaveLength(2);
  txsBuf = [];

  const txId = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
  await expect(store.getTx(txId)).resolves.toMatchObject({
    tx_id: "0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e",
  });

  await store.setCurrentHeight(11);
  const getTokenApi = jest.spyOn(walletApi, 'getGeneralTokenInfo').mockImplementation((uid, resolve) => {
    resolve({
      success: true,
      name: 'Custom token',
      symbol: 'CTK',
    });
  });
  await processHistory(store, { rewardLock: 1 });
  expect(getTokenApi).not.toHaveBeenCalledWith('00', expect.anything());
  expect(getTokenApi).toHaveBeenCalledWith('01', expect.anything());
  expect(getTokenApi).toHaveBeenCalledWith('02', expect.anything());
  getTokenApi.mockRestore();
  await expect(store.tokenIndex.getTokenMetadata('00')).resolves.toMatchObject({
    numTransactions: 4,
    balance: {
      tokens: { locked: 2, unlocked: 2 },
      authorities: {
        mint: { locked: 0, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    }
  });
  await expect(store.tokenIndex.getTokenMetadata('01')).resolves.toMatchObject({
    numTransactions: 2,
    balance: {
      tokens: { locked: 0, unlocked: 1 },
      authorities: {
        mint: { locked: 1, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    }
  });
  await expect(store.tokenIndex.getTokenMetadata('02')).resolves.toMatchObject({
    numTransactions: 3,
    balance: {
      tokens: { locked: 0, unlocked: 6 },
      authorities: {
        mint: { locked: 0, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    }
  });
  await expect(store.tokenIndex.getTokenMetadata('03')).resolves.toBeNull();
  await expect(store.addressIndex.getAddressMeta('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ')).resolves.toMatchObject({
    numTransactions: 2,
    balance: expect.anything(),
  });
  await expect(store.addressIndex.getAddressMeta('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp')).resolves.toMatchObject({
    numTransactions: 7,
    balance: expect.anything(),
  });
  await expect(store.addressIndex.getAddressMeta('W-invalid-address')).resolves.toBeNull();

  await store.destroy();
});

test('token methods', async () => {
  const xpriv = HDPrivateKey();
  const store = new LevelDBStore(DATA_DIR, xpriv.xpubkey);

  store.tokenIndex.saveToken(HATHOR_TOKEN_CONFIG);

  await store.saveToken({ uid: '01', name: 'Token 01', symbol: 'TK01'});
  let count = 0;
  for await (let _ of store.tokenIndex.tokenDB.iterator()) {
    count += 1;
  }
  expect(count).toEqual(2);
  await expect(store.tokenIndex.getToken('01')).resolves.not.toBeNull();
  await expect(store.tokenIndex.getTokenMetadata('01')).resolves.toBeNull();
  await store.saveToken(
    { uid: '02', name: 'Token 02', symbol: 'TK02'},
    {
      numTransactions: 1,
      balance: {
        tokens: { locked: 1, unlocked: 2 },
        authorities: {
          mint: { locked: 1, unlocked: 2 },
          melt: { locked: 1, unlocked: 2 },
        },
      },
    },
  );
  count = 0;
  for await (let _ of store.tokenIndex.tokenDB.iterator()) {
    count += 1;
  }
  expect(count).toEqual(3);
  await expect(store.tokenIndex.getToken('02')).resolves.not.toBeNull();
  await expect(store.tokenIndex.getTokenMetadata('02')).resolves.not.toBeNull();

  let registered = [];
  for await (const token of store.registeredTokenIter()) {
    registered.push(token);
  }
  expect(registered).toHaveLength(0);

  await store.registerToken({ uid: '02', name: 'Token 02', symbol: 'TK02'});
  await store.registerToken({ uid: '03', name: 'Token 03', symbol: 'TK03'});

  registered = [];
  for await (const token of store.registeredTokenIter()) {
    registered.push(token);
  }
  expect(registered).toHaveLength(2);

  await store.unregisterToken('02');
  registered = [];
  for await (const token of store.registeredTokenIter()) {
    registered.push(token);
  }
  expect(registered).toHaveLength(1);

  await store.editTokenMeta('00', { numTransactions: 10, balance: { tokens: { locked: 1, unlocked: 2 } } });
  await expect(store.tokenIndex.getTokenMetadata('00')).resolves.toMatchObject({
    numTransactions: 10,
    balance: {
      tokens: { locked: 1, unlocked: 2 },
    },
  });

  await store.destroy();
});

test('utxo methods', async () => {
  const dateLocked = new Date('3000-03-01T12:00');

  const xpriv = HDPrivateKey();
  const store = new LevelDBStore(DATA_DIR, xpriv.xpubkey);
  const utxos = [
    {
      txId: 'tx01',
      index: 20,
      token: '00',
      address: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      value: 100,
      authorities: 0,
      timelock: null,
      type: 1,
      height: null,
    },
    {
      txId: 'tx02',
      index: 30,
      token: '02',
      address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      value: 10,
      authorities: 0,
      timelock: null,
      type: 1,
      height: null,
    },
    {
      txId: 'tx03',
      index: 40,
      token: '00',
      address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      value: 100,
      authorities: 0,
      timelock: Math.floor(dateLocked.getTime() / 1000),
      type: 1,
      height: null,
    },
  ];
  for (const u of utxos) {
    await store.saveUtxo(u);
  }
  let buf = [];
  for await (const u of store.utxoIter()) {
    buf.push(u);
  }
  expect(buf).toHaveLength(3);

  // Default values will filter for HTR token
  buf = [];
  for await (const u of store.selectUtxos({})) {
    buf.push(u);
  }
  expect(buf).toHaveLength(2);

  // only_available_utxos should filter locked utxos
  buf = [];
  for await (const u of store.selectUtxos({ only_available_utxos: true })) {
    buf.push(u);
  }
  expect(buf).toHaveLength(1);
  expect(buf[0].txId).toEqual('tx01');

  // Filter for custom token
  buf = [];
  for await (const u of store.selectUtxos({token: '02'})) {
    buf.push(u);
  }
  expect(buf).toHaveLength(1);
  expect(buf[0].txId).toEqual('tx02');

  await store.destroy();
});

test('access data methods', async () => {
  const xpriv = HDPrivateKey();
  const store = new LevelDBStore(DATA_DIR, xpriv.xpubkey);

  const encryptedMain = encryptData(xpriv.xprivkey, '123');
  const accessData = {
    xpubkey: xpriv.xpubkey,
    mainKey: encryptedMain,
    walletFlags: 0,
    walletType: WalletType.P2PKH,
  };

  await expect(store.getAccessData()).rejects.toThrow();
  await store.saveAccessData(accessData);
  await expect(store.getAccessData()).resolves.toMatchObject(accessData);

  await store.walletIndex.setLastUsedAddressIndex(3);
  await store.walletIndex.setLastLoadedAddressIndex(5);
  await store.walletIndex.setCurrentHeight(10000);

  await expect(store.getLastUsedAddressIndex()).resolves.toEqual(3);
  await expect(store.getLastLoadedAddressIndex()).resolves.toEqual(5);
  await expect(store.getCurrentHeight()).resolves.toEqual(10000);
  await store.setCurrentHeight(101000);
  await expect(store.getCurrentHeight()).resolves.toEqual(101000);

  await expect(store.getItem('foo')).resolves.toBeNull();
  await store.setItem('foo', 'bar');
  await expect(store.getItem('foo')).resolves.toEqual('bar');

  let count = 0;
  for await (let _ of store.historyIter()) {
    count += 1;
  }
  expect(count).toEqual(0);
  count = 0;
  for await (let _ of store.addressIter()) {
    count += 1;
  }
  expect(count).toEqual(0);
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveTx(tx_history[0]);
  count = 0;
  for await (let _ of store.historyIter()) {
    count += 1;
  }
  expect(count).toEqual(1);
  count = 0;
  for await (let _ of store.addressIter()) {
    count += 1;
  }
  expect(count).toEqual(1);
  await store.cleanStorage(true, true);
  count = 0;
  for await (let _ of store.historyIter()) {
    count += 1;
  }
  expect(count).toEqual(0);
  count = 0;
  for await (let _ of store.addressIter()) {
    count += 1;
  }
  expect(count).toEqual(0);

  await store.destroy();
});