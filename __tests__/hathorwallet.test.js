/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../src/new/wallet';
import { WalletFromXPubGuard } from '../src/errors';
import Transaction from '../src/models/transaction';
import Input from '../src/models/input';
import Output from '../src/models/output';
import { DEFAULT_TX_VERSION } from '../src/constants';
import Address from '../src/models/address';
import P2PKH from '../src/models/p2pkh';
import wallet from '../src/wallet';
import { HDPrivateKey, crypto, PublicKey } from 'bitcore-lib';
import transaction from '../src/transaction';
import { Storage } from '../src/storage';
import Queue from '../src/models/queue';

class FakeHathorWallet {
  constructor() {
    // Will bind all methods to this instance
    for (const method of Object.getOwnPropertyNames(HathorWallet.prototype)) {
        if (method === 'constructor' || !(method && HathorWallet.prototype[method])) {
            continue;
        }
        // All methods can be spied on and mocked.
        this[method] = jest.fn().mockImplementation(HathorWallet.prototype[method].bind(this));
    }
  }
}

test('checkAddressesMine', async () => {
  const hWallet = new FakeHathorWallet();

  hWallet.isAddressMine.mockImplementationOnce(() => true);

  expect(await hWallet.checkAddressesMine([
    'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
  ])).toStrictEqual({
    WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp: true,
    WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ: false,
  });
});

test('Protected xpub wallet methods', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.isFromXPub.mockReturnValue(true);
  // Validating that methods that require the private key will throw on call
  await expect(hWallet.consolidateUtxos()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.sendTransaction()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.sendManyOutputsTransaction()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareCreateNewToken()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareMintTokensData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareMeltTokensData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareDelegateAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareDestroyAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
  expect(hWallet.getAllSignatures).toThrow(WalletFromXPubGuard);
  expect(hWallet.getSignatures).toThrow(WalletFromXPubGuard);
  expect(hWallet.signTx).toThrow(WalletFromXPubGuard);
});

