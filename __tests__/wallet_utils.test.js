/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import wallet from '../src/wallet';
import dateFormatter from '../src/date';
import { GAP_LIMIT } from '../src/constants';
import config, { DEFAULT_SERVER } from '../src/config';
import { WalletTypeError } from '../src/errors';
import storage from '../src/storage';
import WebSocketHandler from '../src/WebSocketHandler';
import { hexToBuffer } from '../src/utils/buffer';


beforeEach(() => {
  wallet.setConnection(WebSocketHandler);
  wallet.setGapLimit(GAP_LIMIT);
  wallet.resetAllData();
  // Because we call resetAllData we must set the localhost as server again here
  storage.setItem('wallet:server', 'http://localhost:8080/');
  WebSocketHandler.setup();
});

// Mock any GET request to /thin_wallet/address_history
// arguments for reply are (status, data, headers)
mock.onGet('thin_wallet/address_history').reply((config) => {
  if (config.params.addresses.indexOf('WgPiMqEcT2vMpQEy2arDkEcfEtGJhofyGd') > -1) {
    const ret = {
      'success': true,
      'has_more': false,
      'history': [
        {
          'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e',
          'timestamp': 1548892556,
          'is_voided': false,
          'inputs': [],
          'outputs': [
            {
              'decoded': {
                'timelock': null,
                'address': 'WgPiMqEcT2vMpQEy2arDkEcfEtGJhofyGd',
              },
              'token': '00',
              'value': 2000,
              'voided': false
            }
          ],
        }
      ]
    }
    return [200, ret];
  } else {
    return [200, {'success': true, 'has_more': false, 'history': []}];
  }
});


test('Loaded', () => {
  expect(wallet.loaded()).toBeFalsy();
  const words = wallet.generateWalletWords(256);
  wallet.executeGenerateWallet(words, '', '123456', 'password', false);
  expect(wallet.loaded()).toBeTruthy();
});

test('Clean local storage', () => {
  const setMockData = () => {
    wallet.setWalletAccessData({});
    wallet.setWalletData({});
    storage.setItem('wallet:address', '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r');
    storage.setItem('wallet:lastSharedIndex', 1);
    storage.setItem('wallet:lastGeneratedIndex', 19);
    storage.setItem('wallet:lastUsedIndex', 0);
    storage.setItem('wallet:lastUsedAddress', '1knH3y5dZuC8DQBaLhgJP33fGBr6vstr8');
  }

  setMockData();

  expect(wallet.getWalletAccessData()).not.toBeNull();
  expect(wallet.getWalletData()).not.toBeNull();
  expect(storage.getItem('wallet:address')).not.toBeNull();
  expect(storage.getItem('wallet:lastSharedIndex')).not.toBeNull();
  expect(storage.getItem('wallet:lastGeneratedIndex')).not.toBeNull();
  expect(storage.getItem('wallet:lastUsedIndex')).not.toBeNull();
  expect(storage.getItem('wallet:lastUsedAddress')).not.toBeNull();

  wallet.cleanLoadedData();

  const testStorageCleaned = (cleanAccessData) => {
    if (cleanAccessData) {
      expect(wallet.getWalletAccessData()).toBeNull();
    } else {
      expect(wallet.getWalletAccessData()).not.toBeNull();
    }
    expect(wallet.getWalletData()).toBeNull();
    expect(storage.getItem('wallet:address')).toBeNull();
    expect(storage.getItem('wallet:lastSharedIndex')).toBeNull();
    expect(storage.getItem('wallet:lastGeneratedIndex')).toBeNull();
    expect(storage.getItem('wallet:lastUsedIndex')).toBeNull();
    expect(storage.getItem('wallet:lastUsedAddress')).toBeNull();
  }

  testStorageCleaned(true);

  setMockData();
  wallet.cleanLoadedData({ cleanAccessData: true });
  testStorageCleaned(true);

  setMockData();
  wallet.cleanLoadedData({ cleanAccessData: false });
  testStorageCleaned(false);

  setMockData();
  wallet.cleanWallet({ cleanAccessData: true });
  testStorageCleaned(true);

  setMockData();
  wallet.cleanWallet({ cleanAccessData: false });
  testStorageCleaned(false);
});

