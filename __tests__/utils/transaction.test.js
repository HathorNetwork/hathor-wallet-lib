/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transaction from '../../src/utils/transaction';
import { UtxoError } from '../../src/errors';
import { PrivateKey, crypto } from 'bitcore-lib';
import { TOKEN_AUTHORITY_MASK, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import { HDPrivateKey } from 'bitcore-lib';
import Input from '../../src/models/input';
import Transaction from '../../src/models/transaction';
import { transferableAbortController } from 'util';

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
  expect(crypto.ECDSA.verify(
    hashdata,
    crypto.Signature.fromDER(input1.data),
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