test('signTx', () => {
  // Spy on lib methods used
  const mockStorageGet = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue({
    mainKey: 'mocked-encrypted-privkey',
  });
  const mockPrivkey = jest.spyOn(wallet, 'decryptData').mockReturnValue((new HDPrivateKey()).toString());
  const mockInputData = jest.spyOn(transaction, 'createInputData');
  const mockSetData = jest.spyOn(Input.prototype, 'setData');

  // Setup transaction to test signature method
  const tokenUid = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
  const inputTx = '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b';
  const mockAddresses = ['WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ'];
  const mockAddr0 = new Address(mockAddresses[0]);
  const script0 = new P2PKH(mockAddr0);
  const mockAddr1 = new Address(mockAddresses[1]);
  const script1 = new P2PKH(mockAddr1);
  const outputs = [
    new Output(10, script0.createScript(), { tokenData: 1 }), // token funds
    new Output(1, script0.createScript(), { tokenData: 129 }), // Mint authority
    new Output(20, script1.createScript()), // HTR
  ];

  // 1. Common case, 2 inputs from the wallet, check that only these will be signed
  //    and also confirm the the signature is valid and being set on the transaction.

  const tx0 = new Transaction(
    [new Input(inputTx, 0), new Input(inputTx, 1), new Input(inputTx, 2)],
    outputs,
    { version: DEFAULT_TX_VERSION, tokens: [tokenUid] },
  );

  // Mock HathorWallet methods used
  const hWallet = new FakeHathorWallet();
  hWallet.isFromXPub.mockReturnValue(false);
  hWallet.pinCode = '123';
  hWallet.getTx.mockImplementation(() => ({
    outputs: [
      { decoded: { address: mockAddresses[1] } },
      { decoded: { address: mockAddresses[0] } }, // Not from the wallet, will be ignored
      { decoded: { address: mockAddresses[1] } },
    ],
  }));
  hWallet.isAddressMine.mockImplementation(addr => (addr === mockAddresses[1]));
  hWallet.getAddressIndex.mockReturnValue(1);

  let returnedTx = hWallet.signTx(tx0);
  expect(returnedTx).toBe(tx0);
  // The transaction is filled with the input data
  expect(tx0.inputs[0].data).not.toBe(null);
  expect(tx0.inputs[1].data).toBe(null);
  expect(tx0.inputs[2].data).not.toBe(null);

  // Mocks expectations
  expect(mockPrivkey).toBeCalledWith('mocked-encrypted-privkey', '123');
  expect(mockPrivkey).toBeCalledTimes(1);
  // Only 2 inputs are from our fake wallet
  expect(mockInputData).toBeCalledTimes(2);
  // And all inputs are made with valid signatures
  mockInputData.mock.calls.forEach(args => {
    const [sigDER, pubkey] = args;
    expect(crypto.ECDSA.verify(
      tx0.getDataToSignHash(),
      crypto.Signature.fromDER(sigDER),
      PublicKey.fromBuffer(pubkey),
      'little',
    )).toBe(true);
  });
  // We set the inputData with the correct value
  expect(
    mockSetData.mock.calls[0][0].toString('hex')
  ).toEqual(mockInputData.mock.results[0].value.toString('hex'));
  expect(
    mockSetData.mock.calls[1][0].toString('hex')
  ).toEqual(mockInputData.mock.results[1].value.toString('hex'));

  // Clear mocks
  mockPrivkey.mockClear();
  mockInputData.mockClear();
  mockSetData.mockClear();


  // 2. Same transaction as 1. but we should use the argument pinCode if given
  //    Will still check everything to make sure this did not change any behavior.

  const tx1 = new Transaction(
    [new Input(inputTx, 0), new Input(inputTx, 1), new Input(inputTx, 2)],
    outputs,
    { version: DEFAULT_TX_VERSION, tokens: [tokenUid] },
  );
  // Calling with a pin code
  returnedTx = hWallet.signTx(tx1, { pinCode: 'another-PIN' });
  expect(returnedTx).toBe(tx1);
  // The transaction is filled with the input data like before
  expect(tx1.inputs[0].data).not.toBe(null);
  expect(tx1.inputs[1].data).toBe(null);
  expect(tx1.inputs[2].data).not.toBe(null);

  // Mocks expectations
  expect(mockPrivkey).toBeCalledWith('mocked-encrypted-privkey', 'another-PIN');
  expect(mockPrivkey).toBeCalledTimes(1);
  // Only 2 inputs are from our fake wallet
  expect(mockInputData).toBeCalledTimes(2);
  // And all inputs are made with valid signatures
  mockInputData.mock.calls.forEach(args => {
    const [sigDER, pubkey] = args;
    expect(crypto.ECDSA.verify(
      tx1.getDataToSignHash(),
      crypto.Signature.fromDER(sigDER),
      PublicKey.fromBuffer(pubkey),
      'little',
    )).toBe(true);
  });
  // We set the inputData with the correct value
  expect(
    mockSetData.mock.calls[0][0].toString('hex')
  ).toEqual(mockInputData.mock.results[0].value.toString('hex'));
  expect(
    mockSetData.mock.calls[1][0].toString('hex')
  ).toEqual(mockInputData.mock.results[1].value.toString('hex'));

  // 3. Calling without pin should throw an error

  hWallet.pinCode = null;
  expect(() => {
   return hWallet.signTx(tx0);
  }).toThrow('Pin is required.');

  // Cleanup
  mockPrivkey.mockRestore();
  mockInputData.mockRestore();
  mockSetData.mockRestore();
  mockStorageGet.mockRestore();
});

