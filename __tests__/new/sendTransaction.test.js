/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HATHOR_TOKEN_CONFIG } from "../../src/constants";
import SendTransaction, { ISendInput, ISendOutput, ISendDataOutput, ISendTokenOutput, isDataOutput } from "../../src/new/sendTransaction";
import { MemoryStore, Storage } from "../../src/storage";
import { WalletType } from "../../src/types";
import transaction from "../../src/utils/transaction";
import { OutputType } from "../../src/wallet/types";


test('type methods', () => {
  // The ISendInput and ISendOutput were created to satisfy the old facade methods while using typescript

  /**
   * @type {ISendDataOutput}
   */
  const addrOutput = {
    type: OutputType.P2PKH,
    address: 'H-valid-address',
    value: 10,
    token: HATHOR_TOKEN_CONFIG.uid,
  };

  /**
 * @type {ISendDataOutput}
 */
  const dataOutput = {
    type: OutputType.DATA,
    data: Buffer.alloc(0),
  };

  expect(isDataOutput(dataOutput)).toBeTruthy();
  expect(isDataOutput(addrOutput)).toBeFalsy();
});

test('prepareTxData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  async function *selectUtxoMock(options) {
    if (options.token === '00') {
      yield {
        txId: 'another-spent-tx-id',
        index: 0,
        value: 2,
        token: '00',
        address: 'another-spent-utxo-address',
        authorities: 0,
      };
    }
  }

  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock);
  jest.spyOn(storage, 'getCurrentAddress').mockReturnValue(Promise.resolve('W-change-address'))
  jest.spyOn(storage, 'getTx').mockReturnValue(Promise.resolve({
    outputs: [{
      value: 11,
      token: '01',
      decoded: {
        address: 'spent-utxo-address',
      },
      token_data: 1,
    }]
  }));
  jest.spyOn(storage, 'isAddressMine').mockReturnValue(true);
  const preparedTx = {
    validate: jest.fn(),
  }
  const prepareSpy = jest.spyOn(
      transaction,
      'prepareTransaction')
    .mockReturnValue(Promise.resolve(preparedTx));

  /**
   * @type {ISendDataOutput}
   */
  const addrOutput = {
    type: OutputType.P2PKH,
    address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
    value: 10,
    token: '01',
  };

  /**
   * @type {ISendDataOutput}
   */
  const dataOutput = {
    type: OutputType.DATA,
    data: Buffer.from('abcd', 'hex'),
  };
  const inputs = [{ txId: 'spent-tx-id', index: 0 }];
  const outputs = [addrOutput, dataOutput];
  let sendTransaction = new SendTransaction({
    storage,
    outputs,
    inputs,
  });
  await expect(sendTransaction.prepareTxData()).resolves.toMatchObject({
    inputs: [
      {
        txId: 'spent-tx-id',
        index: 0,
        value: 11,
        token: '01',
        address: 'spent-utxo-address',
        authorities: 0,
      },
      {
        address: 'another-spent-utxo-address',
        authorities: 0,
        index: 0,
        token: '00',
        txId: 'another-spent-tx-id',
        value: 2,
      }
    ],
    // We use array containing because the order of the outputs is not guaranteed
    // If there is a change output we will shuffle the outputs
    outputs: expect.arrayContaining([
      {
        address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
        value: 10,
        timelock: null,
        token: '01',
        authorities: 0,
        type: 'p2pkh',
      },
      {
        type: 'data',
        data: 'abcd',
        value: 1,
        authorities: 0,
        token: HATHOR_TOKEN_CONFIG.uid,
      },
      {
        address: 'W-change-address',
        authorities: 0,
        isChange: true,
        timelock: null,
        token: '00',
        type: 'p2pkh',
        value: 1,
      },
      {
        address: 'W-change-address',
        authorities: 0,
        isChange: true,
        timelock: null,
        token: '01',
        type: 'p2pkh',
        value: 1,
      },
    ]),
    tokens: ['01'],
  });

  await expect(sendTransaction.prepareTx()).rejects.toThrow('Pin is not set.');
  sendTransaction.pin = '000000';
  await expect(sendTransaction.prepareTx()).resolves.toBe(preparedTx);

  prepareSpy.mockRestore();
});

test('invalid method calls', async () => {
  const sendTransaction = new SendTransaction();

  // Methods that require storage should throw an error
  await expect(sendTransaction.prepareTxData()).rejects.toThrow('Storage is not set.');
  await expect(sendTransaction.prepareTx()).rejects.toThrow('Storage is not set.');
  await expect(sendTransaction.prepareTxFrom([])).rejects.toThrow('Storage is not set.');
  await expect(sendTransaction.run()).rejects.toThrow('Storage is not set.');

  // updateOutputSelected without storage will be a no-op
  const sendTransaction2 = new SendTransaction({ transaction: 'a-transaction-instance' });
  await expect(sendTransaction2.updateOutputSelected(true)).resolves.toBeUndefined();

});
