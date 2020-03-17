/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import wallet from '../src/wallet';
import { GAP_LIMIT } from '../src/constants';
import helpers from '../src/helpers';
import Connection from '../src/new/connection';
import WebSocketHandler from '../src/WebSocketHandler';

const url = helpers.getServerURL();
const conn = new Connection({network: 'testnet', servers: [url]});
conn.websocket.setup()

const StorageProxy = require('../src/storage_proxy').default;
const storage = StorageProxy.getStorage();

beforeEach(() => {
  WebSocketHandler.ws.started = false;
  wallet.cleanLoadedData();
});

test('Update address', () => {
  let address1 = '1zEETJWa3U6fBm8eUXbG7ddj6k4KjoR7j';
  let index1 = 10;
  wallet.updateAddress(address1, index1, false);
  expect(storage.getItem('wallet:address')).toBe(address1);
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(index1);

  let address2 = '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r';
  let index2 = 20;
  wallet.updateAddress(address2, index2, false);
  expect(storage.getItem('wallet:address')).toBe(address2);
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(index2);
})

test('Has a new address already generated', () => {
  storage.setItem('wallet:lastGeneratedIndex', 10);
  storage.setItem('wallet:lastSharedIndex', 9);

  expect(wallet.hasNewAddress()).toBe(true);

  storage.setItem('wallet:lastSharedIndex', 10);
  expect(wallet.hasNewAddress()).toBe(false);

  storage.setItem('wallet:lastSharedIndex', 11);
  expect(wallet.hasNewAddress()).toBe(false);
});

test('Get next address already generated', () => {
  storage.setItem('wallet:lastSharedIndex', 9);
  storage.setItem('wallet:data', {keys: {'1zEETJWa3U6fBm8eUXbG7ddj6k4KjoR7j': {index: 9}, '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r': {index: 10}}});

  wallet.getNextAddress()

  expect(storage.getItem('wallet:address')).toBe('171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r');
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(10);
});

test('Can generate new address', () => {
  storage.setItem('wallet:lastUsedIndex', 2);
  storage.setItem('wallet:lastGeneratedIndex', 30);

  expect(wallet.canGenerateNewAddress()).toBe(false);

  storage.setItem('wallet:lastUsedIndex', 10);
  expect(wallet.canGenerateNewAddress()).toBe(false);

  storage.setItem('wallet:lastUsedIndex', 11);
  expect(wallet.canGenerateNewAddress()).toBe(true);

  storage.setItem('wallet:lastUsedIndex', 17);
  expect(wallet.canGenerateNewAddress()).toBe(true);
});

test('Generate new address', async () => {
  WebSocketHandler.ws.started = true;
  let words = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  let pin = '123456';
  await wallet.executeGenerateWallet(words, '', pin, 'password', true);
  let data = storage.getItem('wallet:data');
  expect(Object.keys(data.keys).length).toBe(GAP_LIMIT + 1);
  expect(parseInt(storage.getItem('wallet:lastGeneratedIndex'), 10)).toBe(GAP_LIMIT);
  expect(storage.store.getItem('wallet:lastSharedIndex')).toBe(0);

  for (let address in data.keys) {
    if (data.keys[address].index === 0) {
      expect(storage.getItem('wallet:address')).toBe(address);
      break;
    }
  }

  // Set last shared index as last generated also
  storage.setItem('wallet:lastSharedIndex', GAP_LIMIT - 1);

  wallet.generateNewAddress();
  
  let newData = storage.getItem('wallet:data');
  expect(Object.keys(newData.keys).length).toBe(GAP_LIMIT + 1);
  expect(parseInt(storage.getItem('wallet:lastSharedIndex'), 10)).toBe(GAP_LIMIT);
  for (let address in newData.keys) {
    if (newData.keys[address].index === GAP_LIMIT) {
      expect(storage.getItem('wallet:address')).toBe(address);
      break;
    }
  }
});

test('Last used index', async () => {
  WebSocketHandler.ws.started = true;
  let words = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  let pin = '123456';
  await wallet.executeGenerateWallet(words, '', pin, 'password', true);

  let data = storage.getItem('wallet:data');
  for (let address in data.keys) {
    if (data.keys[address].index === 12) {
      wallet.setLastUsedIndex(address);
      expect(parseInt(storage.getItem('wallet:lastUsedIndex'), 10)).toBe(12);
      expect(storage.getItem('wallet:lastUsedAddress')).toBe(address);
      break;
    }
  }
});

test('Subscribe address to websocket', done => {
  let address = '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r';
  conn.websocket.on('subscribe_success', (wsData) => {
    if (wsData.address === address) {
      // If got here test was successful, so ending it
      done();
    }
  });
  wallet.subscribeAddress(address, conn);
});

test('Subscribe all addresses to websocket', (done) => {
  let addresses = [
    '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
    '13NREDS4kVKTvkDxcXS5JACRnD8DBHJb3A',
    '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
    '17JqwHofr3rjYApvSa91duvcmsLai7mTHp',
    '134dPXThGpkrQ932LNQV1seVCcaABqjfVW',
    '14KxvBJtsNuPrQci2Ecd5LD5En9ntab71u',
    '12J24268HH8FhdMQM59GUToe4pKsG42Tm6',
    '12z9DLQKU3xahC1zFFRdo6VpzyupxMtvoF',
    '1HDxnAmhqS6VvT1h5D7QtooEdnw9cwPQP2',
    '1CdKN9tYzanCobigUKU2caqkuYSDXr4Qas'
  ];
  let keys = {};
  for (let address of addresses) {
    keys[address] = {};
  }
  storage.setItem('wallet:data', {keys: keys});
  conn.websocket.on('subscribe_success', function handler(wsData) {
    let foundIndex = -1;
    for (let [idx, address] of addresses.entries()) {
      if (address === wsData.address) {
        foundIndex = idx;
        break;
      }
    }

    if (foundIndex > -1) {
      addresses.splice(foundIndex, 1);
    }

    if (addresses.length === 0) {
      // If got here test was successful, so ending it
      conn.websocket.removeListener('subscribe_success', handler);
      done();
    }
  });
  wallet.subscribeAllAddresses(conn);
});
