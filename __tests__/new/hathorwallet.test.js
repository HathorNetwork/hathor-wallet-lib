/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Address from '../../src/models/address';
import HathorWallet from '../../src/new/wallet';
import { TxNotFoundError, WalletFromXPubGuard } from '../../src/errors';
import Network from '../../src/models/network';
import Transaction from '../../src/models/transaction';
import Input from '../../src/models/input';
import {
  DEFAULT_TX_VERSION,
  P2PKH_ACCT_PATH,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../../src/constants';
import { HDPrivateKey } from 'bitcore-lib';
import transactionUtils from '../../src/utils/transaction';
import { MemoryStore, Storage } from '../../src/storage';
import Queue from '../../src/models/queue';
import { WalletType } from '../../src/types';
import txApi from '../../src/api/txApi';
import * as addressUtils from '../../src/utils/address';
import versionApi from '../../src/api/version';
import { decryptData, verifyMessage } from '../../src/utils/crypto';

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

test('getFullTxById', async () => {
  const hWallet = new FakeHathorWallet();

  const getTxSpy = jest.spyOn(txApi, 'getTransaction')

  getTxSpy.mockImplementation((_txId, resolve) => {
    resolve({
      success: true,
      tx: { hash: 'tx1' },
      meta: {},
    });
  });

  const getFullTxByIdResponse = await hWallet.getFullTxById('tx1');

  expect(getFullTxByIdResponse.success).toStrictEqual(true);
  expect(getFullTxByIdResponse.tx.hash).toStrictEqual('tx1');

  getTxSpy.mockImplementation((_txId, resolve) => resolve({
    success: false,
    message: 'Invalid tx',
  }));

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrowError('Invalid transaction tx1');

  getTxSpy.mockImplementation(() => {
    throw new Error('Unhandled error');
  });

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrowError('Unhandled error');

  // Resolve the promise without calling the resolve param
  getTxSpy.mockImplementation(() => {
    return Promise.resolve();
  });

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrowError('API client did not use the callback');

  getTxSpy.mockImplementation((_txId, resolve) => resolve({
    success: false,
    message: 'Transaction not found',
  }));

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrowError(TxNotFoundError);
});

test('getTxConfirmationData', async () => {
  const hWallet = new FakeHathorWallet();

  const getConfirmationDataSpy = jest.spyOn(txApi, 'getConfirmationData')

  const mockData = {
    success: true,
    accumulated_weight: 67.45956109191802,
    accumulated_bigger: true,
    stop_value: 67.45416781056525,
    confirmation_level: 1,
  };

  getConfirmationDataSpy.mockImplementation((_txId, resolve) => {
    resolve(mockData);
  });

  const getConfirmationDataResponse = await hWallet.getTxConfirmationData('tx1');

  expect(getConfirmationDataResponse).toStrictEqual(mockData);

  getConfirmationDataSpy.mockImplementation((_txId, resolve) => resolve({
    success: false,
    message: 'Invalid tx',
  }));

  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrowError('Invalid transaction tx1');

  getConfirmationDataSpy.mockImplementation((_txId, resolve) => resolve({
    success: false,
    message: 'Transaction not found',
  }));

  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrowError(TxNotFoundError);

  getConfirmationDataSpy.mockImplementation((_txId, resolve) => {
    throw new Error('unhandled error');
  });
  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrowError('unhandled error');

  // Resolve the promise without calling the resolve param
  getConfirmationDataSpy.mockImplementation(() => Promise.resolve());
  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrowError('API client did not use the callback');
});

test('graphvizNeighborsQuery', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  const getGraphvizSpy = jest.spyOn(txApi, 'getGraphviz')

  const mockData = 'digraph {}';

  getGraphvizSpy.mockImplementation((_url, resolve) => {
    resolve(mockData);
  });

  const graphvizNeighborsQueryResponse = await hWallet.graphvizNeighborsQuery('tx1', 'type', 1);

  expect(graphvizNeighborsQueryResponse).toStrictEqual(mockData);

  getGraphvizSpy.mockImplementation((_url, resolve) => resolve({
    success: false,
    message: 'Invalid tx',
  }));

  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrowError('Invalid transaction tx1');

  getGraphvizSpy.mockImplementation((_url, resolve) => resolve({
    success: false,
    message: 'Transaction not found',
  }));

  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrowError(TxNotFoundError);

  getGraphvizSpy.mockImplementation(() => {
    throw new Error('unhandled error');
  });
  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrowError('unhandled error');

  // Resolve the promise without calling the resolve param
  getGraphvizSpy.mockImplementation(() => Promise.resolve());
  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrowError('API client did not use the callback');
});

