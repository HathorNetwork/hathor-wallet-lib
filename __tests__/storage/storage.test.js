/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import walletApi from '../../src/api/wallet';
import { MemoryStore, Storage, LevelDBStore } from '../../src/storage';
import tx_history from '../__fixtures__/tx_history';
import { processHistory, loadAddresses } from '../../src/utils/storage';
import walletUtils from '../../src/utils/wallet';
import {
  P2PKH_ACCT_PATH,
  TOKEN_DEPOSIT_PERCENTAGE,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MINT_MASK,
  WALLET_SERVICE_AUTH_DERIVATION_PATH,
  GAP_LIMIT,
} from '../../src/constants';
import { HDPrivateKey } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import * as cryptoUtils from '../../src/utils/crypto';
import { InvalidPasswdError } from '../../src/errors';
import Network from '../../src/models/network';
import { WALLET_FLAGS } from '../../src/types';

const DATA_DIR = './testdata.leveldb';

describe('handleStop', () => {
  const PIN = '0000';
  const PASSWD = '0000';
  const seed = walletUtils.generateWalletWords();
  const accessData = walletUtils.generateAccessDataFromSeed(seed, {
    pin: PIN,
    password: PASSWD,
    networkName: 'testnet',
  });

  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await handleStopTest(store);
  }, 20000);

  it('should work with leveldb store', async () => {
    const walletId = walletUtils.getWalletIdFromXPub(accessData.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await handleStopTest(store);
  }, 20000);

  /**
   * @param {IStore} store
   */
  async function handleStopTest(store) {
    async function toArray(gen) {
      const out = [];
      for await (const it of gen) out.push(it);
      return out;
    }
    const storage = new Storage(store);
    const testToken = { uid: 'testtoken', name: 'Test token', symbol: 'TST' };
    await storage.saveAccessData(accessData);
    await loadAddresses(0, 20, storage);
    await storage.addTx({
      tx_id: 'a-new-tx',
      timestamp: 123,
      inputs: [],
      outputs: [],
    });
    await storage.registerToken(testToken);
    const address0 = await storage.getAddressAtIndex(0);
    const address1 = await storage.getAddressAtIndex(1);
    const testNano = {
      ncId: 'abc',
      address: address0.base58,
      blueprintId: 'blueprintId',
      blueprintName: 'blueprintName',
    };
    await storage.registerNanoContract('abc', testNano);
    // We have 1 transaction
    await expect(store.historyCount()).resolves.toEqual(1);
    // 20 addresses
    await expect(store.addressCount()).resolves.toEqual(20);
    // And 1 registered token
    let tokens = await toArray(storage.getRegisteredTokens());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual(testToken);
    // And 1 registered nano contract
    let nanos = await toArray(storage.getRegisteredNanoContracts());
    expect(nanos).toHaveLength(1);
    expect(nanos[0]).toEqual(testNano);

    // Test address update
    await expect(store.getNanoContract('abc')).resolves.toMatchObject({ address: address0.base58 });
    await storage.updateNanoContractRegisteredAddress('abc', address1.base58);
    await expect(store.getNanoContract('abc')).resolves.toMatchObject({ address: address1.base58 });

    await expect(storage.updateNanoContractRegisteredAddress('abc', 'abc')).rejects.toThrow(Error);

    // Go back to default address
    await storage.updateNanoContractRegisteredAddress('abc', address0.base58);

    storage.version = 'something';
    // handleStop with defaults
    await storage.handleStop();
    // Will clean the version
    expect(storage.version).toEqual(null);
    // Nothing changed in the store
    await expect(store.historyCount()).resolves.toEqual(1);
    await expect(store.addressCount()).resolves.toEqual(20);
    await expect(store.isTokenRegistered(testToken.uid)).resolves.toBeTruthy();
    await expect(store.isNanoContractRegistered(testNano.ncId)).resolves.toBeTruthy();
    tokens = await toArray(storage.getRegisteredTokens());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual(testToken);
    nanos = await toArray(storage.getRegisteredNanoContracts());
    expect(nanos).toHaveLength(1);
    expect(nanos[0]).toEqual(testNano);

    // handleStop with cleanStorage = true
    await storage.handleStop({ cleanStorage: true });
    // Will clean the history bit not addresses or registered tokens
    await expect(store.historyCount()).resolves.toEqual(0);
    await expect(store.addressCount()).resolves.toEqual(20);
    await expect(store.isTokenRegistered(testToken.uid)).resolves.toBeTruthy();
    await expect(store.isNanoContractRegistered(testNano.ncId)).resolves.toBeTruthy();
    tokens = await toArray(storage.getRegisteredTokens());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual(testToken);
    nanos = await toArray(storage.getRegisteredNanoContracts());
    expect(nanos).toHaveLength(1);
    expect(nanos[0]).toEqual(testNano);

    await storage.addTx({
      tx_id: 'another-new-tx',
      timestamp: 1234,
      inputs: [],
      outputs: [],
    });

    // handleStop with cleanAddresses = true
    await storage.handleStop({ cleanAddresses: true });
    // Will clean the history bit not addresses
    await expect(store.historyCount()).resolves.toEqual(1);
    await expect(store.addressCount()).resolves.toEqual(0);
    await expect(store.isTokenRegistered(testToken.uid)).resolves.toBeTruthy();
    await expect(store.isNanoContractRegistered(testNano.ncId)).resolves.toBeTruthy();
    tokens = await toArray(storage.getRegisteredTokens());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual(testToken);
    nanos = await toArray(storage.getRegisteredNanoContracts());
    expect(nanos).toHaveLength(1);
    expect(nanos[0]).toEqual(testNano);

    // handleStop with cleanAddresses = true
    await loadAddresses(0, 20, storage);
    await storage.handleStop({ cleanTokens: true });
    // Will clean the history bit not addresses
    await expect(store.historyCount()).resolves.toEqual(1);
    await expect(store.addressCount()).resolves.toEqual(20);
    await expect(store.isTokenRegistered(testToken.uid)).resolves.toBeFalsy();
    await expect(store.isNanoContractRegistered(testNano.ncId)).resolves.toBeFalsy();

    tokens = await toArray(storage.getRegisteredTokens());
    expect(tokens).toHaveLength(0);
    nanos = await toArray(storage.getRegisteredNanoContracts());
    expect(nanos).toHaveLength(0);

    // Access data is untouched when stopping the wallet
    // XXX: since we stringify to save on store, the optional undefined properties are removed
    // Since they are optional and unset, we can safely remove them from the expected value
    const expectedData = JSON.parse(JSON.stringify(accessData));
    await expect(storage.getAccessData()).resolves.toMatchObject(expectedData);
  }
});

