/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GAP_LIMIT } from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import tx_history from '../__fixtures__/tx_history';
import walletApi from '../../src/api/wallet';
import { HDPrivateKey } from 'bitcore-lib';
import { encryptData } from '../../src/utils/crypto';
import { WalletType } from '../../src/types';
import { processHistory } from '../../src/utils/storage';


test('default values', async () => {
  const store = new MemoryStore();
  expect(store.walletData).toMatchObject({
    lastLoadedAddressIndex: 0,
    lastUsedAddressIndex: -1,
    currentAddressIndex: -1,
    bestBlockHeight: 0,
    scanPolicyData: {
      policy: 'gap-limit',
      gapLimit: GAP_LIMIT,
    },
  });
});

test('addresses methods', async () => {
  const store = new MemoryStore();
  store.addresses.set('a', 2);
  store.addressIndexes.set(2, 'a');
  store.addresses.set('b', 1);
  store.addressIndexes.set(1, 'b');
  store.addresses.set('c', 3);
  store.addressIndexes.set(3, 'c');
  store.addressesMetadata.set('a', 6);
  store.addressesMetadata.set('b', 5);

  const values = [];
  for await (const info of store.addressIter()) {
    values.push(info);
  }
  expect(values).toStrictEqual([2, 1, 3]);
  await expect(store.getAddress('b')).resolves.toEqual(1);
  await expect(store.getAddressMeta('b')).resolves.toEqual(5);
  await expect(store.addressCount()).resolves.toEqual(3);

  await expect(store.getCurrentAddress()).rejects.toThrow('Current address is not loaded');
  expect(store.walletData.currentAddressIndex).toEqual(-1);
  expect(store.walletData.lastLoadedAddressIndex).toEqual(0);
  await store.saveAddress({
    base58: 'd',
    bip32AddressIndex: 10,
  });
  expect(store.walletData.currentAddressIndex).toEqual(10);
  expect(store.walletData.lastLoadedAddressIndex).toEqual(10);
  await store.saveAddress({
    base58: 'e',
    bip32AddressIndex: 11,
  });
  expect(store.walletData.currentAddressIndex).toEqual(10);
  expect(store.walletData.lastLoadedAddressIndex).toEqual(11);

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
});

