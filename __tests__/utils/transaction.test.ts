/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PrivateKey, crypto, HDPrivateKey } from 'bitcore-lib';
import transaction from '../../src/utils/transaction';
import { UtxoError } from '../../src/errors';
import {
  BLOCK_VERSION,
  CREATE_TOKEN_TX_VERSION,
  DEFAULT_TX_VERSION,
  MERGED_MINED_BLOCK_VERSION,
  NANO_CONTRACTS_VERSION,
  POA_BLOCK_VERSION,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../src/constants';
import txApi from '../../src/api/txApi';
import { MemoryStore, Storage } from '../../src/storage';
import Input from '../../src/models/input';
import Transaction from '../../src/models/transaction';
import Output from '../../src/models/output';
import P2PKH from '../../src/models/p2pkh';
import Address from '../../src/models/address';

test('isAuthorityOutput', () => {
  expect(transaction.isAuthorityOutput({ token_data: TOKEN_AUTHORITY_MASK })).toBe(true);
  expect(transaction.isAuthorityOutput({ token_data: TOKEN_AUTHORITY_MASK | 1 })).toBe(true);
  expect(transaction.isAuthorityOutput({ token_data: TOKEN_AUTHORITY_MASK | 126 })).toBe(true);
  expect(transaction.isAuthorityOutput({ token_data: 0 })).toBe(false);
  expect(transaction.isAuthorityOutput({ token_data: 1 })).toBe(false);
  expect(transaction.isAuthorityOutput({ token_data: 126 })).toBe(false);
});

test('isMint', () => {
  expect(transaction.isMint({ value: 0n, token_data: TOKEN_AUTHORITY_MASK })).toBe(false);
  expect(transaction.isMint({ value: TOKEN_MINT_MASK, token_data: TOKEN_AUTHORITY_MASK })).toBe(
    true
  );
  expect(
    transaction.isMint({
      value: TOKEN_MINT_MASK | TOKEN_MELT_MASK,
      token_data: TOKEN_AUTHORITY_MASK,
    })
  ).toBe(true);
  expect(
    transaction.isMint({ value: TOKEN_MINT_MASK, token_data: TOKEN_AUTHORITY_MASK | 126 })
  ).toBe(true);

  expect(transaction.isMint({ value: TOKEN_MINT_MASK, token_data: 0 })).toBe(false);
  expect(transaction.isMint({ value: 1n, token_data: 1 })).toBe(false);
  expect(transaction.isMint({ value: TOKEN_MINT_MASK | 1000n, token_data: 126 })).toBe(false);
});

test('isMelt', () => {
  expect(transaction.isMelt({ value: 0n, token_data: TOKEN_AUTHORITY_MASK })).toBe(false);
  expect(transaction.isMelt({ value: TOKEN_MELT_MASK, token_data: TOKEN_AUTHORITY_MASK })).toBe(
    true
  );
  expect(
    transaction.isMelt({
      value: TOKEN_MINT_MASK | TOKEN_MELT_MASK,
      token_data: TOKEN_AUTHORITY_MASK,
    })
  ).toBe(true);
  expect(
    transaction.isMelt({ value: TOKEN_MELT_MASK, token_data: TOKEN_AUTHORITY_MASK | 126 })
  ).toBe(true);

  expect(transaction.isMelt({ value: TOKEN_MELT_MASK, token_data: 0 })).toBe(false);
  expect(transaction.isMelt({ value: 1n, token_data: 1 })).toBe(false);
  expect(transaction.isMelt({ value: TOKEN_MELT_MASK | 1000n, token_data: 126 })).toBe(false);
});

test('getSignature', () => {
  const privkey = new PrivateKey();

  const data = Buffer.from('c0ffee', 'hex');
  const hashdata = crypto.Hash.sha256(Buffer.from(data));

  const signatureDER = transaction.getSignature(hashdata, privkey);

  // A signature made with this util matches the public key
  expect(
    crypto.ECDSA.verify(hashdata, crypto.Signature.fromDER(signatureDER), privkey.toPublicKey())
  ).toBe(true);
});

test('signTransaction', async () => {
  const xpriv = new HDPrivateKey();
  const store = new MemoryStore();
  const storage = new Storage(store);
  const ownAddr = 'address-is-mine';
  const notOwnAddr = 'address-is-not-mine';
  jest.spyOn(storage, 'getMainXPrivKey').mockReturnValue(Promise.resolve(xpriv.xprivkey));
  jest.spyOn(storage, 'getAddressInfo').mockImplementation(async addr => {
    switch (addr) {
      case ownAddr:
        return {
          base58: addr,
          bip32AddressIndex: 10,
        };
      case notOwnAddr:
        return null;
      default:
        throw new Error(`Unexpected`);
    }
  });
  async function* getSpentMock(inputs) {
    let index = 0;
    for (const inp of inputs) {
      yield {
        index,
        input: inp,
        tx: {
          outputs: [
            { decoded: { address: notOwnAddr } },
            { decoded: { address: ownAddr } },
            { decoded: { data: 'not-address-output' } },
          ],
        },
      };
      index += 1;
    }
  }
  jest.spyOn(storage, 'getSpentTxs').mockImplementation(getSpentMock);
  const input0 = new Input('cafe', 0);
  const input1 = new Input('d00d', 1);
  const input2 = new Input('babe', 2);
  const input3 = new Input('F001', 3, { data: Buffer.from('010203', 'hex') });
  const tx = new Transaction([input0, input1, input2, input3], []);

  expect(await transaction.signTransaction(tx, storage, '123')).toBe(tx);
  const hashdata = tx.getDataToSignHash();
  expect(input0.data).toEqual(null);
  const sig1 = input1.data.slice(1, 1 + input1.data[0]);
  expect(
    crypto.ECDSA.verify(hashdata, crypto.Signature.fromDER(sig1), xpriv.deriveChild(10).publicKey)
  ).toBe(true);
  expect(input2.data).toEqual(null);
  expect(input3.data).toEqual(Buffer.from('010203', 'hex'));
});

test('Utxo selection', () => {
  const utxos = [
    {
      address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      value: 10n,
      txId: '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d',
      index: 5,
    },
    {
      address: 'Wmu3y4rWs6n4JJAdRtAz4mDn4d7GkTcqKc',
      value: 5n,
      txId: '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e',
      index: 6,
    },
  ];

  const selectedUtxos = transaction.selectUtxos(utxos, 3n);
  expect(selectedUtxos.utxos.length).toBe(1);
  expect(selectedUtxos.utxos[0].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e'
  );
  expect(selectedUtxos.changeAmount).toBe(2n);

  const selectedUtxos2 = transaction.selectUtxos(utxos, 5n);
  expect(selectedUtxos2.utxos.length).toBe(1);
  expect(selectedUtxos2.utxos[0].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e'
  );
  expect(selectedUtxos2.changeAmount).toBe(0n);

  const selectedUtxos3 = transaction.selectUtxos(utxos, 6n);
  expect(selectedUtxos3.utxos.length).toBe(1);
  expect(selectedUtxos3.utxos[0].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d'
  );
  expect(selectedUtxos3.changeAmount).toBe(4n);

  const selectedUtxos4 = transaction.selectUtxos(utxos, 11n);
  expect(selectedUtxos4.utxos.length).toBe(2);
  expect(selectedUtxos4.utxos[0].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d'
  );
  expect(selectedUtxos4.utxos[1].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e'
  );
  expect(selectedUtxos4.changeAmount).toBe(4n);

  const selectedUtxos5 = transaction.selectUtxos(utxos, 15n);
  expect(selectedUtxos5.utxos.length).toBe(2);
  expect(selectedUtxos5.utxos[0].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d'
  );
  expect(selectedUtxos5.utxos[1].txId).toBe(
    '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e'
  );
  expect(selectedUtxos5.changeAmount).toBe(0n);

  expect(() => {
    transaction.selectUtxos(utxos, 16);
  }).toThrow(UtxoError);

  expect(() => {
    transaction.selectUtxos(utxos, -1);
  }).toThrow(UtxoError);

  expect(() => {
    transaction.selectUtxos([], 10n);
  }).toThrow(UtxoError);
});

test('utxo from history output', () => {
  const fake_txid = 'fake-txid';
  const fake_index = 27;
  const addressPath = 'fake-address-path';

  const txout1 = {
    token: '00',
    token_data: 0,
    value: 5n,
    decoded: {
      address: 'fake-address',
      timelock: 10,
    },
  };

  expect(transaction.utxoFromHistoryOutput(fake_txid, fake_index, txout1, { addressPath })).toEqual(
    {
      txId: fake_txid,
      index: fake_index,
      addressPath,
      address: 'fake-address',
      timelock: 10,
      tokenId: '00',
      value: 5n,
      authorities: 0n,
      heightlock: null, // heightlock is not checked on this method.
      locked: false, // The method does not check the lock.
    }
  );

  // Custom token without timelock
  const txout2 = {
    token: 'custom-token',
    token_data: 5,
    value: 30n,
    decoded: {
      address: 'fake-address-2',
    },
  };

  expect(transaction.utxoFromHistoryOutput(fake_txid, fake_index, txout2, { addressPath })).toEqual(
    {
      txId: fake_txid,
      index: fake_index,
      addressPath,
      address: 'fake-address-2',
      timelock: null,
      tokenId: 'custom-token',
      value: 30n,
      authorities: 0n,
      heightlock: null, // heightlock is not checked on this method.
      locked: false, // The method does not check the lock.
    }
  );

  // Custom token authority
  const txout3 = {
    token: 'custom-token',
    token_data: 132,
    value: 2n,
    decoded: {
      address: 'fake-address-2',
    },
  };

  expect(transaction.utxoFromHistoryOutput(fake_txid, fake_index, txout3, { addressPath })).toEqual(
    {
      txId: fake_txid,
      index: fake_index,
      addressPath,
      address: 'fake-address-2',
      timelock: null,
      tokenId: 'custom-token',
      value: 2n,
      authorities: 2n,
      heightlock: null, // heightlock is not checked on this method.
      locked: false, // The method does not check the lock.
    }
  );
});

test('getTokenDataFromOutput', () => {
  const utxoMint = { type: 'mint', authorities: 0n };
  expect(transaction.getTokenDataFromOutput(utxoMint, [])).toEqual(1);
  const utxoMintAuth = { type: 'mint', authorities: 1n };
  expect(transaction.getTokenDataFromOutput(utxoMintAuth, [])).toEqual(1 | TOKEN_AUTHORITY_MASK);
  const utxoMintAuth2 = { type: 'mint', authorities: 123n };
  expect(transaction.getTokenDataFromOutput(utxoMintAuth2, [])).toEqual(1 | TOKEN_AUTHORITY_MASK);

  const utxoMelt = { type: 'melt', authorities: 0n };
  expect(transaction.getTokenDataFromOutput(utxoMelt, [])).toEqual(1);
  const utxoMeltAuth = { type: 'melt', authorities: 1n };
  expect(transaction.getTokenDataFromOutput(utxoMeltAuth, [])).toEqual(1 | TOKEN_AUTHORITY_MASK);
  const utxoMeltAuth2 = { type: 'melt', authorities: 123n };
  expect(transaction.getTokenDataFromOutput(utxoMeltAuth2, [])).toEqual(1 | TOKEN_AUTHORITY_MASK);

  const utxoHTR = { type: 'p2pkh', token: '00', authorities: 0n };
  expect(transaction.getTokenDataFromOutput(utxoHTR, ['02', '01', '03'])).toEqual(0);
  const utxoCustom = { type: 'p2pkh', token: '01', authorities: 0n };
  expect(transaction.getTokenDataFromOutput(utxoCustom, ['02', '01', '03'])).toEqual(2);
  const utxoCustomAuth = { type: 'p2pkh', token: '01', authorities: 1n };
  expect(transaction.getTokenDataFromOutput(utxoCustomAuth, ['03', '02', '01'])).toEqual(
    3 | TOKEN_AUTHORITY_MASK
  );
  const utxoCustomAuth2 = { type: 'p2pkh', token: '01', authorities: 2n };
  expect(transaction.getTokenDataFromOutput(utxoCustomAuth2, ['02', '01'])).toEqual(
    2 | TOKEN_AUTHORITY_MASK
  );
});

test('authorities from output', () => {
  const output = { token_data: 0, value: 123n };
  const outputMint = { token_data: TOKEN_AUTHORITY_MASK | 1, value: TOKEN_MINT_MASK };
  const outputMelt = { token_data: TOKEN_AUTHORITY_MASK | 2, value: TOKEN_MELT_MASK };
  const outputMintMelt = {
    token_data: TOKEN_AUTHORITY_MASK | 3,
    value: TOKEN_MELT_MASK | TOKEN_MINT_MASK,
  };
  expect(transaction.authoritiesFromOutput(output)).toEqual(0n);
  expect(transaction.authoritiesFromOutput(outputMint)).toEqual(1n);
  expect(transaction.authoritiesFromOutput(outputMelt)).toEqual(2n);
  expect(transaction.authoritiesFromOutput(outputMintMelt)).toEqual(3n);
});

test('canUseUtxo', async () => {
  const tsFromDate = date => Math.floor(date.getTime() / 1000);
  const t1 = new Date('2020-11-25T18:00:00');
  const t2 = new Date('2020-11-27T21:00:00');
  const t3 = new Date('2022-04-16T17:00:00');
  const t4 = new Date('2023-03-20T11:00:00');

  const store = new MemoryStore();
  const storage = new Storage(store);

  jest.spyOn(storage, 'getCurrentHeight').mockReturnValue(Promise.resolve(10));
  const txSpy = jest.spyOn(storage, 'getTx');
  const isSelSpy = jest
    .spyOn(storage, 'isUtxoSelectedAsInput')
    .mockReturnValue(Promise.resolve(false));
  storage.version = { reward_spend_min_blocks: 5 };

  jest.useFakeTimers();
  jest.setSystemTime(t3);

  // Free tx, in both timelock, heightlock and not selected as input
  const tx1 = {
    height: 1, // +reward_lock = 6 and current height is 10, so it's unlocked!
    outputs: [
      {
        decoded: {
          timelock: tsFromDate(t1), // unlocked
        },
      },
      {
        decoded: {
          timelock: tsFromDate(t4), // locked
        },
      },
    ],
  };
  txSpy.mockReturnValue(Promise.resolve(tx1));
  await expect(transaction.canUseUtxo({ txId: 'tx1', index: 0 }, storage)).resolves.toBe(true);

  // Marking as selected as input should make it fail
  isSelSpy.mockReturnValueOnce(Promise.resolve(true));
  await expect(transaction.canUseUtxo({ txId: 'tx1', index: 0 }, storage)).resolves.toBe(false);
  // And if it got unselected it would work again
  await expect(transaction.canUseUtxo({ txId: 'tx1', index: 0 }, storage)).resolves.toBe(true);

  // Timelocked
  await expect(transaction.canUseUtxo({ txId: 'tx1', index: 1 }, storage)).resolves.toBe(false);
  // Timelocked and selected should not interfere in each other
  isSelSpy.mockReturnValueOnce(Promise.resolve(true));
  await expect(transaction.canUseUtxo({ txId: 'tx1', index: 1 }, storage)).resolves.toBe(false);

  // Heightlocked
  const tx2 = {
    height: 6, // +reward_lock = 11 and current height is 10, so it's locked!
    outputs: [
      {
        decoded: {
          timelock: tsFromDate(t2), // unlocked
        },
      },
      {
        decoded: {
          timelock: tsFromDate(t4), // locked
        },
      },
    ],
  };
  txSpy.mockReturnValue(Promise.resolve(tx2));
  await expect(transaction.canUseUtxo({ txId: 'tx2', index: 0 }, storage)).resolves.toBe(false);
  // Heightlocked and selected should not interfere in each other
  isSelSpy.mockReturnValueOnce(Promise.resolve(true));
  await expect(transaction.canUseUtxo({ txId: 'tx2', index: 0 }, storage)).resolves.toBe(false);

  // Timelocked and heightlocked
  await expect(transaction.canUseUtxo({ txId: 'tx2', index: 1 }, storage)).resolves.toBe(false);

  // All types of locks at the same time
  isSelSpy.mockReturnValueOnce(Promise.resolve(true));
  await expect(transaction.canUseUtxo({ txId: 'tx2', index: 1 }, storage)).resolves.toBe(false);

  // A transaction does not have height, so it cannot be heightlocked
  const tx3 = {
    height: null,
    outputs: [
      {
        decoded: {
          timelock: tsFromDate(t2), // unlocked
        },
      },
      {
        decoded: {
          timelock: tsFromDate(t4), // locked
        },
      },
    ],
  };
  txSpy.mockReturnValue(Promise.resolve(tx3));
  await expect(transaction.canUseUtxo({ txId: 'tx3', index: 0 }, storage)).resolves.toBe(true);
  await expect(transaction.canUseUtxo({ txId: 'tx3', index: 1 }, storage)).resolves.toBe(false);
  // Even when the height is lower than the reward lock
  storage.version = { reward_spend_min_blocks: 300 };
  await expect(transaction.canUseUtxo({ txId: 'tx3', index: 0 }, storage)).resolves.toBe(true);
  await expect(transaction.canUseUtxo({ txId: 'tx3', index: 1 }, storage)).resolves.toBe(false);

  // Clean fake timers config
  jest.useRealTimers();
});

test('isBlock', () => {
  expect(transaction.isBlock({ version: BLOCK_VERSION })).toBe(true);
  expect(transaction.isBlock({ version: DEFAULT_TX_VERSION })).toBe(false);
  expect(transaction.isBlock({ version: CREATE_TOKEN_TX_VERSION })).toBe(false);
  expect(transaction.isBlock({ version: MERGED_MINED_BLOCK_VERSION })).toBe(true);
  expect(transaction.isBlock({ version: POA_BLOCK_VERSION })).toBe(true);
});

test('getTxType', () => {
  expect(transaction.getTxType({ version: BLOCK_VERSION })).toBe('Block');
  expect(transaction.getTxType({ version: DEFAULT_TX_VERSION })).toBe('Transaction');
  expect(transaction.getTxType({ version: CREATE_TOKEN_TX_VERSION })).toBe(
    'Create Token Transaction'
  );
  expect(transaction.getTxType({ version: MERGED_MINED_BLOCK_VERSION })).toBe(
    'Merged Mining Block'
  );
  expect(transaction.getTxType({ version: NANO_CONTRACTS_VERSION })).toBe('Nano Contract');
  expect(transaction.getTxType({ version: POA_BLOCK_VERSION })).toBe('Proof-of-Authority Block');
  expect(transaction.getTxType({ version: 999 })).toBe('Unknown');
});

test('convertTransactionToHistoryTx', async () => {
  const p2pkh = new P2PKH(new Address('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp'));
  const script = p2pkh.createScript();
  const store = new MemoryStore();
  await store.saveTx({
    tx_id: 'from-storage-tx1',
    inputs: [],
    outputs: [
      {
        script: script.toString('hex'),
        decoded: { address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp' },
        spent_by: null,
        token: 'token-C',
        token_data: 2,
        value: 123n,
        selected_as_input: false,
      },
      {
        script: script.toString('hex'),
        decoded: { address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp' },
        spent_by: null,
        token: 'token-A',
        token_data: 1,
        value: 1n,
        selected_as_input: false,
      },
    ],
    tokens: [],
    is_voided: false,
    nonce: 456,
    parents: [],
    timestamp: 123,
    version: 1,
    weight: 18,
  });

  const storage = new Storage(store);
  storage.config.setNetwork('testnet');
  const getTxSpy = jest.spyOn(txApi, 'getTransaction');
  const tx = new Transaction([], [], {
    hash: '',
    parents: ['parent-1', 'parent-2'],
    nonce: 123,
    timestamp: 456,
    tokens: ['token-A', 'token-B'],
    version: 1,
    signalBits: 5,
    weight: 18,
  });

  getTxSpy.mockImplementation(async (txId, resolve) => {
    switch (txId) {
      case 'resolve-fail':
        resolve({ success: false, message: 'failed api call' });
        break;
      case 'no-outputs':
        resolve({
          success: true,
          tx: { outputs: [] },
        });
        break;
      case 'fail':
        throw new Error('Boom!');
      case 'from-api-tx1':
        resolve({
          success: true,
          tx: {
            outputs: [
              {
                value: 2n,
                token_data: 129,
                script: script.toString('hex'),
                token: 'token-B',
                decoded: {
                  type: 'P2PKH',
                  address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
                  timelock: undefined,
                  token_data: 129,
                  value: 2n,
                },
                spent_by: null,
              },
            ],
            tokens: [{ uid: 'token-B', name: 'Token B', symbol: 'TKB' }],
            inputs: [],
            nonce: '',
            timestamp: 0,
            version: 1,
            weight: 19.0,
            signal_bits: 0,
            parents: [],
            hash: '',
            raw: '',
          },
          meta: {
            hash: '',
            accumulated_weight: 0,
            children: [],
            conflict_with: [],
            feature_activation_bit_counts: [],
            height: 0,
            min_height: 0,
            received_by: [],
            score: 0,
            spent_outputs: [],
            twins: [],
            voided_by: [],
            first_block: '',
            first_block_height: 0,
            validation: '',
          },
          spent_outputs: [],
        });
        break;
      default:
        throw new Error('Unknown test case');
    }
  });

  try {
    tx.hash = 'resolve-fail-case';
    tx.inputs = [new Input('resolve-fail', 0)];
    await expect(transaction.convertTransactionToHistoryTx(tx, storage)).rejects.toThrow(
      'failed api call'
    );
    tx.hash = 'no-outputs-case';
    tx.inputs = [new Input('no-outputs', 0)];
    await expect(transaction.convertTransactionToHistoryTx(tx, storage)).rejects.toThrow(
      'Index outside of tx output array bounds'
    );

    tx.hash = 'fail-case';
    tx.inputs = [new Input('fail', 0)];
    await expect(transaction.convertTransactionToHistoryTx(tx, storage)).rejects.toThrow('Boom!');

    tx.hash = 'success-case';
    tx.inputs = [new Input('from-storage-tx1', 1), new Input('from-api-tx1', 0)];
    tx.outputs = [new Output(3n, script)];
    await expect(transaction.convertTransactionToHistoryTx(tx, storage)).resolves.toEqual({
      tx_id: 'success-case',
      parents: ['parent-1', 'parent-2'],
      nonce: 123,
      timestamp: 456,
      tokens: ['token-A', 'token-B'],
      version: 1,
      signalBits: 5,
      weight: 18,
      is_voided: false,
      inputs: [
        {
          tx_id: 'from-storage-tx1',
          index: 1,
          script: script.toString('hex'),
          decoded: { address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp' },
          token_data: 1,
          token: 'token-A',
          value: 1n,
        },
        {
          tx_id: 'from-api-tx1',
          index: 0,
          script: script.toString('hex'),
          decoded: {
            type: 'P2PKH',
            address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
            timelock: undefined,
            token_data: 129,
            value: 2n,
          },
          token_data: 129,
          token: 'token-B',
          value: 2n,
        },
      ],
      outputs: [
        {
          value: 3n,
          token_data: 0,
          script: script.toString('hex'),
          decoded: {
            type: 'P2PKH',
            address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
            timelock: null,
          },
          token: '00',
          spent_by: null,
        },
      ],
    });
  } finally {
    getTxSpy.mockRestore();
  }
});