describe('config version', () => {
  it('should set api version', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const version = { foo: 'bar' };
    storage.setApiVersion(version);
    expect(storage.version).toBe(version);
  });

  it('should get deposit from version', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    expect(storage.getTokenDepositPercentage()).toEqual(TOKEN_DEPOSIT_PERCENTAGE);
    const version = { token_deposit_percentage: 0.5 }; // 50%
    storage.setApiVersion(version);
    expect(storage.getTokenDepositPercentage()).toEqual(0.5);
    storage.setApiVersion(null);
    expect(storage.getTokenDepositPercentage()).toEqual(TOKEN_DEPOSIT_PERCENTAGE);
  });
});

test('store fetch methods', async () => {
  const getTokenApi = jest
    .spyOn(walletApi, 'getGeneralTokenInfo')
    .mockImplementation((uid, resolve) => {
      resolve({
        success: true,
        name: 'Custom token',
        symbol: 'CTK',
      });
    });
  const store = new MemoryStore();
  await store.saveAddress({ base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0 });
  await store.saveAddress({ base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1 });
  for (const tx of tx_history) {
    await store.saveTx(tx);
  }
  const storage = new Storage(store);
  await processHistory(storage);

  let buf = [];
  for await (const a of storage.getAllAddresses()) {
    buf.push(a);
  }
  expect(buf).toHaveLength(2);
  await expect(storage.getAddressInfo('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ')).resolves.toMatchObject(
    {
      base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      bip32AddressIndex: 0,
      numTransactions: 2,
      balance: expect.anything(),
    }
  );
  await expect(storage.getAddressAtIndex(1)).resolves.toMatchObject({
    base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    bip32AddressIndex: 1,
  });
  await expect(storage.isAddressMine('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ')).resolves.toBe(true);
  await expect(storage.isAddressMine('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAA')).resolves.toBe(false);

  async function* emptyIter() {}
  const historySpy = jest.spyOn(store, 'historyIter').mockImplementation(emptyIter);
  for await (const _ of storage.txHistory()) {
    continue;
  }
  expect(historySpy).toHaveBeenCalled();

  await expect(
    storage.getTx('0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e')
  ).resolves.toBeDefined();

  const tokenSpy = jest.spyOn(store, 'historyIter').mockImplementation(emptyIter);
  for await (const _ of storage.tokenHistory()) {
    continue;
  }
  expect(tokenSpy).toHaveBeenCalledWith('00');

  getTokenApi.mockRestore();
});