test('Save address history to storage', () => {
  expect(storage.getItem('wallet:data')).toBeNull();
  storage.setItem('wallet:data', {});
  const historyTransactions = {'id': {'tx_id': 'id'}}
  const allTokens = new Set(['00']);
  wallet.saveAddressHistory(historyTransactions, allTokens);

  let data = storage.getItem('wallet:data');
  expect(data.historyTransactions).toEqual(expect.objectContaining(historyTransactions));
  expect(data.allTokens).toEqual(expect.objectContaining(allTokens));
});

test('Valid words', () => {
  expect(wallet.wordsValid('less than 24 words').valid).toBe(false);
  expect(wallet.wordsValid('a a a a a a a a a a a a a a a a a a a a a a a a').valid).toBe(false);
  expect(wallet.wordsValid(123).valid).toBe(false);
  expect(wallet.wordsValid(256).valid).toBe(false);
  expect(wallet.wordsValid({}).valid).toBe(false);
  const words = wallet.generateWalletWords(256);
  expect(wallet.wordsValid(words).valid).toBe(true);
});

test('Inputs from amount', () => {
  const historyTransactionts = {
    '1': {
      'tx_id': '1',
      'outputs': [
        {
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
          },
          'value': 2000,
          'token': '00',
          'spent_by': null
        },
        {
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
          },
          'value': 2000,
          'token': '00',
          'spent_by': null
        },
      ],
      'inputs': [],
    },
  }
  storage.setItem('wallet:data', {'keys': {'171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r': {}}});

  const ret1 = wallet.getInputsFromAmount(historyTransactionts, 10, '01');
  expect(ret1.inputs.length).toBe(0);
  expect(ret1.inputsAmount).toBe(0);

  const ret2 = wallet.getInputsFromAmount(historyTransactionts, 200, '00');
  expect(ret2.inputs.length).toBe(1);
  expect(ret2.inputsAmount).toBe(2000);
});

test('Can use unspent txs', () => {
  const unspentTx1 = {
    'decoded': {
      'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
      'timelock': null,
    },
    'value': 2000,
    'spent_by': null,
  };
  const timestamp = dateFormatter.dateToTimestamp(new Date());
  const unspentTx2 = {
    'decoded': {
      'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
      'timelock': timestamp - 1,
    },
    'value': 2000,
    'spent_by': null,
  };
  const unspentTx3 = {
    'decoded': {
      'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
      'timelock': timestamp + 1000,
    },
    'value': 2000,
    'spent_by': null,
  };

  expect(wallet.canUseUnspentTx(unspentTx1)).toBe(true);
  expect(wallet.canUseUnspentTx(unspentTx2)).toBe(true);
  expect(wallet.canUseUnspentTx(unspentTx3)).toBe(false);
});

test('Output change', async () => {
  const words = wallet.generateWalletWords(256);
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  let lastSharedIndex = storage.getItem('wallet:lastSharedIndex');
  let address = storage.getItem('wallet:address');
  let change = wallet.getOutputChange(1000, '00');

  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(lastSharedIndex+1);
  expect(change.address).toBe(address);
  expect(change.value).toBe(1000);
  expect(storage.getItem('wallet:address')).not.toBe(address);

  storage.setItem('wallet:lastSharedIndex', storage.getItem('wallet:lastGeneratedIndex'));
  wallet.getOutputChange(1000, '00');
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(parseInt(storage.getItem('wallet:lastGeneratedIndex'), 10));
});

test('Unspent txs exist', () => {
  const historyTransactionts = {
    '1': {
      'tx_id': '1',
      'outputs': [
        {
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
          },
          'value': 2000,
          'token': '00',
          'spent_by': null
        },
        {
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
          },
          'value': 2000,
          'token': '00',
          'spent_by': null
        },
      ],
      'inputs': [],
    },
  }

  storage.setItem('wallet:data', {'keys': {'171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r': {}}});

  expect(wallet.checkUnspentTxExists(historyTransactionts, '0', '0', '00').exists).toBe(false);
  expect(wallet.checkUnspentTxExists(historyTransactionts, '0', '0', '01').exists).toBe(false);
  expect(wallet.checkUnspentTxExists(historyTransactionts, '1', '0', '00').exists).toBe(true);
  expect(wallet.checkUnspentTxExists(historyTransactionts, '1', '1', '00').exists).toBe(true);
  expect(wallet.checkUnspentTxExists(historyTransactionts, '0', '1', '00').exists).toBe(false);
});