test('history methods', async () => {
  const store = new MemoryStore();
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveAddress({base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1});
  const storage = new Storage(store);

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
    tx_id: '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e',
  });

  store.walletData.bestBlockHeight = 11;
  const getTokenApi = jest.spyOn(walletApi, 'getGeneralTokenInfo').mockImplementation((uid, resolve) => {
    resolve({
      success: true,
      name: 'Custom token',
      symbol: 'CTK',
    });
  });
  await processHistory(storage, { rewardLock: 1 });
  expect(getTokenApi).not.toHaveBeenCalledWith('00', expect.anything());
  expect(getTokenApi).toHaveBeenCalledWith('01', expect.anything());
  expect(getTokenApi).toHaveBeenCalledWith('02', expect.anything());
  getTokenApi.mockRestore();
  expect(store.tokensMetadata.get('00')).toMatchObject({
    numTransactions: 4,
    balance: {
      tokens: { locked: 2, unlocked: 2 },
      authorities: {
        mint: { locked: 0, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    }
  });
  expect(store.tokensMetadata.get('01')).toMatchObject({
    numTransactions: 2,
    balance: {
      tokens: { locked: 0, unlocked: 1 },
      authorities: {
        mint: { locked: 1, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    }
  });
  expect(store.tokensMetadata.get('02')).toMatchObject({
    numTransactions: 3,
    balance: {
      tokens: { locked: 0, unlocked: 6 },
      authorities: {
        mint: { locked: 0, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    }
  });
  expect(store.addressesMetadata.get('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ')).toMatchObject({
    numTransactions: 2,
    balance: expect.anything(),
  });
  expect(store.addressesMetadata.get('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp')).toMatchObject({
    numTransactions: 7,
    balance: expect.anything(),
  });
});

test('token methods', async () => {
  const store = new MemoryStore();

  // Starts with HTR
  expect(store.tokens.size).toEqual(1);
  expect(store.tokens.get('00')).toBeDefined();

  await store.saveToken({ uid: '01', name: 'Token 01', symbol: 'TK01'});
  expect(store.tokens.size).toEqual(2);
  expect(store.tokens.get('01')).toBeDefined();
  expect(store.tokensMetadata.get('01')).toBeUndefined();
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
  expect(store.tokens.size).toEqual(3);
  expect(store.tokens.get('02')).toBeDefined();
  expect(store.tokensMetadata.get('02')).toBeDefined();

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
  expect(store.tokensMetadata.get('00')).toMatchObject({
    numTransactions: 10,
    balance: expect.objectContaining({ tokens: { locked: 1, unlocked: 2 } }),
  });
});

test('utxo methods', async () => {
  const store = new MemoryStore();
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
  ];
  await store.saveUtxo(utxos[0]);
  await store.saveUtxo(utxos[1]);
  expect(store.utxos.size).toEqual(2);
  let buf = [];
  for await (const u of store.utxoIter()) {
    buf.push(u);
  }
  expect(buf).toHaveLength(2);

  // Default values will filter for HTR token
  buf = [];
  for await (const u of store.selectUtxos({})) {
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
});

test('access data methods', async () => {
  const store = new MemoryStore();
  const xpriv = new HDPrivateKey();
  const encryptedMain = encryptData(xpriv.xprivkey, '123');
  const accessData = {
    xpubkey: xpriv.xpubkey,
    mainKey: encryptedMain,
    walletFlags: 0,
    walletType: WalletType.P2PKH,
  };

  await expect(store.getAccessData()).resolves.toEqual(null);
  await store.saveAccessData(accessData);
  expect(store.accessData).toBe(accessData);
  await expect(store.getAccessData()).resolves.toBe(accessData);
  store.walletData.lastUsedAddressIndex = 3;
  store.walletData.lastLoadedAddressIndex = 5;
  store.walletData.bestBlockHeight = 10000;
  await expect(store.getLastUsedAddressIndex()).resolves.toEqual(3);
  await expect(store.getLastLoadedAddressIndex()).resolves.toEqual(5);
  await expect(store.getCurrentHeight()).resolves.toEqual(10000);
  await store.setCurrentHeight(101000);
  await expect(store.getCurrentHeight()).resolves.toEqual(101000);

  await expect(store.getItem('foo')).resolves.toBeUndefined();
  await store.setItem('foo', 'bar');
  await expect(store.getItem('foo')).resolves.toEqual('bar');

  expect(store.history.size).toEqual(0)
  expect(store.addresses.size).toEqual(0)
  expect(store.registeredTokens.size).toEqual(0);

  // Clean storage but keep registered tokens
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveTx(tx_history[0]);
  await store.registerToken({ uid: 'testtoken', name: 'Test token', symbol: 'TST' });
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(1);
  await store.cleanStorage(true, true);
  expect(store.history.size).toEqual(0)
  expect(store.addresses.size).toEqual(0)
  expect(store.registeredTokens.size).toEqual(1);

  // Clean only registered tokens
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveTx(tx_history[0]);
  await store.registerToken({ uid: 'testtoken', name: 'Test token', symbol: 'TST' });
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(1);
  await store.cleanStorage(false, false, true);
  expect(store.history.size).toEqual(1)
  expect(store.addresses.size).toEqual(1)
  expect(store.registeredTokens.size).toEqual(0);

  // Clean all
  await store.registerToken({ uid: 'testtoken', name: 'Test token', symbol: 'TST' });
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(1);
  await store.cleanStorage(true, true, true);
  expect(store.history.size).toEqual(0)
  expect(store.addresses.size).toEqual(0)
  expect(store.registeredTokens.size).toEqual(0);
});

test('nano contract methods', async () => {
  const store = new MemoryStore();

  // Asserts the store is empty
  await expect(store.getNanoContract('nanoContractId')).resolves.toBeNull();
  await expect(store.isNanoContractRegistered('nanoContractId')).resolves.toBeFalsy();
  expect(store.registeredNanoContracts.size).toEqual(0);

  // Asserts nano contract is registerd with success
  await store.registerNanoContract('001', {
    ncId: '001',
    blueprintId: '001',
    blueprintName: 'Bet'
  });
  await expect(store.getNanoContract('001')).resolves.toBeDefined();
  await expect(store.isNanoContractRegistered('001')).resolves.toBeTruthy();
  expect(store.registeredNanoContracts.size).toEqual(1);

  await store.registerNanoContract('002', {
    ncId: '002',
    blueprintId: '001',
    blueprintName: 'Bet'
  });
  await expect(store.getNanoContract('002')).resolves.toBeDefined();
  await expect(store.isNanoContractRegistered('002')).resolves.toBeTruthy();
  expect(store.registeredNanoContracts.size).toEqual(2);

  // Asserts nano contract is unregisterd with success
  await store.unregisterNanoContract('002');
  await expect(store.getNanoContract('002')).resolves.toBeNull();
  await expect(store.isNanoContractRegistered('002')).resolves.toBeFalsy();
  expect(store.registeredNanoContracts.size).toEqual(1);

  // Asserts store is cleaned only when tokens are cleaned too
  await store.cleanStorage(false, false, false); // not cleaning tokens
  expect(store.registeredNanoContracts.size).toEqual(1);
  await store.cleanStorage(false, false, true); // cleaning tokens
  expect(store.registeredNanoContracts.size).toEqual(0);
});
