/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { GAP_LIMIT } from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import tx_history from '../__fixtures__/tx_history';
import walletApi from '../../src/api/wallet';
import { encryptData } from '../../src/utils/crypto';
import { TokenVersion, WalletType } from '../../src/types';
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

  await expect(store.getCurrentAddress()).rejects.toThrow('Current legacy address is not loaded');
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

test('addressIter chain-selection (legacy vs shielded)', async () => {
  const store = new MemoryStore();

  // Mixed-chain fixture: two legacy P2PKHs (with explicit + implicit
  // addressType), one shielded receive, one shielded-spend (internal),
  // and one P2SH. The iterator must filter strictly by chain.
  await store.saveAddress({ base58: 'leg-0', bip32AddressIndex: 0, addressType: 'p2pkh' });
  await store.saveAddress({ base58: 'leg-1', bip32AddressIndex: 1 }); // untyped → legacy
  await store.saveAddress({ base58: 'p2sh-2', bip32AddressIndex: 2, addressType: 'p2sh' });
  await store.saveAddress({ base58: 'shi-0', bip32AddressIndex: 0, addressType: 'shielded' });
  await store.saveAddress({ base58: 'shi-1', bip32AddressIndex: 1, addressType: 'shielded' });
  await store.saveAddress({
    base58: 'shi-spend-0',
    bip32AddressIndex: 0,
    addressType: 'shielded-spend',
  });

  // Default (no opts) → legacy chain only. shielded + shielded-spend
  // entries are filtered out (the receive pipeline relies on the
  // shielded-spend P2PKH being invisible at this surface).
  const defaultBases: string[] = [];
  for await (const info of store.addressIter()) defaultBases.push(info.base58);
  expect(defaultBases.sort()).toEqual(['leg-0', 'leg-1', 'p2sh-2'].sort());

  // legacy: true is the explicit form of the default.
  const legacyBases: string[] = [];
  for await (const info of store.addressIter({ legacy: true })) legacyBases.push(info.base58);
  expect(legacyBases.sort()).toEqual(defaultBases.sort());

  // legacy: false → user-facing shielded receive addresses only, in
  // BIP32-index order. shielded-spend MUST NOT leak through (it's
  // internal — surfacing it would let callers send to a wallet's
  // spend P2PKH thinking it's a shielded address).
  const shieldedBases: string[] = [];
  for await (const info of store.addressIter({ legacy: false })) shieldedBases.push(info.base58);
  expect(shieldedBases).toEqual(['shi-0', 'shi-1']);
});