test('selecting utxos', async () => {
  const getTokenApi = jest
    .spyOn(walletApi, 'getGeneralTokenInfo')
    .mockImplementation((uid, resolve) => {
      resolve({
        success: true,
        name: 'Custom token',
        symbol: 'CTK',
      });
    });
  const store = new MemoryStore();
  await store.saveAddress({ base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0 });
  await store.saveAddress({ base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1 });
  for (const tx of tx_history) {
    await store.saveTx(tx);
  }
  const storage = new Storage(store);
  await processHistory(storage);

  // Should use the filter_method
  // filter_method returns true if the utxo is acceptable
  // it returns false if we do not want to use the utxo
  const wantedTx = '0000000419625e2587c225fb49f36278c9da681ec05e039125307b8aef3d3d30';
  const options = {
    filter_method: utxo => utxo.txId === wantedTx,
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
  await expect(storage.isUtxoSelectedAsInput({ txId: 'a-tx-id3', index: '0' })).resolves.toBe(
    false
  );

  // Iterate on all utxos selected as input
  let buf = [];
  for await (const u of storage.utxoSelectedAsInputIter()) {
    buf.push(u);
  }
  expect(buf).toHaveLength(2);
  expect(buf).toContainEqual({ txId: 'a-tx-id1', index: 0 });
  expect(buf).toContainEqual({ txId: 'a-tx-id2', index: 0 });

  const tx = { txId: 'a-tx-id3', outputs: [{ value: 10, token: '00', spent_by: null }] };
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
  getTxSpy.mockImplementation(async () => ({
    txId: 'a-tx-id3',
    outputs: [{ value: 10, token: '00', spent_by: 'a-tx-id5' }],
  }));
  await storage.utxoSelectAsInput({ txId: 'a-tx-id3', index: 0 }, true);
  expect(storage.utxosSelectedAsInput.get('a-tx-id3:0')).toBeUndefined();
});

describe('process locked utxos', () => {
  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await processLockedUtxoTest(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await processLockedUtxoTest(store);
  });

  function getLockedUtxo(txId, address, timelock, height, value, token, token_data) {
    return {
      index: 0,
      tx: {
        tx_id: txId,
        height,
        version: 1,
        timestamp: timelock,
        is_voided: false,
        inputs: [],
        outputs: [
          {
            value,
            token_data,
            token,
            spent_by: null,
            decoded: {
              type: 'P2PKH',
              address,
              timelock,
            },
          },
        ],
      },
    };
  }

  function getUtxoFromLocked(lutxo) {
    const { tx, index } = lutxo;
    const { outputs } = tx;
    const output = outputs[index];
    const { decoded } = output;
    const { address, timelock } = decoded;
    return {
      txId: tx.tx_id,
      index,
      token: output.token,
      address,
      value: output.value,
      authorities: 0,
      timelock,
      type: tx.version,
      height: tx.height,
    };
  }

  /**
   * Run the "process locked utxo" test suite on the given store instance.
   *
   * @param {IStore} store The store instance to test
   */
  async function processLockedUtxoTest(store) {
    const nowTs = Math.floor(Date.now() / 1000);
    const tsLocked = nowTs + 60;
    const tsUnLocked = nowTs - 60;

    const storage = new Storage(store);
    storage.version = {
      reward_spend_min_blocks: 1,
    };
    const lockedUtxos = [
      // utxo to be unlocked by time
      getLockedUtxo(
        'tx01',
        'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
        tsUnLocked,
        null,
        100, // value
        '00', // token
        0 // token_data
      ),
      // timelocked
      getLockedUtxo(
        'tx02',
        'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
        tsLocked,
        null,
        100, // value
        '00', // token
        0 // token_data
      ),
      // utxo to be unlocked by height
      getLockedUtxo(
        'tx03',
        'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        tsUnLocked,
        5,
        100, // value
        '01', // token
        0 // token_data
      ),
      // heightlocked
      getLockedUtxo(
        'tx04',
        'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        tsUnLocked,
        100,
        TOKEN_MINT_MASK, // value, mint
        '01', // token
        TOKEN_AUTHORITY_MASK | 1 // token_data
      ),
    ];
    await store.saveAddress({ base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0 });
    await store.saveAddress({ base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1 });
    for (const lutxo of lockedUtxos) {
      await store.saveTx(lutxo.tx);
      await store.saveUtxo(getUtxoFromLocked(lutxo));
      await store.saveLockedUtxo(lutxo);
    }
    // at first all utxos are locked
    await store.editAddressMeta('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', {
      numTransactions: 2,
      balance: new Map([
        [
          '00',
          {
            tokens: { locked: 200, unlocked: 0 },
            authorities: { mint: { locked: 0, unlocked: 0 }, melt: { locked: 0, unlocked: 0 } },
          },
        ],
      ]),
    });
    await store.editAddressMeta('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', {
      numTransactions: 2,
      balance: new Map([
        [
          '01',
          {
            tokens: { locked: 100, unlocked: 0 },
            authorities: { mint: { locked: 1, unlocked: 0 }, melt: { locked: 0, unlocked: 0 } },
          },
        ],
      ]),
    });

    // time has passed, unlocking some utxos
    await storage.processLockedUtxos(1);
    let firstAddrMeta = await store.getAddressMeta('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ');
    let secondAddrMeta = await store.getAddressMeta('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp');
    expect(firstAddrMeta.numTransactions).toEqual(2);
    expect(secondAddrMeta.numTransactions).toEqual(2);
    expect(Object.fromEntries(firstAddrMeta.balance)).toMatchObject({
      '00': {
        tokens: {
          locked: 100,
          unlocked: 100,
        },
        authorities: {
          mint: {
            locked: 0,
            unlocked: 0,
          },
          melt: {
            locked: 0,
            unlocked: 0,
          },
        },
      },
    });
    expect(Object.fromEntries(secondAddrMeta.balance)).toMatchObject({
      '01': {
        tokens: {
          locked: 100,
          unlocked: 0,
        },
        authorities: {
          mint: {
            locked: 1,
            unlocked: 0,
          },
          melt: {
            locked: 0,
            unlocked: 0,
          },
        },
      },
    });

    // Now we have a new height, unlocking some utxos
    await storage.processLockedUtxos(10);
    firstAddrMeta = await store.getAddressMeta('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ');
    secondAddrMeta = await store.getAddressMeta('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp');
    expect(firstAddrMeta.numTransactions).toEqual(2);
    expect(secondAddrMeta.numTransactions).toEqual(2);
    expect(Object.fromEntries(firstAddrMeta.balance)).toMatchObject({
      '00': {
        tokens: {
          locked: 100,
          unlocked: 100,
        },
        authorities: {
          mint: {
            locked: 0,
            unlocked: 0,
          },
          melt: {
            locked: 0,
            unlocked: 0,
          },
        },
      },
    });
    expect(Object.fromEntries(secondAddrMeta.balance)).toMatchObject({
      '01': {
        tokens: {
          locked: 0,
          unlocked: 100,
        },
        authorities: {
          mint: {
            locked: 1,
            unlocked: 0,
          },
          melt: {
            locked: 0,
            unlocked: 0,
          },
        },
      },
    });
  }
});

