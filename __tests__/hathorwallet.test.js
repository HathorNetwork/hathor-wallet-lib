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
});

test('getSignatures', () => {
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
  const tx0 = new Transaction(
    [new Input(inputTx, 0), new Input(inputTx, 1), new Input(inputTx, 2)],
    outputs,
    { version: DEFAULT_TX_VERSION, tokens: [tokenUid] },
  );

  // Mock HathorWallet methods used
  const hWallet = new FakeHathorWallet();
  hWallet.isFromXPub.mockReturnValue(false);
  // hWallet.isFromXPub = () => false;
  hWallet.pinCode = '123';
  hWallet.getTx = () => ({
    outputs: [
      { decoded: { address: mockAddresses[1] } },
      { decoded: { address: mockAddresses[0] } }, // Not from the wallet, will be ignored
      { decoded: { address: mockAddresses[1] } },
    ],
  });
  hWallet.isAddressMine = addr => (addr === mockAddresses[1]);
  hWallet.getAddressIndex = () => 1;

  let returnedTx = hWallet.getSignatures(tx0);
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

  const tx1 = new Transaction(
    [new Input(inputTx, 0), new Input(inputTx, 1), new Input(inputTx, 2)],
    outputs,
    { version: DEFAULT_TX_VERSION, tokens: [tokenUid] },
  );
  // Calling with a pin code
  returnedTx = hWallet.getSignatures(tx1, { pinCode: 'another-PIN' });
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

  // Calling without pin should throw an error
  hWallet.pinCode = null;
  expect(() => {
   return hWallet.getSignatures(tx0);
  }).toThrow('Pin is required.');

  // Cleanup
  mockPrivkey.mockRestore();
  mockInputData.mockRestore();
  mockSetData.mockRestore();
  mockStorageGet.mockRestore();
});