test('checkAddressesMine', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  jest.spyOn(storage, 'isAddressMine').mockImplementationOnce(() => Promise.resolve(true));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  expect(await hWallet.checkAddressesMine([
    'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
  ])).toStrictEqual({
    WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp: true,
    WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ: false,
  });
});

test('Protected xpub wallet methods', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'isReadonly').mockImplementation(() => Promise.resolve(true));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  // Validating that methods that require the private key will throw on call
  await expect(hWallet.consolidateUtxos()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.sendTransaction()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.sendManyOutputsTransaction()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareCreateNewToken()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareMintTokensData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareMeltTokensData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareDelegateAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.prepareDestroyAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.getAllSignatures()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.getSignatures()).rejects.toThrow(WalletFromXPubGuard);
  await expect(hWallet.signTx()).rejects.toThrow(WalletFromXPubGuard);
});

test('getSignatures', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'isReadonly').mockReturnValue(Promise.resolve(false));
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'getTxSignatures').mockReturnValue(Promise.resolve({
    inputSignatures: [
      {
        signature: Buffer.from('cafe', 'hex'),
        pubkey: Buffer.from('abcd', 'hex'),
        inputIndex: 0,
        addressIndex: 1,
      },
      {
        signature: Buffer.from('1234', 'hex'),
        pubkey: Buffer.from('d00d', 'hex'),
        inputIndex: 0,
        addressIndex: 2,
      },
    ]
  }));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  const signatures = await hWallet.getSignatures('a-transaction', { pinCode: '123' });
  expect(signatures.length).toEqual(2);
  expect(signatures[0]).toMatchObject({
    signature: 'cafe',
    pubkey: 'abcd',
    inputIndex: 0,
    addressIndex: 1,
    addressPath: "m/44'/280'/0'/0/1",
  });
  expect(signatures[1]).toMatchObject({
    signature: '1234',
    pubkey: 'd00d',
    inputIndex: 0,
    addressIndex: 2,
    addressPath: "m/44'/280'/0'/0/2",
  });
});

test('signTx', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.getSignatures.mockImplementation(() => Promise.resolve([
    {
      inputIndex: 0,
      signature: 'ca',
      pubkey: 'fe',
    },
    {
      inputIndex: 2,
      signature: 'ba',
      pubkey: 'be',
    },
  ]));


  const txId = '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b';
  const tx = new Transaction(
    [new Input(txId, 0), new Input(txId, 1), new Input(txId, 2)],
    [],
    { version: DEFAULT_TX_VERSION, tokens: [] },
  );

  const returnedTx = await hWallet.signTx(tx, {pinCode: '123'});
  expect(returnedTx).toBe(tx);
  expect(hWallet.getSignatures).toBeCalledWith(tx, {pinCode: '123'});
  expect(tx.inputs[0].data.toString('hex')).toEqual('01ca01fe');
  expect(tx.inputs[1].data).toEqual(null);
  expect(tx.inputs[2].data.toString('hex')).toEqual('01ba01be');
});

test('getWalletInputInfo', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  async function* getSpentMock(inputs) {
    for (const [index, input] of inputs.entries()) {
      yield {
        input,
        index,
        tx: {
          outputs: [{
            decoded: {
              address: 'an-address',
            }
          }],
        },
      };
    }
  }
  jest.spyOn(storage, 'getSpentTxs').mockImplementation(getSpentMock);
  jest.spyOn(storage, 'getAddressInfo').mockReturnValue(Promise.resolve({
    bip32AddressIndex: 10,
  }));
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  const tx = {
    inputs: [new Input('hash', 0)],
  };
  const returned = await hWallet.getWalletInputInfo(tx);
  expect(returned.length).toEqual(1);
  expect(returned[0]).toMatchObject({
    inputIndex: 0,
    addressIndex: 10,
    addressPath: `${P2PKH_ACCT_PATH}/0/10`,
  });
});