describe('getChangeAddress', () => {
  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await getChangeAddressTest(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await getChangeAddressTest(store);
  });

  async function getChangeAddressTest(store) {
    const storage = new Storage(store);
    const addr0 = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
    const addr1 = 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp';
    await store.saveAddress({ base58: addr0, bip32AddressIndex: 0 });
    await store.saveAddress({ base58: addr1, bip32AddressIndex: 1 });
    await store.setCurrentAddressIndex(0);

    // Expect to get the provided address if it is from the wallet
    await expect(storage.getChangeAddress({ changeAddress: addr1 })).resolves.toEqual(addr1);
    // Should throw if the provided address is not from the wallet
    await expect(storage.getChangeAddress({ changeAddress: 'invalid' })).rejects.toThrow(
      'Change address'
    );
    // If one is not provided we get the current address
    await expect(storage.getChangeAddress()).resolves.toEqual(addr0);
    await store.setCurrentAddressIndex(1);
    await expect(storage.getChangeAddress()).resolves.toEqual(addr1);
  }
});

describe('getAcctPathXpriv', () => {
  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await getAcctXprivTest(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await getAcctXprivTest(store);
  });

  /**
   * Test the method to get account path xpriv on any IStore
   * @param {IStore} store
   */
  async function getAcctXprivTest(store) {
    const storage = new Storage(store);
    const decryptSpy = jest.spyOn(cryptoUtils, 'decryptData');
    const accessDataSpy = jest.spyOn(storage, '_getValidAccessData');

    // Throw when we don't have account path key
    accessDataSpy.mockReturnValue(Promise.resolve({}));
    await expect(storage.getAcctPathXPrivKey('pin')).rejects.toThrow('Private key');

    // It should fail if decryption is not possible
    decryptSpy.mockImplementation(() => {
      throw new Error('Boom!');
    });
    accessDataSpy.mockReturnValue(Promise.resolve({ acctPathKey: 'encrypted-invalid-key' }));
    await expect(storage.getAcctPathXPrivKey('pin')).rejects.toThrow('Boom!');

    // It should return the decrypted key if pin is correct
    decryptSpy.mockReturnValue('account-path-key');
    accessDataSpy.mockReturnValue(Promise.resolve({ acctPathKey: 'encrypted-valid-key' }));
    await expect(storage.getAcctPathXPrivKey('pin')).resolves.toEqual('account-path-key');

    decryptSpy.mockRestore();
  }
});

