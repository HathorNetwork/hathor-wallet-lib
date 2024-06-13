/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TOKEN_AUTHORITY_MASK } from '../../src/constants';
import { HATHOR_TOKEN_CONFIG } from '../../src/constants';
import SendTransaction, {
  ISendDataOutput,
  isDataOutput,
  checkUnspentInput,
  prepareSendTokensData,
} from '../../src/new/sendTransaction';
import { MemoryStore, Storage } from '../../src/storage';
import { WalletType } from '../../src/types';
import transaction from '../../src/utils/transaction';
import { OutputType } from '../../src/wallet/types';

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

  async function* selectUtxoMock(options) {
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
  jest.spyOn(storage, 'getCurrentAddress').mockReturnValue(Promise.resolve('W-change-address'));
  jest.spyOn(storage, 'getTx').mockReturnValue(
    Promise.resolve({
      outputs: [
        {
          value: 11,
          token: '01',
          decoded: {
            address: 'spent-utxo-address',
          },
          token_data: 1,
        },
      ],
    })
  );
  jest.spyOn(storage, 'isAddressMine').mockReturnValue(true);
  const preparedTx = {
    validate: jest.fn(),
  };
  const prepareSpy = jest
    .spyOn(transaction, 'prepareTransaction')
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
      },
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

test('checkUnspentInput', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  const addressSpy = jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));
  const txSpy = jest.spyOn(storage, 'getTx');
  const input0 = { txId: 'tx-id', index: 0, address: 'addr0', token: '01' };
  const input1 = { txId: 'tx-id', index: 1, address: 'addr1', token: '01' };
  txSpy.mockReturnValueOnce(Promise.resolve(null));
  await expect(checkUnspentInput(storage, input1, '01')).resolves.toEqual({
    success: false,
    message: 'Transaction [tx-id] does not exist in the wallet',
  });

  txSpy.mockReturnValueOnce(Promise.resolve({ is_voided: true }));
  await expect(checkUnspentInput(storage, input1, '01')).resolves.toEqual({
    success: false,
    message: 'Transaction [tx-id] is voided',
  });

  txSpy.mockReturnValueOnce(Promise.resolve({ is_voided: false, outputs: ['only-output'] }));
  await expect(checkUnspentInput(storage, input1, '01')).resolves.toEqual({
    success: false,
    message: 'Transaction [tx-id] does not have this output [index=1]',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({ is_voided: false, outputs: [{ token_data: TOKEN_AUTHORITY_MASK | 1 }] })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is an authority output',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: { address: 'different-addr' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message:
      'Output [0] of transaction [tx-id] does not have the same address as the provided input',
  });

  addressSpy.mockReturnValueOnce(Promise.resolve(false));
  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: { address: 'addr0' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is not from the wallet',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: {} }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message:
      'Output [0] of transaction [tx-id] cannot be spent since it does not belong to an address',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: { address: 'addr0', token: '02' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '02')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is not from selected token [02]',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, token: '01', decoded: { address: 'addr0' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '02')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is not from selected token [02]',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [
        { token_data: 1, token: '01', spent_by: 'another-tx', decoded: { address: 'addr0' } },
      ],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is already spent',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, token: '01', decoded: { address: 'addr0' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: true,
    message: '',
  });
});

test('prepareSendTokensData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest
    .spyOn(storage, 'getChangeAddress')
    .mockImplementation(({ changeAddress }) => Promise.resolve(changeAddress));
  jest.spyOn(transaction, 'canUseUtxo').mockReturnValue(Promise.resolve(true));

  const tx = {
    inputs: [
      { txId: 'tx-id', index: 0, address: 'addr0', token: '01' },
      { txId: 'tx-id', index: 1, address: 'addr1', token: '01' },
    ],
    outputs: [
      { address: 'addr2', value: 1, token: '00' },
      { address: 'addr3', value: 2, token: '01' },
      { type: 'mint', address: 'addr4', value: 2, token: '01' }, // will be ignored
    ],
  };

  const utxoSelection = jest.fn().mockReturnValue(
    Promise.resolve({
      utxos: [],
      amount: 0,
    })
  );

  await expect(
    prepareSendTokensData(storage, tx, {
      chooseInputs: true,
      utxoSelectionMethod: utxoSelection,
    })
  ).rejects.toThrow('Insufficient amount of tokens');

  utxoSelection.mockReturnValue(
    Promise.resolve({
      utxos: [
        {
          txId: 'tx-id',
          index: 0,
          address: 'addr-utxo',
          value: 3,
          authorities: 0,
          token: '01',
        },
      ],
      amount: 3,
    })
  );
  await expect(
    prepareSendTokensData(storage, tx, {
      token: '01',
      chooseInputs: true,
      utxoSelectionMethod: utxoSelection,
      changeAddress: 'addr-change',
    })
  ).resolves.toMatchObject({
    inputs: [
      { txId: 'tx-id', index: 0, address: 'addr-utxo', token: '01', value: 3, authorities: 0 },
    ],
    outputs: [
      {
        type: 'p2pkh',
        address: 'addr-change',
        value: 1,
        token: '01',
        authorities: 0,
        timelock: null,
        isChange: true,
      },
    ],
  });

  const prepareSpy = jest.spyOn(transaction, 'canUseUtxo').mockReturnValue(Promise.resolve(true));
  jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));
  jest.spyOn(storage, 'getTx').mockReturnValue(
    Promise.resolve({
      is_voided: false,
      outputs: [
        { token_data: 1, value: 1, token: '01', decoded: { address: 'addr0', token: '01' } },
        { token_data: 1, value: 2, token: '01', decoded: { address: 'addr1', token: '01' } },
        // Since the last output is skipped we do not need it on the tx
        // { token_data:0, value: 1, decoded: { address: 'addr2', token: '00' } },
      ],
    })
  );
  const tx1 = {
    inputs: [
      { txId: 'tx-id', index: 0, value: 1, address: 'addr0', token: '01' },
      { txId: 'tx-id', index: 1, value: 2, address: 'addr1', token: '01' },
      { txId: 'tx-id', index: 2, value: 1, address: 'addr2', token: '00' }, // Should be skipped
    ],
    outputs: [
      { address: 'addr2', value: 1, token: '00' },
      { address: 'addr3', value: 2, token: '01' },
      { type: 'mint', address: 'addr4', value: 2, token: '01' }, // will be ignored
    ],
  };

  await expect(
    prepareSendTokensData(storage, tx1, {
      token: '01',
      chooseInputs: false,
      changeAddress: 'addr-change',
    })
  ).resolves.toMatchObject({
    // No new inputs since we do not choose inputs
    inputs: [],
    // We add a change since the inputs had more tokens than the outputs
    outputs: [
      {
        type: 'p2pkh',
        address: 'addr-change',
        value: 1,
        token: '01',
        authorities: 0,
        timelock: null,
        isChange: true,
      },
    ],
  });
  // Reset mocks
  prepareSpy.mockRestore();
});