test('Wallet locked', () => {
  expect(wallet.isLocked()).toBe(false);
  wallet.lock();
  expect(wallet.isLocked()).toBe(true);
  wallet.unlock();
  expect(wallet.isLocked()).toBe(false);
});

test('Wallet backup', () => {
  expect(wallet.isBackupDone()).toBe(false);
  wallet.markBackupAsDone();
  expect(wallet.isBackupDone()).toBe(true);
  wallet.markBackupAsNotDone();
  expect(wallet.isBackupDone()).toBe(false);
});

test('Get wallet words', async () => {
  const words = wallet.generateWalletWords(256);
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(0)

  const sharedAddress = storage.getItem('wallet:address');
  const key = storage.getItem('wallet:data').keys[sharedAddress];
  expect(wallet.getWalletWords('password')).toBe(words);

  wallet.addPassphrase('passphrase', '123456', 'password');
  expect(wallet.getWalletWords('password')).toBe(words);
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(0)

  const newSharedAddress = storage.getItem('wallet:address');
  expect(sharedAddress).not.toBe(newSharedAddress);
  expect(key.index).toBe(storage.getItem('wallet:data').keys[newSharedAddress].index);
});

test('Reload data', async () => {
  const words = wallet.generateWalletWords(256);
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  const accessData = wallet.getWalletAccessData();
  const keys = wallet.getWalletData().keys;
  wallet.reloadData();
  expect(wallet.getWalletAccessData()).toEqual(accessData);
});

test('Started', () => {
  expect(wallet.started()).toBe(false);
  wallet.markWalletAsStarted();
  expect(wallet.started()).toBe(true);
});

test('Reset all data', async () => {
  const words = wallet.generateWalletWords(256);
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  wallet.markWalletAsStarted();
  const server = 'http://server';
  const defaultServer = 'http://defaultServer';
  wallet.changeServer(server);
  wallet.setDefaultServer(defaultServer);
  expect(storage.getItem('wallet:server')).toBe(server);
  expect(storage.getItem('wallet:defaultServer')).toBe(defaultServer);
  wallet.lock();

  wallet.resetWalletData();

  expect(storage.getItem('wallet:started')).toBeNull();
  expect(storage.getItem('wallet:locked')).toBeNull();
  expect(wallet.getWalletAccessData()).toBeNull();
  expect(wallet.getWalletData()).toBeNull();
  expect(storage.getItem('wallet:defaultServer')).toBe(defaultServer);
});

test('Closed', () => {
  expect(wallet.wasClosed()).toBe(false);
  wallet.close()
  expect(wallet.wasClosed()).toBe(true);
});

test('Default server', () => {
  wallet.cleanServer();
  expect(config.getServerUrl()).toBe(DEFAULT_SERVER);

  // set default server
  const defaultServer = 'http://defaultServer';
  wallet.setDefaultServer(defaultServer);
  expect(config.getServerUrl()).toBe(defaultServer);

  // user set server
  const server = 'http://server';
  wallet.changeServer(server);
  expect(config.getServerUrl()).toBe(server);

  // Reset wallet data does not clean server.
  wallet.resetWalletData();
  expect(config.getServerUrl()).toBe(server);

  // Now clean server will erase the server
  wallet.cleanServer();
  expect(config.getServerUrl()).toBe(defaultServer);
});

test('Wallet type', () => {
  // invalid wallet type
  expect(() => {wallet.setWalletType('soft')}).toThrow(WalletTypeError);
  // set software wallet
  wallet.setWalletType('software');
  expect(wallet.isSoftwareWallet()).toBe(true);
  // set hardware wallet
  wallet.setWalletType('hardware');
  expect(wallet.isHardwareWallet()).toBe(true);
});

