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
import { TOKEN_AUTHORITY_MASK, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';

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

test('process locked utxo', async () => {
  const nowTs = Math.floor(Date.now() / 1000);
  const tsLocked = nowTs + 60;
  const tsUnLocked = nowTs - 60;

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
            }
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

  const store = new MemoryStore();
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
      0, // token_data
    ),
    // timelocked
    getLockedUtxo(
      'tx02',
      'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      tsLocked,
      null,
      100, // value
      '00', // token
      0, // token_data
    ),
    // utxo to be unlocked by height
    getLockedUtxo(
      'tx03',
      'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      tsUnLocked,
      5,
      100, // value
      '01', // token
      0, // token_data
    ),
    // heightlocked
    getLockedUtxo(
      'tx04',
      'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      tsUnLocked,
      100,
      TOKEN_MINT_MASK, // value, mint
      '01', // token
      TOKEN_AUTHORITY_MASK | 1, // token_data
    ),
  ];
  await store.saveAddress({base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ', bip32AddressIndex: 0});
  await store.saveAddress({base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', bip32AddressIndex: 1});
  for (const lutxo of lockedUtxos) {
    await store.saveTx(lutxo.tx);
    await store.saveUtxo(getUtxoFromLocked(lutxo));
    await store.saveLockedUtxo(lutxo);
  }
  // at first all utxos are locked
  store.addressesMetadata = new Map([
    [
      'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      {
        numTransactions: 2,
        balance: new Map([
          [
            '00',
            {
              tokens: { locked: 200, unlocked: 0 },
              authorities: { mint: { locked: 0, unlocked: 0 }, melt: { locked: 0, unlocked: 0 } },
            },
          ]
        ]),
      },
    ],
    [
      'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      {
        numTransactions: 2,
        balance: new Map([
          [
            '01',
            {
              tokens: { locked: 100, unlocked: 0 },
              authorities: { mint: { locked: 1, unlocked: 0 }, melt: { locked: 0, unlocked: 0 } },
            },
          ]
        ]),
      },
    ],
  ]);

  // time has passed, unlocking some utxos
  await storage.processLockedUtxos(1);
  let firstAddrMeta = store.addressesMetadata.get('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ');
  let secondAddrMeta = store.addressesMetadata.get('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp');
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

  // Now we have a new heigth, unlocking some utxos
  await storage.processLockedUtxos(10);
  // XXX check if utxos were unlocked
  firstAddrMeta = store.addressesMetadata.get('WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ');
  secondAddrMeta = store.addressesMetadata.get('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp');
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
});