test('getWalletInputInfo', () => {
  // Setup transaction
  const tokenUid = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
  const inputTx = '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b';
  const inputTx2 = '000264e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01c';
  const mockAddresses = ['WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp', 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ'];
  const mockAddr0 = new Address(mockAddresses[0]);
  const script0 = new P2PKH(mockAddr0);
  const mockAddr1 = new Address(mockAddresses[1]);
  const script1 = new P2PKH(mockAddr1);
  const outputs = [
    new Output(10, script0.createScript(), { tokenData: 1 }), // token funds
    new Output(1, script0.createScript(), { tokenData: 129 }), // Mint authority
    new Output(20, script1.createScript()), // HTR
  ];
  const tx0 = new Transaction(
    [new Input(inputTx, 0), new Input(inputTx, 1), new Input(inputTx, 2), new Input(inputTx2, 0)],
    outputs,
    { version: DEFAULT_TX_VERSION, tokens: [tokenUid] },
  );

  // Mock HathorWallet methods used
  const hWallet = new FakeHathorWallet();
  hWallet.isFromXPub.mockReturnValue(false);
  hWallet.pinCode = '123';
  hWallet.getTx.mockImplementation((txId) => {
    if (txId === inputTx) {
      return {
        outputs: [
          { decoded: { address: mockAddresses[1] } },
          { decoded: { address: mockAddresses[0] } }, // Not from the wallet, will be ignored
          { decoded: { address: mockAddresses[1] } },
        ],
      };
    }
    return null;
  });
  hWallet.isAddressMine.mockImplementation(addr => (addr === mockAddresses[1]));
  hWallet.getAddressIndex.mockReturnValue(1);
  hWallet.getAddressPathForIndex.mockReturnValue('m/bip32/path');

  let returnedTx = hWallet.getWalletInputInfo(tx0);
  expect(returnedTx).toEqual([
    { inputIndex: 0, addressIndex: 1, addressPath: 'm/bip32/path' },
    { inputIndex: 2, addressIndex: 1, addressPath: 'm/bip32/path' },
  ]);
});

test('processTxQueue', async () => {
  const hWallet = new FakeHathorWallet();

  const processedTxs = [];
  hWallet.onNewTx.mockImplementation(data => processedTxs.push(data));

  // wsTxQueue is not part of the prototype so it won't be faked on FakeHathorWallet
  hWallet.wsTxQueue = new Queue();
  hWallet.wsTxQueue.enqueue(1);
  hWallet.wsTxQueue.enqueue(2);
  hWallet.wsTxQueue.enqueue(3);

  await hWallet.processTxQueue();

  expect(processedTxs).toStrictEqual([1, 2, 3]);
});

test('handleWebsocketMsg', async () => {
  const hWallet = new FakeHathorWallet();

  const processedTxs = [];
  hWallet.onNewTx.mockImplementation(data => processedTxs.push(data));

  // wsTxQueue is not part of the prototype so it won't be faked on FakeHathorWallet
  hWallet.wsTxQueue = new Queue();
  hWallet.wsTxQueue.enqueue({type: 'wallet:address_history', history: [1]});

  hWallet.state = HathorWallet.PROCESSING;
  hWallet.handleWebsocketMsg({type: 'wallet:address_history', history: [2]});
  // We shouldn't process ws txs since we are PROCESSING
  expect(processedTxs.length).toEqual(0);
  expect(hWallet.wsTxQueue.size()).toEqual(2);

  // We should process txs when we are READY
  hWallet.state = HathorWallet.READY;
  hWallet.handleWebsocketMsg({type: 'wallet:address_history', history: [3]});
  expect(processedTxs.length).toEqual(1);
  expect(hWallet.wsTxQueue.size()).toEqual(2);
});

test('getTxBalance', async () => {
  const hWallet = new FakeHathorWallet();
  const mockWalletData = jest.spyOn(wallet, 'getWalletData').mockReturnValue({});
  const mockAddrCheck = jest.spyOn(wallet, 'isAddressMine').mockReturnValue(true);

  /**
   * A: -1 +2 = 1
   * B: -10 +5 = -5
   *
   * Auth:
   * C: +mint
   * A: -melt, but should return the fund balance
   */
  const tx = {
    outputs: [
      {
        token: 'A',
        token_data: 1,
        value: 2,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'B',
        token_data: 2,
        value: 5,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'C',
        token_data: 130,
        value: 2,
        decoded: { address: 'Addr1' },
      },
    ],
    inputs: [
      {
        token: 'A',
        token_data: 1,
        value: 1,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'A',
        token_data: 129,
        value: 1,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'B',
        token_data: 2,
        value: 10,
        decoded: { address: 'Addr1' },
      },
    ],
  };

  expect(await hWallet.getTxBalance(tx)).toStrictEqual({
    'A': 1,
    'B': -5,
  });

  expect(await hWallet.getTxBalance(tx, { includeAuthorities: true })).toStrictEqual({
    'A': 1,
    'B': -5,
    'C': 0,
  });


  mockWalletData.mockRestore();
  mockAddrCheck.mockRestore();
});

test('getPreProcessedData', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.preProcessedData = {};

  await expect(async () => {
    await hWallet.getPreProcessedData('foo');
  }).rejects.toThrow();

  hWallet.preProcessedData = {
    foo: 123,
  };

  expect(await hWallet.getPreProcessedData('foo')).toEqual(123);
});

test('setState', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.preProcessWalletData.mockImplementation(() => Promise.resolve());
  hWallet.state = HathorWallet.SYNCING;
  hWallet.setState(HathorWallet.CONNECTING);

  expect(hWallet.preProcessWalletData).toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.CONNECTING);

  hWallet.preProcessWalletData.mockClear();
  hWallet.setState(HathorWallet.CONNECTING);
  expect(hWallet.preProcessWalletData).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.CONNECTING);

  hWallet.setState(HathorWallet.READY);
  expect(hWallet.preProcessWalletData).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.READY);
});
