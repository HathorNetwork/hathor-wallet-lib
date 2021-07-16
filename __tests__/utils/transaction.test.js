/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transaction from '../../src/utils/transaction';
import { UtxoError } from '../../src/errors';

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