test('processTxQueue', async () => {
  const hWallet = new FakeHathorWallet();

  const processedTxs = [];
  hWallet.onNewTx.mockImplementation(data => {
    processedTxs.push(data);
    return Promise.resolve();
  });
  hWallet.storage = {
    processHistory: jest.fn(),
  }

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
  hWallet.onNewTx.mockImplementation(data => {
    processedTxs.push(data);
    return Promise.resolve();
  });

  // wsTxQueue is not part of the prototype so it won't be faked on FakeHathorWallet
  hWallet.wsTxQueue = new Queue();
  hWallet.wsTxQueue.enqueue({type: 'wallet:address_history', history: [1]});
  hWallet.newTxPromise = Promise.resolve();

  hWallet.state = HathorWallet.PROCESSING;
  hWallet.handleWebsocketMsg({type: 'wallet:address_history', history: [2]});
  await hWallet.newTxPromise;
  // We shouldn't process ws txs since we are PROCESSING
  expect(processedTxs.length).toEqual(0);
  expect(hWallet.wsTxQueue.size()).toEqual(2);

  // We should process txs when we are READY
  hWallet.state = HathorWallet.READY;
  hWallet.handleWebsocketMsg({type: 'wallet:address_history', history: [3]});
  await hWallet.newTxPromise;
  expect(processedTxs.length).toEqual(1);
  expect(hWallet.wsTxQueue.size()).toEqual(2);
});

test('getTxBalance', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

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
    'C': 0,
  });

  expect(await hWallet.getTxBalance(tx, { includeAuthorities: true })).toStrictEqual({
    'A': 1,
    'B': -5,
    'C': 0,
  });
});

test('setState', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.onEnterStateProcessing.mockImplementation(() => Promise.resolve());
  hWallet.emit = () => {};
  hWallet.state = 0;

  hWallet.setState(HathorWallet.SYNCING);
  await new Promise(resolve => { setTimeout(resolve, 0)});
  expect(hWallet.onEnterStateProcessing).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.SYNCING);

  hWallet.setState(HathorWallet.PROCESSING);
  await new Promise(resolve => { setTimeout(resolve, 0)});
  expect(hWallet.onEnterStateProcessing).toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.PROCESSING);
  hWallet.onEnterStateProcessing.mockClear();

  hWallet.setState(HathorWallet.PROCESSING);
  await new Promise(resolve => { setTimeout(resolve, 0)});
  expect(hWallet.onEnterStateProcessing).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.PROCESSING);

  hWallet.setState(HathorWallet.READY);
  await new Promise(resolve => { setTimeout(resolve, 0)});
  expect(hWallet.onEnterStateProcessing).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.READY);
});

test('getAddressAtIndex', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const hWallet = new FakeHathorWallet();

  jest.spyOn(storage, 'saveAddress').mockImplementation(() => Promise.resolve());
  const walletTypeSpy = jest.spyOn(storage, 'getWalletType');
  const addressSpy = jest.spyOn(storage, 'getAddressAtIndex');
  addressSpy.mockImplementationOnce(() => Promise.resolve({base58: 'a'}));
  addressSpy.mockImplementationOnce(() => Promise.resolve(null));
  hWallet.storage = storage;

  const p2pkhDeriveSpy = jest.spyOn(addressUtils, 'deriveAddressP2PKH').mockImplementationOnce(() => Promise.resolve({base58: 'address1'}));
  const p2shDeriveSpy = jest.spyOn(addressUtils, 'deriveAddressP2SH').mockImplementationOnce(() => Promise.resolve({base58: 'address2'}));

  await expect(hWallet.getAddressAtIndex(0)).resolves.toEqual('a');
  // Storage should return null from now on, so we will test if we call the derive methods
  // P2PKH
  walletTypeSpy.mockReturnValueOnce(Promise.resolve('p2pkh'));
  await expect(hWallet.getAddressAtIndex(1)).resolves.toEqual('address1');
  // P2SH
  walletTypeSpy.mockReturnValueOnce(Promise.resolve('p2sh'));
  await expect(hWallet.getAddressAtIndex(2)).resolves.toEqual('address2');

  p2pkhDeriveSpy.mockRestore();
  p2shDeriveSpy.mockRestore();
});