describe('access data methods', () => {
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const accessData = walletUtils.generateAccessDataFromSeed(seed, {
    pin: '123',
    password: '456',
    networkName: 'testnet',
  });
  const code = new Mnemonic(seed);
  const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
  const authKey = rootXpriv.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH);
  const acctKey = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
  const mainKey = acctKey.deriveNonCompliantChild(0);

  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await accessDataTest(store);
  });

  it('should work with leveldb store', async () => {
    const walletId = walletUtils.getWalletIdFromXPub(mainKey.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await accessDataTest(store);
  });

  async function accessDataTest(store) {
    await store.saveAccessData(accessData);
    const storage = new Storage(store);
    // getMainXPrivKey
    await expect(storage.getMainXPrivKey('123')).resolves.toEqual(mainKey.xprivkey);
    // getAcctPathXPrivKey
    await expect(storage.getAcctPathXPrivKey('123')).resolves.toEqual(acctKey.xprivkey);
    // getAuthPrivKey
    await expect(storage.getAuthPrivKey('123')).resolves.toEqual(authKey.xprivkey);

    // Should throw InvalidPasswdError when pin is incorrect
    // getMainXPrivKey
    await expect(storage.getMainXPrivKey('456')).rejects.toThrow(InvalidPasswdError);
    // getAcctPathXPrivKey
    await expect(storage.getAcctPathXPrivKey('456')).rejects.toThrow(InvalidPasswdError);
    // getAuthPrivKey
    await expect(storage.getAuthPrivKey('456')).rejects.toThrow(InvalidPasswdError);

    // Should throw error when there is no data to get
    jest.spyOn(storage, '_getValidAccessData').mockReturnValue(Promise.resolve({}));
    // getMainXPrivKey
    await expect(storage.getMainXPrivKey('123')).rejects.toThrow('Private key');
    // getAcctPathXPrivKey
    await expect(storage.getAcctPathXPrivKey('123')).rejects.toThrow('Private key');
    // getAuthPrivKey
    await expect(storage.getAuthPrivKey('123')).rejects.toThrow('Private key');
  }
});

