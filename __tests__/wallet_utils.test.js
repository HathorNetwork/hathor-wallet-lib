/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import wallet from '../src/wallet';
import helpers from '../src/helpers';
import dateFormatter from '../src/date';
import { DEFAULT_SERVER } from '../src/constants';

const storage = require('../src/storage').default;

mock.onGet('getmininginfo').reply((config) => {
  const ret = {
    'blocks': 1000,
  }
  return [200, ret];
});

beforeEach(() => {
  wallet.resetAllData();
});


test('Loaded', () => {
  expect(wallet.loaded()).toBeFalsy();
  const words = wallet.generateWalletWords(256);
  wallet.executeGenerateWallet(words, '', '123456', 'password', false);
  expect(wallet.loaded()).toBeTruthy();
});

test('Clean local storage', () => {
  storage.setItem('wallet:accessData', {});
  storage.setItem('wallet:data', {});
  storage.setItem('wallet:address', '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r');
  storage.setItem('wallet:lastSharedIndex', 1);
  storage.setItem('wallet:lastGeneratedIndex', 19);
  storage.setItem('wallet:lastUsedIndex', 0);
  storage.setItem('wallet:lastUsedAddress', '1knH3y5dZuC8DQBaLhgJP33fGBr6vstr8');

  wallet.cleanLoadedData();

  expect(storage.getItem('wallet:accessData')).toBeNull();
  expect(storage.getItem('wallet:data')).toBeNull();
  expect(storage.getItem('wallet:address')).toBeNull();
  expect(storage.getItem('wallet:lastSharedIndex')).toBeNull();
  expect(storage.getItem('wallet:lastGeneratedIndex')).toBeNull();
  expect(storage.getItem('wallet:lastUsedIndex')).toBeNull();
  expect(storage.getItem('wallet:lastUsedAddress')).toBeNull();
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

test('Inputs from amount', async () => {
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

  const ret1 = await wallet.getInputsFromAmount(historyTransactionts, 10, '01');
  expect(ret1.inputs.length).toBe(0);
  expect(ret1.inputsAmount).toBe(0);

  const ret2 = await wallet.getInputsFromAmount(historyTransactionts, 200, '00');
  expect(ret2.inputs.length).toBe(1);
  expect(ret2.inputsAmount).toBe(2000);
});

test('Can use unspent txs', async () => {
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

  expect(await wallet.canUseUnspentTx(unspentTx1)).toBe(true);
  expect(await wallet.canUseUnspentTx(unspentTx2)).toBe(true);
  expect(await wallet.canUseUnspentTx(unspentTx3)).toBe(false);
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
  const accessData = storage.getItem('wallet:accessData');
  const keys = storage.getItem('wallet:data').keys;
  wallet.reloadData();
  expect(storage.getItem('wallet:accessData')).toEqual(accessData);
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
  expect(storage.getItem('wallet:server')).toBeNull();
  expect(storage.getItem('wallet:locked')).toBeNull();
  expect(storage.getItem('wallet:accessData')).toBeNull();
  expect(storage.getItem('wallet:data')).toBeNull();
  expect(storage.getItem('wallet:defaultServer')).toBe(defaultServer);
});

test('Closed', () => {
  expect(wallet.wasClosed()).toBe(false);
  wallet.close()
  expect(wallet.wasClosed()).toBe(true);
});

test('Default server', () => {
  expect(helpers.getServerURL()).toBe(DEFAULT_SERVER);

  // set default server
  const defaultServer = 'http://defaultServer';
  wallet.setDefaultServer(defaultServer);
  expect(helpers.getServerURL()).toBe(defaultServer);

  // user set server
  const server = 'http://server';
  wallet.changeServer(server);
  expect(helpers.getServerURL()).toBe(server);

  // reset wallet. Should still use the default set
  wallet.resetWalletData();
  expect(helpers.getServerURL()).toBe(defaultServer);
});
