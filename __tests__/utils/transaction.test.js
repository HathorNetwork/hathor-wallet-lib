/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transaction from '../../src/utils/transaction';
import { UtxoError } from '../../src/errors';
import { PrivateKey, crypto } from 'bitcore-lib';
import { BLOCK_VERSION, CREATE_TOKEN_TX_VERSION, DEFAULT_TX_VERSION, MERGED_MINED_BLOCK_VERSION, TOKEN_AUTHORITY_MASK, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import { HDPrivateKey } from 'bitcore-lib';
import Input from '../../src/models/input';
import Transaction from '../../src/models/transaction';

test('isAuthorityOutput', () => {
  expect(transaction.isAuthorityOutput({token_data: TOKEN_AUTHORITY_MASK})).toBe(true);
  expect(transaction.isAuthorityOutput({token_data: TOKEN_AUTHORITY_MASK|1})).toBe(true);
  expect(transaction.isAuthorityOutput({token_data: TOKEN_AUTHORITY_MASK|126})).toBe(true);
  expect(transaction.isAuthorityOutput({token_data: 0})).toBe(false);
  expect(transaction.isAuthorityOutput({token_data: 1})).toBe(false);
  expect(transaction.isAuthorityOutput({token_data: 126})).toBe(false);
});

test('isMint', () => {
  expect(transaction.isMint({value: 0, token_data: TOKEN_AUTHORITY_MASK})).toBe(false);
  expect(transaction.isMint({value: TOKEN_MINT_MASK, token_data: TOKEN_AUTHORITY_MASK})).toBe(true);
  expect(transaction.isMint({value: TOKEN_MINT_MASK|TOKEN_MELT_MASK, token_data: TOKEN_AUTHORITY_MASK})).toBe(true);
  expect(transaction.isMint({value: TOKEN_MINT_MASK, token_data: TOKEN_AUTHORITY_MASK|126})).toBe(true);

  expect(transaction.isMint({value: TOKEN_MINT_MASK, token_data: 0})).toBe(false);
  expect(transaction.isMint({value: 1, token_data: 1})).toBe(false);
  expect(transaction.isMint({value: TOKEN_MINT_MASK|1000, token_data: 126})).toBe(false);
});

test('isMelt', () => {
  expect(transaction.isMelt({value: 0, token_data: TOKEN_AUTHORITY_MASK})).toBe(false);
  expect(transaction.isMelt({value: TOKEN_MELT_MASK, token_data: TOKEN_AUTHORITY_MASK})).toBe(true);
  expect(transaction.isMelt({value: TOKEN_MINT_MASK|TOKEN_MELT_MASK, token_data: TOKEN_AUTHORITY_MASK})).toBe(true);
  expect(transaction.isMelt({value: TOKEN_MELT_MASK, token_data: TOKEN_AUTHORITY_MASK|126})).toBe(true);

  expect(transaction.isMelt({value: TOKEN_MELT_MASK, token_data: 0})).toBe(false);
  expect(transaction.isMelt({value: 1, token_data: 1})).toBe(false);
  expect(transaction.isMelt({value: TOKEN_MELT_MASK|1000, token_data: 126})).toBe(false);
});

test('getSignature', () => {
  const privkey = new PrivateKey();

  const data = Buffer.from('c0ffee', 'hex');
  const hashdata = crypto.Hash.sha256(Buffer.from(data));

  const signatureDER = transaction.getSignature(hashdata, privkey);

  // A signature made with this util matches the public key
  expect(crypto.ECDSA.verify(
    hashdata,
    crypto.Signature.fromDER(signatureDER),
    privkey.toPublicKey(),
    'little', // endianess
  )).toBe(true);
});

test('signTransaction', async () => {
  const xpriv = new HDPrivateKey();
  const store = new MemoryStore();
  const storage = new Storage(store);
  const ownAddr = 'address-is-mine';
  const notOwnAddr = 'address-is-not-mine';
  jest.spyOn(storage, 'getMainXPrivKey').mockReturnValue(Promise.resolve(xpriv.xprivkey));
  jest.spyOn(storage, 'getAddressInfo').mockImplementation(async (addr) => {
    switch(addr) {
      case ownAddr:
        return {
          base58: addr,
          bip32AddressIndex: 10,
        };
      case notOwnAddr:
        return null;
    }
  });
  async function* getSpentMock(inputs) {
    for (const inp of inputs) {
      yield {
        input: inp,
        tx: {
          outputs: [
            { decoded: { address: notOwnAddr } },
            { decoded: { address: ownAddr } },
            { decoded: { data: 'not-address-output' } },
          ],
        }
      };
    }
  }
  jest.spyOn(storage, 'getSpentTxs').mockImplementation(getSpentMock);
  const input0 = new Input('cafe', 0);
  const input1 = new Input('d00d', 1);
  const input2 = new Input('babe', 2);
  const tx = new Transaction([input0, input1, input2], []);

  expect(await transaction.signTransaction(tx, storage, '123')).toBe(tx);
  const hashdata = tx.getDataToSignHash();
  expect(input0.data).toEqual(null);
  const sig1 = input1.data.slice(1, 1+input1.data[0]);
  expect(crypto.ECDSA.verify(
    hashdata,
    crypto.Signature.fromDER(sig1),
    xpriv.deriveChild(10).publicKey,
    'little', // endianess
  )).toBe(true);
  expect(input2.data).toEqual(null);
});

test('Utxo selection', () => {
  const utxos = [
    {address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi', value: 10, txId: '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d', index: 5},
    {address: 'Wmu3y4rWs6n4JJAdRtAz4mDn4d7GkTcqKc', value: 5, txId: '0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e', index: 6},
  ];

  const selectedUtxos = transaction.selectUtxos(utxos, 3);
  expect(selectedUtxos.utxos.length).toBe(1);
  expect(selectedUtxos.utxos[0].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e');
  expect(selectedUtxos.changeAmount).toBe(2);

  const selectedUtxos2 = transaction.selectUtxos(utxos, 5);
  expect(selectedUtxos2.utxos.length).toBe(1);
  expect(selectedUtxos2.utxos[0].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e');
  expect(selectedUtxos2.changeAmount).toBe(0);

  const selectedUtxos3 = transaction.selectUtxos(utxos, 6);
  expect(selectedUtxos3.utxos.length).toBe(1);
  expect(selectedUtxos3.utxos[0].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d');
  expect(selectedUtxos3.changeAmount).toBe(4);

  const selectedUtxos4 = transaction.selectUtxos(utxos, 11);
  expect(selectedUtxos4.utxos.length).toBe(2);
  expect(selectedUtxos4.utxos[0].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d');
  expect(selectedUtxos4.utxos[1].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e');
  expect(selectedUtxos4.changeAmount).toBe(4);

  const selectedUtxos5 = transaction.selectUtxos(utxos, 15);
  expect(selectedUtxos5.utxos.length).toBe(2);
  expect(selectedUtxos5.utxos[0].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2d');
  expect(selectedUtxos5.utxos[1].txId).toBe('0000a8756b1585d772e852f2d364fb88fcc503421ea25d709e17b4f9613fcd2e');
  expect(selectedUtxos5.changeAmount).toBe(0);

  expect(() => {
    transaction.selectUtxos(utxos, 16);
  }).toThrowError(UtxoError);

  expect(() => {
    transaction.selectUtxos(utxos, -1);
  }).toThrowError(UtxoError);

  expect(() => {
    transaction.selectUtxos([], 10);
  }).toThrowError(UtxoError);
})

test('utxo from history output', () => {
  const fake_txid = 'fake-txid';
  const fake_index = 27;
  const addressPath = 'fake-address-path';

  const txout1 = {
    token: '00',
    token_data: 0,
    value: 5,
    decoded: {
      address: 'fake-address',
      timelock: 10,
    },
  };

  expect(transaction.utxoFromHistoryOutput(fake_txid, fake_index, txout1, { addressPath })).toEqual({
    txId: fake_txid,
    index: fake_index,
    addressPath,
    address: 'fake-address',
    timelock: 10,
    tokenId: '00',
    value: 5,
    authorities: 0,
    heightlock: null, // heightlock is not checked on this method.
    locked: false, // The method does not check the lock.
  });


  // Custom token without timelock
  const txout2 = {
    token: 'custom-token',
    token_data: 5,
    value: 30,
    decoded: {
      address: 'fake-address-2',
    },
  };

  expect(transaction.utxoFromHistoryOutput(fake_txid, fake_index, txout2, { addressPath })).toEqual({
    txId: fake_txid,
    index: fake_index,
    addressPath,
    address: 'fake-address-2',
    timelock: null,
    tokenId: 'custom-token',
    value: 30,
    authorities: 0,
    heightlock: null, // heightlock is not checked on this method.
    locked: false, // The method does not check the lock.
  });

  // Custom token authority
  const txout3 = {
    token: 'custom-token',
    token_data: 132,
    value: 2,
    decoded: {
      address: 'fake-address-2',
    },
  };

  expect(transaction.utxoFromHistoryOutput(fake_txid, fake_index, txout3, { addressPath })).toEqual({
    txId: fake_txid,
    index: fake_index,
    addressPath,
    address: 'fake-address-2',
    timelock: null,
    tokenId: 'custom-token',
    value: 2,
    authorities: 2,
    heightlock: null, // heightlock is not checked on this method.
    locked: false, // The method does not check the lock.
  });
});

test('getTokenDataFromOutput', () => {
  const utxoMint = { type: 'mint', authorities: 0 };
  expect(transaction.getTokenDataFromOutput(utxoMint, [])).toEqual(1)
  const utxoMintAuth = { type: 'mint', authorities: 1 };
  expect(transaction.getTokenDataFromOutput(utxoMintAuth, [])).toEqual(1 | TOKEN_AUTHORITY_MASK)
  const utxoMintAuth2 = { type: 'mint', authorities: 123 };
  expect(transaction.getTokenDataFromOutput(utxoMintAuth2, [])).toEqual(1 | TOKEN_AUTHORITY_MASK)

  const utxoMelt = { type: 'melt', authorities: 0 };
  expect(transaction.getTokenDataFromOutput(utxoMelt, [])).toEqual(1)
  const utxoMeltAuth = { type: 'melt', authorities: 1 };
  expect(transaction.getTokenDataFromOutput(utxoMeltAuth, [])).toEqual(1 | TOKEN_AUTHORITY_MASK)
  const utxoMeltAuth2 = { type: 'melt', authorities: 123 };
  expect(transaction.getTokenDataFromOutput(utxoMeltAuth2, [])).toEqual(1 | TOKEN_AUTHORITY_MASK)

  const utxoHTR = { type: 'p2pkh', token: '00', authorities: 0 };
  expect(transaction.getTokenDataFromOutput(utxoHTR, ['02', '01', '03'])).toEqual(0)
  const utxoCustom = { type: 'p2pkh', token: '01', authorities: 0 };
  expect(transaction.getTokenDataFromOutput(utxoCustom, ['02', '01', '03'])).toEqual(2)
  const utxoCustomAuth = { type: 'p2pkh', token: '01', authorities: 1 };
  expect(transaction.getTokenDataFromOutput(utxoCustomAuth, ['03', '02', '01'])).toEqual(3 | TOKEN_AUTHORITY_MASK)
  const utxoCustomAuth2 = { type: 'p2pkh', token: '01', authorities: 2 };
  expect(transaction.getTokenDataFromOutput(utxoCustomAuth2, ['02', '01'])).toEqual(2 | TOKEN_AUTHORITY_MASK)
});

test('authorities from output', () => {
  const output = {token_data: 0, value: 123};
  const outputMint = {token_data: TOKEN_AUTHORITY_MASK|1, value: TOKEN_MINT_MASK};
  const outputMelt = {token_data: TOKEN_AUTHORITY_MASK|2, value: TOKEN_MELT_MASK};
  const outputMintMelt = {token_data: TOKEN_AUTHORITY_MASK|3, value: TOKEN_MELT_MASK|TOKEN_MINT_MASK};
  expect(transaction.authoritiesFromOutput(output)).toEqual(0);
  expect(transaction.authoritiesFromOutput(outputMint)).toEqual(1);
  expect(transaction.authoritiesFromOutput(outputMelt)).toEqual(2);
  expect(transaction.authoritiesFromOutput(outputMintMelt)).toEqual(3);
});

test('canUseUtxo', async () => {
  const tsFromDate = (date) => Math.floor(date.getTime() / 1000);
  const t1 = new Date('2020-11-25T18:00:00');
  const t2 = new Date('2020-11-27T21:00:00');
  const t3 = new Date('2022-04-16T17:00:00');
  const t4 = new Date('2023-03-20T11:00:00');

  const store = new MemoryStore();
  const storage = new Storage(store);

  jest.spyOn(storage, 'getCurrentHeight').mockReturnValue(Promise.resolve(10));
  const txSpy = jest.spyOn(storage, 'getTx');
  const isSelSpy = jest.spyOn(storage, 'isUtxoSelectedAsInput').mockReturnValue(Promise.resolve(false));
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
        }
      },
      {
        decoded: {
          timelock: tsFromDate(t4), // locked
        }
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
        }
      },
      {
        decoded: {
          timelock: tsFromDate(t4), // locked
        }
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
        }
      },
      {
        decoded: {
          timelock: tsFromDate(t4), // locked
        }
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
});

test('getTxType', () => {
  expect(transaction.getTxType({ version: BLOCK_VERSION })).toBe('Block');
  expect(transaction.getTxType({ version: DEFAULT_TX_VERSION })).toBe('Transaction');
  expect(transaction.getTxType({ version: CREATE_TOKEN_TX_VERSION })).toBe('Create Token Transaction');
  expect(transaction.getTxType({ version: MERGED_MINED_BLOCK_VERSION })).toBe('Merged Mining Block');
  expect(transaction.getTxType({ version: 999 })).toBe('Unknown');
});