test('getAddressPrivKey', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const seed = 'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  const conn = {
    network: 'testnet',
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    on: jest.fn(),
    start: jest.fn(),
  };

  jest.spyOn(versionApi, 'getVersion')
    .mockImplementation(resolve => {
      resolve({
        network: 'testnet',
      });
    });

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  hWallet.seed = seed;
  hWallet.conn = conn;

  hWallet.getTokenData = jest.fn();
  hWallet.setState = jest.fn();

  await hWallet.start({ pinCode: '123', password: '456' });

  const address0 = await hWallet.getAddressAtIndex(0);
  const address0HDPrivKey = await hWallet.getAddressPrivKey('123', 0);

  expect(address0HDPrivKey.privateKey.toAddress(new Network('testnet').getNetwork()).toString())
    .toStrictEqual(address0);
});

test('signMessageWithAddress', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const seed = 'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  const conn = {
    network: 'testnet',
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    on: jest.fn(),
    start: jest.fn(),
  };

  jest.spyOn(versionApi, 'getVersion')
    .mockImplementation(resolve => {
      resolve({
        network: 'testnet',
      });
    });

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  hWallet.seed = seed;
  hWallet.conn = conn;

  hWallet.getTokenData = jest.fn();
  hWallet.setState = jest.fn();

  await hWallet.start({
    pinCode: '1234',
    password: '1234',
  });

  const message = 'sign-me-please';
  const addressIndex = 2;
  const signedMessage = await hWallet.signMessageWithAddress(
    message,
    addressIndex,
    '1234',
  );

  expect(verifyMessage(
    message,
    signedMessage,
    await hWallet.getAddressAtIndex(addressIndex),
  )).toBeTruthy();
});

test('GapLimit', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const gapSpy = jest.spyOn(storage, 'setGapLimit').mockImplementationOnce(() => Promise.resolve());
  jest.spyOn(storage, 'getGapLimit').mockImplementationOnce(() => Promise.resolve(123));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  await hWallet.setGapLimit(10);
  expect(gapSpy).toBeCalledWith(10);
  await expect(hWallet.getGapLimit()).resolves.toEqual(123);
});

test('getAccessData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const dataSpy = jest.spyOn(storage, 'getAccessData').mockImplementationOnce(() => Promise.resolve(null));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  // Throw if the wallet is not initialized
  await expect(hWallet.getAccessData()).rejects.toThrow('Wallet was not initialized.');
  // Return the access data from storage
  dataSpy.mockImplementationOnce(() => Promise.resolve('access data object'));
  await expect(hWallet.getAccessData()).resolves.toEqual('access data object');
});

test('getWalletType', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  jest.spyOn(storage, 'getAccessData')
      .mockImplementationOnce(() => Promise.resolve({
        walletType: 'p2pkh',
      }));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  await expect(hWallet.getWalletType()).resolves.toEqual('p2pkh');
});

test('getMultisigData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const dataSpy = jest.spyOn(storage, 'getAccessData')
      .mockImplementationOnce(() => Promise.resolve({
        walletType: 'p2pkh',
      }));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  // Should throw if the wallet is not a multisig wallet
  await expect(hWallet.getMultisigData()).rejects.toThrow('Wallet is not a multisig wallet.');

  // Should return the multisig data from storage
  dataSpy.mockImplementationOnce(() => Promise.resolve({
    walletType: 'multisig',
    multisigData: 'multisig data',
  }));
  await expect(hWallet.getMultisigData()).resolves.toEqual('multisig data');

  // Will throw if the multisig data is not found in storage
  dataSpy.mockImplementationOnce(() => Promise.resolve({
    walletType: 'multisig',
  }));
  await expect(hWallet.getMultisigData()).rejects.toThrow('Multisig data not found in storage');
});