test('change pin and password', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  let accessData = walletUtils.generateAccessDataFromSeed(seed, {
    pin: '123',
    password: '456',
    networkName: 'testnet',
  });
  await storage.saveAccessData(accessData);

  await expect(() => storage.changePin('invalid-pin', '321')).rejects.toThrow(InvalidPasswdError);
  await expect(() => storage.changePassword('invalid-passwd', '456')).rejects.toThrow(
    InvalidPasswdError
  );

  await storage.changePin('123', '321');
  accessData = await storage.getAccessData();
  expect(() => cryptoUtils.decryptData(accessData.words, '456')).not.toThrow();
  expect(() => cryptoUtils.decryptData(accessData.mainKey, '321')).not.toThrow();
  expect(() => cryptoUtils.decryptData(accessData.authKey, '321')).not.toThrow();
  expect(() => cryptoUtils.decryptData(accessData.acctPathKey, '321')).not.toThrow();

  await storage.changePassword('456', '654');
  accessData = await storage.getAccessData();
  expect(() => cryptoUtils.decryptData(accessData.words, '654')).not.toThrow();
  expect(() => cryptoUtils.decryptData(accessData.mainKey, '321')).not.toThrow();
  expect(() => cryptoUtils.decryptData(accessData.authKey, '321')).not.toThrow();
  expect(() => cryptoUtils.decryptData(accessData.acctPathKey, '321')).not.toThrow();
});