test('history methods', async () => {
  const store = new MemoryStore();
  await store.saveAddress({ base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0 });
  await store.saveAddress({ base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1 });
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
  const getTokenApi = jest
    .spyOn(walletApi, 'getGeneralTokenInfo')
    .mockImplementation((uid, resolve) => {
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
      tokens: { locked: 2n, unlocked: 2n },
      authorities: {
        mint: { locked: 0n, unlocked: 0n },
        melt: { locked: 0n, unlocked: 0n },
      },
    },
  });
  expect(store.tokensMetadata.get('01')).toMatchObject({
    numTransactions: 2,
    balance: {
      tokens: { locked: 0n, unlocked: 1n },
      authorities: {
        mint: { locked: 1n, unlocked: 0n },
        melt: { locked: 0n, unlocked: 0n },
      },
    },
  });
  expect(store.tokensMetadata.get('02')).toMatchObject({
    numTransactions: 3,
    balance: {
      tokens: { locked: 0n, unlocked: 6n },
      authorities: {
        mint: { locked: 0n, unlocked: 0n },
        melt: { locked: 0n, unlocked: 0n },
      },
    },
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

  // Starts empty
  expect(store.tokens.size).toEqual(0);

  await store.saveToken({
    uid: '01',
    name: 'Token 01',
    symbol: 'TK01',
    version: TokenVersion.DEPOSIT,
  });
  expect(store.tokens.size).toEqual(1);
  expect(store.tokens.get('01')).toBeDefined();
  expect(store.tokensMetadata.get('01')).toBeUndefined();
  await store.saveToken(
    { uid: '02', name: 'Token 02', symbol: 'TK02', version: TokenVersion.DEPOSIT },
    {
      numTransactions: 1,
      balance: {
        tokens: { locked: 1n, unlocked: 2n },
        authorities: {
          mint: { locked: 1n, unlocked: 2n },
          melt: { locked: 1n, unlocked: 2n },
        },
      },
    }
  );
  expect(store.tokens.size).toEqual(2);
  expect(store.tokens.get('02')).toBeDefined();
  expect(store.tokensMetadata.get('02')).toBeDefined();

  let registered = [];
  for await (const token of store.registeredTokenIter()) {
    registered.push(token);
  }
  expect(registered).toHaveLength(0);

  await store.registerToken({
    uid: '02',
    name: 'Token 02',
    symbol: 'TK02',
    version: TokenVersion.DEPOSIT,
  });
  await store.registerToken({
    uid: '03',
    name: 'Token 03',
    symbol: 'TK03',
    version: TokenVersion.DEPOSIT,
  });

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

  await store.saveToken({ uid: '00', name: 'Hathor', symbol: 'HTR', version: TokenVersion.NATIVE });
  await store.editTokenMeta('00', {
    numTransactions: 10,
    balance: { tokens: { locked: 1n, unlocked: 2n } },
  });
  expect(store.tokensMetadata.get('00')).toMatchObject({
    numTransactions: 10,
    balance: expect.objectContaining({ tokens: { locked: 1n, unlocked: 2n } }),
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
      value: 100n,
      authorities: 0n,
      timelock: null,
      type: 1,
      height: null,
    },
    {
      txId: 'tx02',
      index: 30,
      token: '02',
      address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      value: 10n,
      authorities: 0n,
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
  for await (const u of store.selectUtxos({ token: '02' })) {
    buf.push(u);
  }
  expect(buf).toHaveLength(1);
  expect(buf[0].txId).toEqual('tx02');

  // Add a shielded UTXO
  await store.saveUtxo({
    txId: 'tx03',
    index: 0,
    token: '00',
    address: 'addr3',
    value: 30n,
    authorities: 0n,
    timelock: null,
    type: 1,
    height: null,
    shielded: true,
    blindingFactor: 'aa'.repeat(32),
  });

  // Default (no shielded filter) returns all including shielded
  buf = [];
  for await (const u of store.selectUtxos({})) {
    buf.push(u);
  }
  expect(buf).toHaveLength(2); // tx01 (HTR) + tx03 (HTR shielded)

  // shielded: true returns only shielded
  buf = [];
  for await (const u of store.selectUtxos({ shielded: true })) {
    buf.push(u);
  }
  expect(buf).toHaveLength(1);
  expect(buf[0].txId).toEqual('tx03');
  expect(buf[0].shielded).toBe(true);

  // shielded: false returns only transparent
  buf = [];
  for await (const u of store.selectUtxos({ shielded: false })) {
    buf.push(u);
  }
  expect(buf).toHaveLength(1);
  expect(buf[0].txId).toEqual('tx01');
  expect(buf[0].shielded).toBeUndefined();
});

test('selectUtxos filter_address resolves user-facing shielded → spend P2PKH at same BIP32 index', async () => {
  // Regression test for the /wallet/send-tx query input bug:
  //   inputs: [{type: "query", filter_address: "<user-facing shielded>"}]
  // returns "No utxos available for the query filter for this amount."
  // Root cause: the user-facing shielded form (addressType 'shielded',
  // K-prefix encoded) never matches utxo.address — UTXOs carry the
  // spend-derived P2PKH (addressType 'shielded-spend', W-prefix).
  // The fix in selectUtxos resolves the caller-provided shielded
  // address to its sibling spend-P2PKH at the same BIP32 index.
  const store = new MemoryStore();
  const SHIELDED_BIP32_INDEX = 5;
  const USER_FACING_SHIELDED = 'K3MowdLNAKLnjL19HsjywgB8Uta5YEwz63BDpX1yv8'; // K-prefix
  const SPEND_P2PKH = 'WaJveoooUbAAKco1uSX2X3TRUgspjkxKHx'; // W-prefix sibling

  // Register both forms at the same BIP32 index (matches what
  // loadAddresses / deriveShieldedAddressFromStorage produces).
  await store.saveAddress({
    base58: USER_FACING_SHIELDED,
    bip32AddressIndex: SHIELDED_BIP32_INDEX,
    addressType: 'shielded',
  });
  await store.saveAddress({
    base58: SPEND_P2PKH,
    bip32AddressIndex: SHIELDED_BIP32_INDEX,
    addressType: 'shielded-spend',
  });

  // The shielded UTXO is labeled with the spend-P2PKH (what's on-chain).
  await store.saveUtxo({
    txId: 'tx-shielded-1',
    index: 0,
    token: '00',
    address: SPEND_P2PKH,
    value: 500n,
    authorities: 0n,
    timelock: null,
    type: 1,
    height: null,
    shielded: true,
    blindingFactor: 'aa'.repeat(32),
  });

  // Pass the user-facing shielded form — the fix should resolve it to
  // the sibling spend-P2PKH and match the UTXO.
  const matches: Array<{ txId: string; address: string; value: bigint }> = [];
  for await (const u of store.selectUtxos({ filter_address: USER_FACING_SHIELDED })) {
    matches.push({ txId: u.txId, address: u.address, value: u.value });
  }
  expect(matches).toHaveLength(1);
  expect(matches[0].txId).toBe('tx-shielded-1');
  expect(matches[0].address).toBe(SPEND_P2PKH); // returned form is the on-chain one
  expect(matches[0].value).toBe(500n);

  // Negative control: filtering by a totally unrelated address still
  // returns nothing (no over-resolution leaking shielded UTXOs).
  const empty: typeof matches = [];
  for await (const u of store.selectUtxos({
    filter_address: 'WunrelatedAddressNotMineAtAll0000000',
  })) {
    empty.push({ txId: u.txId, address: u.address, value: u.value });
  }
  expect(empty).toHaveLength(0);
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

  expect(store.history.size).toEqual(0);
  expect(store.addresses.size).toEqual(0);
  expect(store.registeredTokens.size).toEqual(0);

  // Clean storage but keep registered tokens
  await store.saveAddress({ base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0 });
  await store.saveTx(tx_history[0]);
  await store.registerToken({
    uid: 'testtoken',
    name: 'Test token',
    symbol: 'TST',
    version: TokenVersion.DEPOSIT,
  });
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(1);
  await store.cleanStorage(true, true);
  expect(store.history.size).toEqual(0);
  expect(store.addresses.size).toEqual(0);
  expect(store.registeredTokens.size).toEqual(1);

  // Clean only registered tokens
  await store.saveAddress({ base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0 });
  await store.saveTx(tx_history[0]);
  await store.registerToken({
    uid: 'testtoken',
    name: 'Test token',
    symbol: 'TST',
    version: TokenVersion.DEPOSIT,
  });
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(1);
  await store.cleanStorage(false, false, true);
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(0);

  // Clean all
  await store.registerToken({
    uid: 'testtoken',
    name: 'Test token',
    symbol: 'TST',
    version: TokenVersion.DEPOSIT,
  });
  expect(store.history.size).toEqual(1);
  expect(store.addresses.size).toEqual(1);
  expect(store.registeredTokens.size).toEqual(1);
  await store.cleanStorage(true, true, true);
  expect(store.history.size).toEqual(0);
  expect(store.addresses.size).toEqual(0);
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
    blueprintName: 'Bet',
    address: 'abc',
  });
  await expect(store.getNanoContract('001')).resolves.toBeDefined();
  await expect(store.getNanoContract('001')).resolves.toMatchObject({ address: 'abc' });
  await expect(store.isNanoContractRegistered('001')).resolves.toBeTruthy();
  expect(store.registeredNanoContracts.size).toEqual(1);

  await store.registerNanoContract('002', {
    ncId: '002',
    blueprintId: '001',
    blueprintName: 'Bet',
    address: 'abc',
  });
  await expect(store.getNanoContract('002')).resolves.toBeDefined();
  await expect(store.isNanoContractRegistered('002')).resolves.toBeTruthy();
  expect(store.registeredNanoContracts.size).toEqual(2);

  // Asserts nano contract is unregisterd with success
  await store.unregisterNanoContract('002');
  await expect(store.getNanoContract('002')).resolves.toBeNull();
  await expect(store.isNanoContractRegistered('002')).resolves.toBeFalsy();
  expect(store.registeredNanoContracts.size).toEqual(1);

  // Test update address of registered nano contract
  await store.updateNanoContractRegisteredAddress('001', 'def');
  await expect(store.getNanoContract('001')).resolves.toMatchObject({ address: 'def' });

  // Asserts store is cleaned only when tokens are cleaned too
  await store.cleanStorage(false, false, false); // not cleaning tokens
  expect(store.registeredNanoContracts.size).toEqual(1);
  await store.cleanStorage(false, false, true); // cleaning tokens
  expect(store.registeredNanoContracts.size).toEqual(0);
});