test('start', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const seed = 'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  let accessData;
  async function saveAccessData(data) {
    accessData = data;
    await store.saveAccessData(data);
  }
  storage.saveAccessData = saveAccessData;

  const conn = {
    network: 'testnet',
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    on: jest.fn(),
    start: jest.fn(),
  };

  jest.spyOn(versionApi, 'getVersion').mockImplementation((resolve) => {
    resolve({
      network: 'testnet',
    });
  })

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  hWallet.seed = seed;
  hWallet.conn = conn;

  hWallet.getTokenData = jest.fn();
  hWallet.setState = jest.fn();

  await hWallet.start({ pinCode: '123', password: '456' });
  const actualAccessData = await storage.getAccessData();
  expect(decryptData(actualAccessData.words, '456')).toEqual(seed);
});

test('checkPin', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const checkPinSpy = jest.spyOn(storage, 'checkPin');

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  checkPinSpy.mockReturnValue(Promise.resolve(false));
  await expect(hWallet.checkPin('0000')).resolves.toEqual(false);
  expect(checkPinSpy).toHaveBeenCalledTimes(1);
  checkPinSpy.mockClear()

  checkPinSpy.mockReturnValue(Promise.resolve(true));
  await expect(hWallet.checkPin('0000')).resolves.toEqual(true);
  expect(checkPinSpy).toHaveBeenCalledTimes(1);
});

test('checkPassword', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const checkPasswdSpy = jest.spyOn(storage, 'checkPassword');

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  checkPasswdSpy.mockReturnValue(Promise.resolve(false));
  await expect(hWallet.checkPassword('0000')).resolves.toEqual(false);
  expect(checkPasswdSpy).toHaveBeenCalledTimes(1);
  checkPasswdSpy.mockClear()

  checkPasswdSpy.mockReturnValue(Promise.resolve(true));
  await expect(hWallet.checkPassword('0000')).resolves.toEqual(true);
  expect(checkPasswdSpy).toHaveBeenCalledTimes(1);
});

test('checkPinAndPassword', async () => {
  const hWallet = new FakeHathorWallet();
  const checkPinSpy = jest.spyOn(hWallet, 'checkPin');
  const checkPasswdSpy = jest.spyOn(hWallet, 'checkPassword');

  checkPinSpy.mockReturnValue(Promise.resolve(false));
  checkPasswdSpy.mockReturnValue(Promise.resolve(false));
  await expect(hWallet.checkPinAndPassword('0000', 'passwd')).resolves.toEqual(false);
  expect(checkPinSpy).toHaveBeenCalledTimes(1);
  expect(checkPasswdSpy).toHaveBeenCalledTimes(0);
  checkPinSpy.mockClear();
  checkPasswdSpy.mockClear();

  checkPinSpy.mockReturnValue(Promise.resolve(true));
  checkPasswdSpy.mockReturnValue(Promise.resolve(false));
  await expect(hWallet.checkPinAndPassword('0000', 'passwd')).resolves.toEqual(false);
  expect(checkPinSpy).toHaveBeenCalledTimes(1);
  expect(checkPasswdSpy).toHaveBeenCalledTimes(1);
  checkPinSpy.mockClear();
  checkPasswdSpy.mockClear();

  checkPinSpy.mockReturnValue(Promise.resolve(true));
  checkPasswdSpy.mockReturnValue(Promise.resolve(true));
  await expect(hWallet.checkPinAndPassword('0000', 'passwd')).resolves.toEqual(true);
  expect(checkPinSpy).toHaveBeenCalledTimes(1);
  expect(checkPasswdSpy).toHaveBeenCalledTimes(1);
  checkPinSpy.mockClear();
  checkPasswdSpy.mockClear();

  checkPinSpy.mockReturnValue(Promise.resolve(false));
  checkPasswdSpy.mockReturnValue(Promise.resolve(true));
  await expect(hWallet.checkPinAndPassword('0000', 'passwd')).resolves.toEqual(false);
  expect(checkPinSpy).toHaveBeenCalledTimes(1);
  expect(checkPasswdSpy).toHaveBeenCalledTimes(0);
  checkPinSpy.mockClear();
  checkPasswdSpy.mockClear();
});