describe('checkPin and checkPassword', () => {
  const PINCODE = '1234';
  const PASSWD = 'passwd';

  it('should work with memory store', async () => {
    const seed = walletUtils.generateWalletWords();
    const accessData = walletUtils.generateAccessDataFromSeed(seed, {
      pin: PINCODE,
      password: PASSWD,
      networkName: 'testnet',
    });
    const store = new MemoryStore();
    await store.saveAccessData(accessData);
    await checkPinTest(store);
    await checkPasswdTest(store);
  });

  it('should work with leveldb store', async () => {
    const seed = walletUtils.generateWalletWords();
    const accessData = walletUtils.generateAccessDataFromSeed(seed, {
      pin: PINCODE,
      password: PASSWD,
      networkName: 'testnet',
    });
    const walletId = walletUtils.getWalletIdFromXPub(accessData.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await store.saveAccessData(accessData);
    await checkPinTest(store);
    await checkPasswdTest(store);
  });

  async function checkPinTest(store) {
    const storage = new Storage(store);
    await expect(storage.checkPin(PINCODE)).resolves.toEqual(true);
    await expect(storage.checkPin('0000')).resolves.toEqual(false);

    // No access data should throw
    jest.spyOn(storage, 'getAccessData').mockReturnValue(Promise.resolve({ foo: 'bar' }));
    await expect(storage.checkPin('0000')).rejects.toThrow();

    jest.spyOn(storage, '_getValidAccessData').mockReturnValue(Promise.resolve({}));
    await expect(storage.checkPin('0000')).rejects.toThrow();
  }

  async function checkPasswdTest(store) {
    const storage = new Storage(store);
    await expect(storage.checkPassword(PASSWD)).resolves.toEqual(true);
    await expect(storage.checkPassword('0000')).resolves.toEqual(false);

    // No access data should throw
    jest.spyOn(storage, 'getAccessData').mockReturnValue(Promise.resolve({ foo: 'bar' }));
    await expect(storage.checkPassword('0000')).rejects.toThrow();

    jest.spyOn(storage, '_getValidAccessData').mockReturnValue(Promise.resolve({}));
    await expect(storage.checkPassword('0000')).rejects.toThrow();
  }
});

test('isHardware', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const accessDataSpy = jest.spyOn(storage, '_getValidAccessData');

  accessDataSpy.mockReturnValue(
    Promise.resolve({
      walletFlags: WALLET_FLAGS.HARDWARE,
    })
  );
  await expect(storage.isHardwareWallet()).resolves.toBe(true);

  accessDataSpy.mockReturnValue(
    Promise.resolve({
      walletFlags: WALLET_FLAGS.HARDWARE | WALLET_FLAGS.READONLY,
    })
  );
  await expect(storage.isHardwareWallet()).resolves.toBe(true);

  accessDataSpy.mockReturnValue(
    Promise.resolve({
      walletFlags: 0,
    })
  );
  await expect(storage.isHardwareWallet()).resolves.toBe(false);

  accessDataSpy.mockReturnValue(
    Promise.resolve({
      walletFlags: WALLET_FLAGS.READONLY,
    })
  );
  await expect(storage.isHardwareWallet()).resolves.toBe(false);
});

describe('utxo selection in all stores', () => {
  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await testSelectUtxos(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testSelectUtxos(store);
  });

  async function testSelectUtxos(store) {
    const storage = new Storage(store);

    const dateLocked = new Date('3000-03-01T12:00');

    const utxos = [
      {
        txId: 'tx00',
        index: 1,
        token: '00',
        address: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
        value: 10,
        authorities: 0,
        timelock: null,
        type: 0,
        height: 250,
      },
      {
        txId: 'tx01',
        index: 2,
        token: '00',
        address: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
        value: 20,
        authorities: 0,
        timelock: null,
        type: 0,
        height: 100,
      },
      {
        txId: 'tx10',
        index: 3,
        token: '1',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        value: 30,
        authorities: 0,
        timelock: Math.floor(dateLocked.getTime() / 1000),
        type: 1,
        height: null,
      },
      {
        txId: 'tx11',
        index: 4,
        token: '00',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        value: 40,
        authorities: 0,
        timelock: null,
        type: 1,
        height: null,
      },
      {
        txId: 'tx20',
        index: 5,
        token: '00',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        value: 30,
        authorities: 0,
        timelock: null,
        type: 2,
        height: null,
      },
      {
        txId: 'tx21',
        index: 6,
        token: '2',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        value: 30,
        authorities: 0,
        timelock: Math.floor(dateLocked.getTime() / 1000),
        type: 2,
        height: null,
      },
      {
        txId: 'tx30',
        index: 7,
        token: '00',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        value: 40,
        authorities: 0,
        timelock: null,
        type: 3,
        height: 200,
      },
      {
        txId: 'tx31',
        index: 8,
        token: '00',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        value: 40,
        authorities: 0,
        timelock: null,
        type: 3,
        height: 50,
      },
    ];

    // Current height is 200 with reward lock of 100
    // Blocks of height 100 and down are considered unlocked.
    //
    await storage.setCurrentHeight(200);
    storage.setApiVersion({ reward_spend_min_blocks: 100 });

    for (const u of utxos) {
      await store.saveUtxo(u);
    }
    let buf = [];
    for await (const u of storage.getAllUtxos()) {
      buf.push(u);
    }
    expect(buf).toHaveLength(8);

    // Default values will filter for HTR token
    buf = [];
    for await (const u of storage.selectUtxos({})) {
      buf.push(u);
    }
    expect(buf).toHaveLength(6);

    // only_available_utxos should filter locked utxos
    buf = [];
    for await (const u of storage.selectUtxos({ only_available_utxos: true })) {
      buf.push(u);
    }
    expect(buf).toHaveLength(4);

    // If we mark a free utxo as selected, it should not be returned with only_available_utxos
    // First we need the tx in history, for this we will mock it
    const txSpy = jest.spyOn(storage, 'getTx');
    txSpy.mockReturnValue(
      Promise.resolve({
        tx_id: 'tx01',
        index: 2,
        version: 0,
        outputs: [{}, {}, { spent_by: null }],
      })
    );
    await storage.utxoSelectAsInput({ txId: 'tx01', index: 2 }, true);
    buf = [];
    for await (const u of storage.selectUtxos({ only_available_utxos: true })) {
      buf.push(u);
    }
    expect(buf).toHaveLength(3);
    // Unmark to make it easier on the next tests
    await storage.utxoSelectAsInput({ txId: 'tx01', index: 2 }, true);
    txSpy.mockRestore();

    // Filter for custom token
    buf = [];
    for await (const u of storage.selectUtxos({ token: '2' })) {
      buf.push(u);
    }
    expect(buf).toHaveLength(1);
    expect(buf[0].txId).toEqual('tx21');
    expect(buf[0].index).toEqual(6);
  }
});