test('xpub from data', () => {
  const xpub = 'xpub6EkEDTu2Ya2bQrgRSs6QGh5tbNtntrTmEK4ueofBYDoeET2Pj6UkbMgfu7KarBGqbED591aY3LFj2jP9tZ24FnPhUQuk1SrUiwZ3SgHAgEt';
  const pubkey = hexToBuffer('02b8f9f08dcc76a28190c64faae77975c997622800597a6bffbc45ecd221d6b678');
  const chainCode = hexToBuffer('676e546dab43fd1603c5b1f059da144608ac833cc0ea73d6798b19144bf25b1e');
  const fingerprint = hexToBuffer('a4f5d5bf');
  expect(wallet.xpubFromData(pubkey, chainCode, fingerprint)).toBe(xpub);
});

test('compress pubkey', () => {
  const uncompressed = hexToBuffer('044f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1');
  const compressed = hexToBuffer('034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa');
  expect(wallet.toPubkeyCompressed(uncompressed)).toEqual(compressed);
});

test('get public key from index', () => {
  // we get some keys from a previously know xpub
  const pubkeys = {
    0: '03e87885d9d400672f27f05c3f42fe881b4ca940c6413400bb02e0779d62b725cc',
    10: '024682a4b52ae527a1ad6b527b50d4c4767931b6bf17b09399af447f2e350f0b8d',
    50: '0331e2f0a357538971146820f54f6deb794fbb0d7610bfa978562929e2bba8a67e',
    100: '02dd435e564faf9b7b4b421413fca2f3d46830d80e90c3c8ace5945b8da35f2e8e',
  };

  wallet.setWalletAccessData({
    xpubkey: 'xpub6F7hrAA4jGmePP7Yw82SFysRBaKDSKWH2dQngjWGKinHSJZfHKRCCo98fAUCam8erAYBjdf8DVn7VoJWpSDR7zFZSoVuv3XV631GVyGty6X'
  });

  for (const entry of Object.entries(pubkeys)) {
    const index = entry[0];
    const pubkey = entry[1];
    expect(wallet.getPublicKey(parseInt(index)).toString('hex')).toBe(pubkey);
  }
});

test('Load gap limit', async () => {
  expect(wallet.getGapLimit()).toBe(GAP_LIMIT);
  const words = 'ask staff rival gesture inject wealth theory receive assault purpose luxury exile swim neglect recipe tree opinion salmon ladder express sheriff circle metal game';
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  const walletData = wallet.getWalletData();
  const addresses = walletData.keys;
  expect(Object.keys(addresses).length).toBe(GAP_LIMIT + 1);
  expect(wallet.getLastUsedIndex()).toBe(null);
  expect(Object.keys(walletData.historyTransactions).length).toBe(0);
});

test('Load different gap limit with history', async () => {
  expect(wallet.getGapLimit()).toBe(GAP_LIMIT);
  wallet.setGapLimit(GAP_LIMIT * 2);
  expect(wallet.getGapLimit()).toBe(GAP_LIMIT * 2);
  const words = 'ask staff rival gesture inject wealth theory receive assault purpose luxury exile swim neglect recipe tree opinion salmon ladder express sheriff circle metal game';
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  const walletData = wallet.getWalletData()
  const addresses = walletData.keys;

  // The API mock will return a tx for an address that is in the index 35
  // with this GAP_LIMIT of 40, we will be able to get this history

  // addressAtIndex35 = 'WgPiMqEcT2vMpQEy2arDkEcfEtGJhofyGd'
  expect(wallet.getLastUsedIndex()).toBe(35);
  // If I have a tx for an address at index 35, it must have GAP_LIMIT * 2 empty addresses
  expect(Object.keys(addresses).length).toBe(35 + (GAP_LIMIT * 2) + 1);

  const historyTransactionsKeys = Object.keys(walletData.historyTransactions);
  expect(historyTransactionsKeys.length).toBe(1);
  expect(historyTransactionsKeys[0]).toBe('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e');
});

test('Load different gap limit', async () => {
  expect(wallet.getGapLimit()).toBe(GAP_LIMIT);
  wallet.setGapLimit(GAP_LIMIT * 2);
  expect(wallet.getGapLimit()).toBe(GAP_LIMIT * 2);
  const words = wallet.generateWalletWords(256);
  await wallet.executeGenerateWallet(words, '', '123456', 'password', true);
  const addresses = wallet.getWalletData().keys;
  expect(Object.keys(addresses).length).toBe(GAP_LIMIT * 2 + 1);
});