test('getTxHistory', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const hWallet = new FakeHathorWallet();

  hWallet.storage = storage;

  async function * historyMock() {
    yield {
      tx_id: 'mock-tx-id',
      version: 1,
      timestamp: 123,
      is_voided: false,
    };
  }

  hWallet.getTxBalance = jest.fn().mockReturnValue(Promise.resolve({
    'mock-token-uid': 456,
  }));
  jest.spyOn(storage, 'tokenHistory').mockImplementation(historyMock);

  await expect(hWallet.getTxHistory({ token_id: 'mock-token-uid' }))
    .resolves.toStrictEqual([{
      txId: 'mock-tx-id',
      timestamp: 123,
      voided: false,
      balance: 456,
      version: 1,
      ncId: undefined,
      ncMethod: undefined,
      ncCaller: undefined,
    }]);

  await expect(hWallet.getTxHistory({ token_id: 'mock-token-uid2' }))
    .resolves.toMatchObject([{
      txId: 'mock-tx-id',
      timestamp: 123,
      voided: false,
      balance: 0,
      version: 1,
      ncId: undefined,
      ncMethod: undefined,
      ncCaller: undefined,
    }]);
});

test('isHardwareWallet', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  const hwSpy = jest.spyOn(storage, 'isHardwareWallet');

  hwSpy.mockReturnValue(Promise.resolve(true));
  await expect(hWallet.isHardwareWallet()).resolves.toBe(true);

  hwSpy.mockReturnValue(Promise.resolve(false));
  await expect(hWallet.isHardwareWallet()).resolves.toBe(false);
});

describe('prepare transactions without signature', () => {
  /**
   * Generate an async generator that yields utxo.
   */
  const generateSelectUtxos = (utxo) => {
    async function* fakeSelectUtxos(_options) {
      yield utxo;
    }
    return fakeSelectUtxos;
  }

  /**
   * Return an instance of Storage with mocks to support the tests.
   */
  const getStorage = (params) => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    jest.spyOn(storage, 'isReadonly').mockReturnValue(params.readOnly);
    jest.spyOn(storage, 'getCurrentAddress').mockResolvedValue(params.currentAddress);
    jest.spyOn(storage, 'selectUtxos').mockImplementation(params.selectUtxos);
    return storage;
  };

  const fakeAddress = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  const fakeTokenToDepositUtxo = {
    txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
    index: 0,
    value: 2,
    token: '00',
    address: fakeAddress.base58,
    authorities: 0,
  };

  test('prepareCreateNewToken', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo)
    });

    // prepare create token
    const txData = await hWallet.prepareCreateNewToken('01', 'my01', 100, {
      address: fakeAddress.base58,
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(1);
    expect(txData.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: null,
      }),
    ]));
  });

  test('prepareMintTokensData', async () => {
    // fake stuff to support the test
    const fakeMintAuthority = [{
      txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      index: 0,
      value: 1,
      token: '01',
      address: fakeAddress.base58,
      authorities: TOKEN_MINT_MASK,
      timelock: null,
      locked: false,
    }];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    jest.spyOn(hWallet, 'getMintAuthority').mockReturnValue(fakeMintAuthority);

    // prepare mint
    const txData = await hWallet.prepareMintTokensData('01', 100, {
      address: fakeAddress.base58,
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(2);
    expect(txData.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: null,
      }),
      expect.objectContaining({
        data: null,
      }),
    ]));
  });

  test('prepareMeltTokensData', async () => {
    // fake stuff to support the test
    const fakeTokenToMeltUtxo = {
      txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      index: 0,
      value: 100,
      token: '01',
      address: fakeAddress.base58,
      authorities: 0,
      timelock: null,
      locked: false,
    };
    const fakeMeltAuthority = [{
      txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      index: 0,
      value: 1,
      token: '01',
      address: fakeAddress.base58,
      authorities: TOKEN_MELT_MASK,
      timelock: null,
      locked: false,
    }];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToMeltUtxo),
    });
    jest.spyOn(hWallet, 'getMeltAuthority').mockReturnValue(fakeMeltAuthority);

    // prepare melt
    const txData = await hWallet.prepareMeltTokensData('01', 100, {
      address: fakeAddress.base58,
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(2);
    expect(txData.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: null,
      }),
      expect.objectContaining({
        data: null,
      }),
    ]));
  });
});

test('setExternalTxSigningMethod', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const hwallet = new FakeHathorWallet();
  hwallet.storage = storage;
  hwallet.setExternalTxSigningMethod(async () => {});
  expect(hwallet.isSignedExternally).toBe(true);
});