describe('scanning policy methods', () => {
  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await testScanningPolicy(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = walletUtils.getWalletIdFromXPub(xpriv.xpubkey);
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testScanningPolicy(store);
  });

  async function testScanningPolicy(store) {
    const storage = new Storage(store);
    const policyMock = jest.spyOn(storage, 'getScanningPolicy');

    // The default gap-limit is the GAP_LIMIT constant
    policyMock.mockReturnValue(Promise.resolve('gap-limit'));
    await expect(storage.getGapLimit()).resolves.toEqual(GAP_LIMIT);

    // Setting gap-limit to 27
    await storage.setGapLimit(27);
    await expect(storage.getGapLimit()).resolves.toEqual(27);

    policyMock.mockReturnValue(Promise.resolve('index-limit'));
    await expect(storage.getGapLimit()).rejects.toThrow();
  }
});

describe('getAddressPubkey', () => {
  it('should work with cached pubkey', async () => {
    const hdprivkey = new HDPrivateKey();
    const publicKey = hdprivkey.publicKey.toString('hex');
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAddress({
      base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      bip32AddressIndex: 0,
      publicKey,
    });
    await expect(storage.getAddressPubkey(0)).resolves.toEqual(publicKey);
  });

  it('should derive publicKey of not cached address pubkey', async () => {
    const hdprivkey = new HDPrivateKey();
    // Derived to change m/44'/280'/0'/0
    const hdpubkey = hdprivkey.deriveNonCompliantChild("m/44'/280'/0'/0");
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAccessData({
      xpubkey: hdpubkey.xpubkey,
    });
    await store.saveAddress({
      base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      bip32AddressIndex: 10,
    });
    // Address exists but without public key
    const publicKey10 = hdpubkey.derive(10).publicKey.toString('hex');
    await expect(storage.getAddressPubkey(10)).resolves.toEqual(publicKey10);
    // Address is not saved on storage
    const publicKey20 = hdpubkey.derive(20).publicKey.toString('hex');
    await expect(storage.getAddressPubkey(20)).resolves.toEqual(publicKey20);
  });
});
