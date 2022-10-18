/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transaction from '../../src/utils/transaction';
import { UtxoError } from '../../src/errors';
import { PrivateKey, crypto } from 'bitcore-lib';

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
    heighlock: null, // heighlock is not checked on this method.
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
    heighlock: null, // heighlock is not checked on this method.
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
    heighlock: null, // heighlock is not checked on this method.
    locked: false, // The method does not check the lock.
  });
});

test('getSignature', () => {
  const privkey = new PrivateKey();

  const data = Buffer.from('c0ffee', 'hex');
  const hashdata = crypto.Hash.sha256(data);

  const signatureDER = transaction.getSignature(hashdata, privkey);

  // A signature made with this util matches the public key
  expect(crypto.ECDSA.verify(
    hashdata,
    crypto.Signature.fromDER(signatureDER),
    privkey.toPublicKey(),
    'little', // endianess
  )).toBe(true);
});