/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
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
import { MemoryStore, Storage } from '../../src/storage';
import Queue from '../../src/models/queue';
import { IHistoryTx, WalletType } from '../../src/types';
import { WalletWebSocketData } from '../../src/new/types';
import txApi from '../../src/api/txApi';
import * as addressUtils from '../../src/utils/address';
import * as storageUtils from '../../src/utils/storage';
import walletUtils from '../../src/utils/wallet';
import versionApi from '../../src/api/version';
import { decryptData, verifyMessage } from '../../src/utils/crypto';
import { WalletTxTemplateInterpreter, TransactionTemplate } from '../../src/template/transaction';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';

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

afterEach(() => {
  jest.restoreAllMocks();
});

test('getFullTxById', async () => {
  const hWallet = new FakeHathorWallet();

  const getTxSpy = jest.spyOn(txApi, 'getTransaction');

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

  getTxSpy.mockImplementation((_txId, resolve) =>
    resolve({
      success: false,
      message: 'Invalid tx',
    })
  );

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrow('Invalid transaction tx1');

  getTxSpy.mockImplementation(() => {
    throw new Error('Unhandled error');
  });

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrow('Unhandled error');

  // Resolve the promise without calling the resolve param
  getTxSpy.mockImplementation(() => {
    return Promise.resolve();
  });

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrow('API client did not use the callback');

  getTxSpy.mockImplementation((_txId, resolve) =>
    resolve({
      success: false,
      message: 'Transaction not found',
    })
  );

  await expect(hWallet.getFullTxById('tx1')).rejects.toThrow(TxNotFoundError);
});

test('getTxConfirmationData', async () => {
  const hWallet = new FakeHathorWallet();

  const getConfirmationDataSpy = jest.spyOn(txApi, 'getConfirmationData');

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

  getConfirmationDataSpy.mockImplementation((_txId, resolve) =>
    resolve({
      success: false,
      message: 'Invalid tx',
    })
  );

  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrow('Invalid transaction tx1');

  getConfirmationDataSpy.mockImplementation((_txId, resolve) =>
    resolve({
      success: false,
      message: 'Transaction not found',
    })
  );

  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrow(TxNotFoundError);

  getConfirmationDataSpy.mockImplementation((_txId, resolve) => {
    throw new Error('unhandled error');
  });
  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrow('unhandled error');

  // Resolve the promise without calling the resolve param
  getConfirmationDataSpy.mockImplementation(() => Promise.resolve());
  await expect(hWallet.getTxConfirmationData('tx1')).rejects.toThrow(
    'API client did not use the callback'
  );
});

test('graphvizNeighborsQuery', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  const getGraphvizNeighborsSpy = jest.spyOn(txApi, 'getGraphvizNeighbors');

  const mockData = 'digraph {}';

  getGraphvizNeighborsSpy.mockImplementation((_tx, _graphType, _maxLevel, resolve) => {
    resolve(mockData);
  });

  const graphvizNeighborsQueryResponse = await hWallet.graphvizNeighborsQuery('tx1', 'type', 1);

  expect(graphvizNeighborsQueryResponse).toStrictEqual(mockData);

  getGraphvizNeighborsSpy.mockImplementation((_tx, _graphType, _maxLevel, resolve) =>
    resolve({
      success: false,
      message: 'Invalid tx',
    })
  );

  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrow(
    'Invalid transaction tx1'
  );

  getGraphvizNeighborsSpy.mockImplementation((_tx, _graphType, _maxLevel, resolve) =>
    resolve({
      success: false,
      message: 'Transaction not found',
    })
  );

  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrow(TxNotFoundError);

  getGraphvizNeighborsSpy.mockImplementation(() => {
    throw new Error('unhandled error');
  });
  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrow('unhandled error');

  // Resolve the promise without calling the resolve param
  getGraphvizNeighborsSpy.mockImplementation(() => Promise.resolve());
  await expect(hWallet.graphvizNeighborsQuery('tx1', 'type', 1)).rejects.toThrow(
    'API client did not use the callback'
  );
});

test('checkAddressesMine', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  jest.spyOn(storage, 'isAddressMine').mockImplementationOnce(() => Promise.resolve(true));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  expect(
    await hWallet.checkAddressesMine([
      'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
    ])
  ).toStrictEqual({
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
  jest.spyOn(storage, 'getTxSignatures').mockReturnValue(
    Promise.resolve({
      ncCallerSignature: null,
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
      ],
    })
  );

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
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'isReadonly').mockReturnValue(Promise.resolve(false));
  jest.spyOn(storage, 'getTxSignatures').mockReturnValue(
    Promise.resolve({
      ncCallerSignature: null,
      inputSignatures: [
        {
          signature: Buffer.from('ca', 'hex'),
          pubkey: Buffer.from('fe', 'hex'),
          inputIndex: 0,
          addressIndex: 0,
        },
        {
          signature: Buffer.from('ba', 'hex'),
          pubkey: Buffer.from('be', 'hex'),
          inputIndex: 2,
          addressIndex: 1,
        },
      ],
    })
  );

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  const txId = '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b';
  const tx = new Transaction([new Input(txId, 0), new Input(txId, 1), new Input(txId, 2)], [], {
    version: DEFAULT_TX_VERSION,
    tokens: [],
  });

  const returnedTx = await hWallet.signTx(tx, { pinCode: '123' });
  expect(returnedTx).toBe(tx);
  expect(storage.getTxSignatures).toHaveBeenCalledWith(tx, '123');
  expect(tx.inputs[0].data.toString('hex')).toEqual('01ca01fe');
  expect(tx.inputs[1].data).toEqual(null);
  expect(tx.inputs[2].data.toString('hex')).toEqual('01ba01be');
});

test('signTx throws when pinCode is not provided', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'isReadonly').mockReturnValue(Promise.resolve(false));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  // Ensure wallet has no pinCode set
  hWallet.pinCode = null;

  const txId = '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b';
  const tx = new Transaction([new Input(txId, 0)], [], {
    version: DEFAULT_TX_VERSION,
    tokens: [],
  });

  // Should throw when no pinCode is provided in options and wallet.pinCode is null
  await expect(hWallet.signTx(tx)).rejects.toThrow('Pin code is required to sign a transaction');
  await expect(hWallet.signTx(tx, {})).rejects.toThrow(
    'Pin code is required to sign a transaction'
  );
  await expect(hWallet.signTx(tx, { pinCode: null })).rejects.toThrow(
    'Pin code is required to sign a transaction'
  );
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
          outputs: [
            {
              decoded: {
                address: 'an-address',
              },
            },
          ],
        },
      };
    }
  }
  jest.spyOn(storage, 'getSpentTxs').mockImplementation(getSpentMock);
  jest.spyOn(storage, 'getAddressInfo').mockReturnValue(
    Promise.resolve({
      bip32AddressIndex: 10,
    })
  );
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
  };

  // wsTxQueue is not part of the prototype so it won't be faked on FakeHathorWallet
  hWallet.wsTxQueue = new Queue<WalletWebSocketData>();
  hWallet.wsTxQueue.enqueue({ type: 'fakeType' });
  hWallet.wsTxQueue.enqueue({ type: 'fakeType' });
  hWallet.wsTxQueue.enqueue({ type: 'fakeType' });

  await hWallet.processTxQueue();
  expect(processedTxs).toStrictEqual([
    { type: 'fakeType' },
    { type: 'fakeType' },
    { type: 'fakeType' },
  ]);
});

test('handleWebsocketMsg', async () => {
  const hWallet = new FakeHathorWallet();

  const processedTxs = [];
  hWallet.onNewTx.mockImplementation(data => {
    processedTxs.push(data);
    return Promise.resolve();
  });

  // wsTxQueue is not part of the prototype so it won't be faked on FakeHathorWallet
  hWallet.wsTxQueue = new Queue<WalletWebSocketData>();
  hWallet.wsTxQueue.enqueue({
    type: 'wallet:address_history',
    history: [1] as unknown as IHistoryTx,
  });
  hWallet.newTxPromise = Promise.resolve();

  hWallet.state = HathorWallet.PROCESSING;
  hWallet.handleWebsocketMsg({ type: 'wallet:address_history', history: [2] });
  await hWallet.newTxPromise;
  // We shouldn't process ws txs since we are PROCESSING
  expect(processedTxs.length).toEqual(0);
  expect(hWallet.wsTxQueue.size()).toEqual(2);

  // We should process txs when we are READY
  hWallet.state = HathorWallet.READY;
  hWallet.handleWebsocketMsg({ type: 'wallet:address_history', history: [3] });
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
        value: 2n,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'B',
        token_data: 2,
        value: 5n,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'C',
        token_data: 130,
        value: 2n,
        decoded: { address: 'Addr1' },
      },
    ],
    inputs: [
      {
        token: 'A',
        token_data: 1,
        value: 1n,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'A',
        token_data: 129,
        value: 1n,
        decoded: { address: 'Addr1' },
      },
      {
        token: 'B',
        token_data: 2,
        value: 10n,
        decoded: { address: 'Addr1' },
      },
    ],
  };

  expect(await hWallet.getTxBalance(tx)).toStrictEqual({
    A: 1n,
    B: -5n,
    C: 0n,
  });

  expect(await hWallet.getTxBalance(tx, { includeAuthorities: true })).toStrictEqual({
    A: 1n,
    B: -5n,
    C: 0n,
  });
});

test('setState', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.onEnterStateProcessing.mockImplementation(() => Promise.resolve());
  hWallet.emit = () => {};
  hWallet.state = 0;

  hWallet.setState(HathorWallet.SYNCING);
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  expect(hWallet.onEnterStateProcessing).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.SYNCING);

  hWallet.setState(HathorWallet.PROCESSING);
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  expect(hWallet.onEnterStateProcessing).toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.PROCESSING);
  hWallet.onEnterStateProcessing.mockClear();

  hWallet.setState(HathorWallet.PROCESSING);
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  expect(hWallet.onEnterStateProcessing).not.toHaveBeenCalled();
  expect(hWallet.state).toEqual(HathorWallet.PROCESSING);

  hWallet.setState(HathorWallet.READY);
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
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
  addressSpy.mockImplementationOnce(() => Promise.resolve({ base58: 'a' }));
  addressSpy.mockImplementationOnce(() => Promise.resolve(null));
  hWallet.storage = storage;

  const p2pkhDeriveSpy = jest
    .spyOn(addressUtils, 'deriveAddressP2PKH')
    .mockImplementationOnce(() => Promise.resolve({ base58: 'address1' }));
  const p2shDeriveSpy = jest
    .spyOn(addressUtils, 'deriveAddressP2SH')
    .mockImplementationOnce(() => Promise.resolve({ base58: 'address2' }));

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
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  const conn = {
    network: 'testnet',
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    on: jest.fn(),
    start: jest.fn(),
    getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
  };

  jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
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

  expect(
    address0HDPrivKey.privateKey.toAddress(new Network('testnet').getNetwork()).toString()
  ).toStrictEqual(address0);
});

test('signMessageWithAddress', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  const conn = {
    network: 'testnet',
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    on: jest.fn(),
    start: jest.fn(),
    getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
  };

  jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
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
  const signedMessage = await hWallet.signMessageWithAddress(message, addressIndex, '1234');

  expect(
    verifyMessage(message, signedMessage, await hWallet.getAddressAtIndex(addressIndex))
  ).toBeTruthy();
});

test('GapLimit', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const gapSpy = jest.spyOn(storage, 'setGapLimit').mockImplementationOnce(() => Promise.resolve());
  jest.spyOn(storage, 'getGapLimit').mockImplementationOnce(() => Promise.resolve(123));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  await hWallet.setGapLimit(10);
  expect(gapSpy).toHaveBeenCalledWith(10);
  await expect(hWallet.getGapLimit()).resolves.toEqual(123);
});

test('getAccessData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const dataSpy = jest
    .spyOn(storage, 'getAccessData')
    .mockImplementationOnce(() => Promise.resolve(null));

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

  jest.spyOn(storage, 'getAccessData').mockImplementationOnce(() =>
    Promise.resolve({
      walletType: 'p2pkh',
    })
  );

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  await expect(hWallet.getWalletType()).resolves.toEqual('p2pkh');
});

test('getMultisigData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);

  const dataSpy = jest.spyOn(storage, 'getAccessData').mockImplementationOnce(() =>
    Promise.resolve({
      walletType: 'p2pkh',
    })
  );

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  // Should throw if the wallet is not a multisig wallet
  await expect(hWallet.getMultisigData()).rejects.toThrow('Wallet is not a multisig wallet.');

  // Should return the multisig data from storage
  dataSpy.mockImplementationOnce(() =>
    Promise.resolve({
      walletType: 'multisig',
      multisigData: 'multisig data',
    })
  );
  await expect(hWallet.getMultisigData()).resolves.toEqual('multisig data');

  // Will throw if the multisig data is not found in storage
  dataSpy.mockImplementationOnce(() =>
    Promise.resolve({
      walletType: 'multisig',
    })
  );
  await expect(hWallet.getMultisigData()).rejects.toThrow('Multisig data not found in storage');
});

test('start', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  async function saveAccessData(data) {
    await store.saveAccessData(data);
  }
  storage.saveAccessData = saveAccessData;

  const conn = {
    network: 'testnet',
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    on: jest.fn(),
    start: jest.fn(),
    getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
  };

  jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
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
  checkPinSpy.mockClear();

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
  checkPasswdSpy.mockClear();

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
  const fakeNetwork = new Network('testnet');
  const fakeAddress = 'mock-address';

  const store = new MemoryStore();
  const storage = new Storage(store);

  const hWallet = new FakeHathorWallet();

  hWallet.storage = storage;

  async function* historyMock() {
    yield {
      tx_id: 'mock-tx-id',
      version: 1,
      timestamp: 123,
      is_voided: false,
      nc_id: 'mock-nc-id',
      nc_method: 'mock-nc-method',
      nc_address: fakeAddress,
      first_block: 'mock-first-block-hash',
    };
  }

  hWallet.getTxBalance = jest.fn().mockReturnValue(
    Promise.resolve({
      'mock-token-uid': 456,
    })
  );
  jest.spyOn(storage, 'tokenHistory').mockImplementation(historyMock);

  hWallet.getNetworkObject = jest.fn().mockReturnValue(fakeNetwork);

  await expect(hWallet.getTxHistory({ token_id: 'mock-token-uid' })).resolves.toStrictEqual([
    {
      txId: 'mock-tx-id',
      timestamp: 123,
      voided: false,
      balance: 456,
      version: 1,
      ncId: 'mock-nc-id',
      ncMethod: 'mock-nc-method',
      ncCaller: expect.objectContaining({ base58: 'mock-address' }),
      firstBlock: 'mock-first-block-hash',
    },
  ]);

  await expect(hWallet.getTxHistory({ token_id: 'mock-token-uid2' })).resolves.toMatchObject([
    {
      txId: 'mock-tx-id',
      timestamp: 123,
      voided: false,
      balance: 0n,
      version: 1,
      ncId: 'mock-nc-id',
      ncMethod: 'mock-nc-method',
      ncCaller: expect.objectContaining({ base58: 'mock-address' }),
      firstBlock: 'mock-first-block-hash',
    },
  ]);
});

describe('getShieldedUnblindingForTx', () => {
  // SEPARATED model: build a tx with transparent outputs in `outputs[]` and the
  // full on-chain-ordered shielded list in `shielded_outputs[]`. Owned slots
  // carry the owned-marker fields (value/token/blindingFactor[/assetBlindingFactor])
  // written IN PLACE; non-owned slots have `value === undefined`. The on-chain
  // absolute index of `shielded_outputs[s]` is `outputs.length + s`.
  const makeTx = (
    txId: string,
    transparent: Array<{ value: bigint; token: string }>,
    shielded: Array<{
      commitment: string;
      value?: bigint;
      token?: string;
      blindingFactor?: string;
      assetBlindingFactor?: string;
    }>
  ): IHistoryTx =>
    ({
      tx_id: txId,
      timestamp: 1,
      version: 1,
      weight: 1,
      nonce: 0,
      height: 0,
      parents: [],
      inputs: [],
      outputs: transparent.map(t => ({
        value: t.value,
        token_data: 0,
        token: t.token,
        spent_by: null,
        script: '',
        decoded: { type: 'P2PKH', address: 'addr1', timelock: null },
      })),
      // The FULL on-chain-ordered shielded list. Owned slots carry the
      // owned-marker fields; non-owned slots leave value/token/blinding
      // undefined.
      shielded_outputs: shielded.map(s => ({
        mode: s.assetBlindingFactor ? 2 : 1,
        commitment: s.commitment,
        range_proof: '',
        script: '',
        token_data: 0,
        ephemeral_pubkey: '',
        decoded: { type: 'P2PKH', address: 'addrShielded', timelock: null },
        spent_by: null,
        // owned-marker fields (undefined when not owned)
        value: s.value,
        token: s.token,
        blindingFactor: s.blindingFactor,
        assetBlindingFactor: s.assetBlindingFactor,
      })),
    }) as unknown as IHistoryTx;

  test('returns one entry per wallet-owned shielded output (index = T + s)', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;

    // 1 transparent output (T=1) → shielded slots map to on-chain indices 1,2,3.
    const tx = makeTx(
      'tx1',
      [{ value: 100n, token: '00' }],
      [
        // owned (decoded) AmountShielded — on-chain index = T(1) + 0 = 1
        { commitment: 'aa', value: 250n, token: '00', blindingFactor: 'cafe' },
        // not decoded — wallet doesn't own. value === undefined → skipped.
        { commitment: 'bb' },
        // owned FullShielded — on-chain index = T(1) + 2 = 3
        {
          commitment: 'cc',
          value: 999n,
          token: '0102',
          blindingFactor: 'beef',
          assetBlindingFactor: 'dead',
        },
      ]
    );
    jest.spyOn(storage, 'getTx').mockResolvedValue(tx);

    const result = await hWallet.getShieldedUnblindingForTx('tx1');

    expect(result.outputs).toEqual([
      { index: 1, value: 250n, token: '00', vbf: 'cafe' },
      { index: 3, value: 999n, token: '0102', vbf: 'beef', abf: 'dead' },
    ]);
    expect(result.inputs).toEqual([]);
  });

  test('returns empty when tx not found or has no decoded shielded outputs', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;

    jest.spyOn(storage, 'getTx').mockResolvedValueOnce(null);
    await expect(hWallet.getShieldedUnblindingForTx('missing')).resolves.toEqual({
      outputs: [],
      inputs: [],
    });

    const transparentOnly = makeTx('tx2', [{ value: 5n, token: '00' }], []);
    jest.spyOn(storage, 'getTx').mockResolvedValueOnce(transparentOnly);
    await expect(hWallet.getShieldedUnblindingForTx('tx2')).resolves.toEqual({
      outputs: [],
      inputs: [],
    });
  });

  test('owned slot at a non-prefix shielded position resolves to index T + s', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;

    // Two transparent outputs (T=2), then two shielded slots — the wallet owns
    // only the SECOND shielded slot (s=1). Its on-chain index must be the
    // arithmetic T(2) + s(1) = 3, with NO reliance on a stored onChainIndex.
    const tx = makeTx(
      'tx3',
      [
        { value: 1n, token: '00' },
        { value: 2n, token: '00' },
      ],
      [
        { commitment: 'foreign' }, // not owned (value undefined)
        { commitment: 'mine', value: 50n, token: '00', blindingFactor: 'fade' },
      ]
    );
    jest.spyOn(storage, 'getTx').mockResolvedValue(tx);

    const result = await hWallet.getShieldedUnblindingForTx('tx3');
    expect(result.outputs).toEqual([{ index: 3, value: 50n, token: '00', vbf: 'fade' }]);
    expect(result.inputs).toEqual([]);
  });

  test('returns inputs the wallet owned the parent output for', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;

    // Parent tx has 1 transparent output (T=1) + 1 shielded the wallet owns;
    // that shielded slot's on-chain index is T(1) + 0 = 1.
    const parent = makeTx(
      'parentA',
      [{ value: 10n, token: '00' }],
      [
        {
          commitment: 'parent-shielded-cm',
          value: 777n,
          token: '00',
          blindingFactor: 'parentVbf',
          assetBlindingFactor: 'parentAbf',
        },
      ]
    );

    // Spending tx: input #0 is a shielded reference to parentA[1] (the
    // wallet-owned output), input #1 is a shielded reference to a tx the wallet
    // doesn't have (no parent → skipped silently).
    const spending = {
      ...makeTx('spendA', [], [{ commitment: 'self-cm' }]),
      inputs: [
        { type: 'shielded', tx_id: 'parentA', index: 1, commitment: 'parent-shielded-cm' },
        { type: 'shielded', tx_id: 'foreign', index: 2, commitment: 'foreign-cm' },
        // Transparent input — ignored, doesn't need unblinding.
        {
          type: 'transparent',
          tx_id: 'parentA',
          index: 0,
          value: 10n,
          token: '00',
          token_data: 0,
          script: '',
          decoded: { type: 'P2PKH', address: 'addr1', timelock: null },
        },
      ],
    };

    jest.spyOn(storage, 'getTx').mockImplementation(async (id: string) => {
      if (id === 'spendA') return spending as unknown as IHistoryTx;
      if (id === 'parentA') return parent;
      return null;
    });

    const result = await hWallet.getShieldedUnblindingForTx('spendA');
    // Owned-parent input is included with the input position in the current tx
    // (`index: 0`). The foreign-parent input is silently skipped — the wallet
    // has no opening for it.
    expect(result.inputs).toEqual([
      { index: 0, value: 777n, token: '00', vbf: 'parentVbf', abf: 'parentAbf' },
    ]);
  });
});

describe('onNewTx shielded handling (SEPARATED model)', () => {
  const TX_ID = 'ab'.repeat(32); // 64-char hex tx_id

  // A bare wire shielded output (commitment-only, value-less) as the fullnode
  // re-delivers it after the wallet already decoded the slot once.
  const bareWireShielded = () => ({
    mode: 1,
    commitment: 'aa',
    range_proof: 'bb',
    script: 'cc',
    token_data: 0,
    ephemeral_pubkey: 'dd',
    decoded: { type: 'P2PKH', address: 'addrShielded', timelock: null },
    spent_by: null,
  });

  // The wire form of a re-delivered tx: transparent output(s) in outputs[],
  // bare value-less shielded entries in shielded_outputs[].
  const reDeliveredWire = () => ({
    tx_id: TX_ID,
    version: 1,
    weight: 1,
    timestamp: 1,
    is_voided: false,
    nonce: 0,
    inputs: [],
    outputs: [
      {
        value: 100n,
        token_data: 0,
        token: '00',
        script: '',
        spent_by: null,
        decoded: { type: 'P2PKH', address: 'addr1', timelock: null },
      },
    ],
    shielded_outputs: [bareWireShielded()],
    parents: [],
  });

  test('per-slot merge preserves decoded shielded data across a bare re-delivery', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;
    hWallet.state = HathorWallet.READY;
    hWallet.pinCode = null;
    hWallet.emit = () => {};
    hWallet.scanAddressesToLoad = jest.fn().mockResolvedValue(undefined);

    // The processing branches must not clobber our merged data; stub them.
    jest.spyOn(storage, 'processNewTx').mockResolvedValue(undefined);
    jest.spyOn(storage, 'processHistory').mockResolvedValue(undefined);
    jest.spyOn(storageUtils, 'processMetadataChanged').mockResolvedValue(undefined);

    // Storage already holds the DECODED tx — owned-marker fields are written in
    // place on shielded_outputs[0] (value/token/blinding present).
    const decodedStored = reDeliveredWire();
    decodedStored.shielded_outputs[0] = {
      ...bareWireShielded(),
      value: 250n,
      token: '00',
      blindingFactor: 'cafe',
      decoded: { type: 'P2PKH', address: 'addrShielded', timelock: null },
    };
    await storage.addTx(decodedStored as unknown as IHistoryTx);

    // A bare WS re-delivery arrives: shielded_outputs[] present but value-less.
    await hWallet.onNewTx({ type: 'wallet:address_history', history: reDeliveredWire() });

    const persisted = await storage.getTx(TX_ID);
    // The decoded owned-marker fields survived the re-delivery (per-slot merge).
    expect(persisted.shielded_outputs[0].value).toBe(250n);
    expect(persisted.shielded_outputs[0].token).toBe('00');
    expect(persisted.shielded_outputs[0].blindingFactor).toBe('cafe');
    // Transparent balance is untouched.
    expect(persisted.outputs[0].value).toBe(100n);
  });

  test('strips forged value/token/decoded off an incoming shielded input', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;
    hWallet.state = HathorWallet.READY;
    hWallet.pinCode = null;
    hWallet.emit = () => {};
    hWallet.scanAddressesToLoad = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(storage, 'processNewTx').mockResolvedValue(undefined);

    // A hostile payload: a NEW tx whose shielded input pre-fills the spent
    // output's value/token/decoded — fields the fullnode can never legitimately
    // know for a shielded output. The schema accepts them (all optional), so
    // onNewTx must strip them before the debit path can trust them.
    const forged = {
      tx_id: 'ba'.repeat(32),
      version: 1,
      weight: 1,
      timestamp: 1,
      is_voided: false,
      nonce: 0,
      inputs: [
        {
          type: 'shielded',
          tx_id: 'cc'.repeat(32),
          index: 0,
          value: 5000000n,
          token: '00',
          token_data: 0,
          decoded: { type: 'P2PKH', address: 'addrOwned', timelock: null },
        },
      ],
      outputs: [],
      parents: [],
    };
    await hWallet.onNewTx({ type: 'wallet:address_history', history: forged });

    const persisted = await storage.getTx('ba'.repeat(32));
    const input = persisted.inputs[0];
    expect(input.type).toBe('shielded');
    // The forged confidential fields are gone; the outpoint is kept.
    expect(input.value).toBeUndefined();
    expect(input.token).toBeUndefined();
    expect(input.decoded).toBeUndefined();
    expect(input.tx_id).toBe('cc'.repeat(32));
  });
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
  const generateSelectUtxos = utxo => {
    async function* fakeSelectUtxos(_options) {
      yield utxo;
    }
    return fakeSelectUtxos;
  };

  /**
   * Return an instance of Storage with mocks to support the tests.
   */
  const getStorage = params => {
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
    value: 2n,
    token: '00',
    address: fakeAddress.base58,
    authorities: 0n,
  };

  test('prepareCreateNewToken', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });

    // prepare create token
    const txData = await hWallet.prepareCreateNewToken('01', 'my01', 100n, {
      address: fakeAddress.base58,
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(1);
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: null,
        }),
      ])
    );
  });

  test('prepareMintTokensData', async () => {
    // fake stuff to support the test
    const fakeMintAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1n,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MINT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    jest.spyOn(hWallet, 'getMintAuthority').mockReturnValue(fakeMintAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // prepare mint
    const txData = await hWallet.prepareMintTokensData('01', 100n, {
      address: fakeAddress.base58,
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(2);
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: null,
        }),
        expect.objectContaining({
          data: null,
        }),
      ])
    );
  });

  test('prepareMintTokensData with data output', async () => {
    // fake stuff to support the test
    const fakeMintAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MINT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    jest.spyOn(hWallet, 'getMintAuthority').mockReturnValue(fakeMintAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // prepare mint
    const txData = await hWallet.prepareMintTokensData('01', 100n, {
      address: fakeAddress.base58,
      pinCode: '1234',
      unshiftData: true,
      data: ['foobar'],
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(2);
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: null,
        }),
        expect.objectContaining({
          data: null,
        }),
      ])
    );
    expect(txData.outputs).toHaveLength(3);
    expect(txData.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          script: Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]),
          tokenData: 0,
          value: 1n,
        }),
        expect.objectContaining({
          value: 100n,
          tokenData: 1,
        }),
        expect.objectContaining({
          tokenData: 129,
          value: 1n,
        }),
      ])
    );
  });

  test('prepareMintTokensData with over available tokens amount', async () => {
    const amountAvailable = 1n;
    const amountOverAvailable = 1000n;
    // fake stuff to support the test
    const fakeMintAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1n,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MINT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos({ ...fakeTokenToDepositUtxo, value: amountAvailable }),
    });
    jest.spyOn(hWallet, 'getMintAuthority').mockReturnValue(fakeMintAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // prepare mint
    await expect(
      hWallet.prepareMintTokensData('01', amountOverAvailable, {
        address: fakeAddress.base58,
        pinCode: '1234',
        signTx: false, // skip the signature
      })
    ).rejects.toThrow('Not enough HTR tokens for deposit or fee: 10 required, 1 available');
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
    const fakeMeltAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MELT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToMeltUtxo),
    });
    jest.spyOn(hWallet, 'getMeltAuthority').mockReturnValue(fakeMeltAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // prepare melt
    const txData = await hWallet.prepareMeltTokensData('01', 100, {
      address: fakeAddress.base58,
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(2);
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: null,
        }),
        expect.objectContaining({
          data: null,
        }),
      ])
    );
  });

  test('prepareMeltTokensData with data outputs', async () => {
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
    const fakeMeltAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MELT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToMeltUtxo),
    });
    jest.spyOn(hWallet, 'getMeltAuthority').mockReturnValue(fakeMeltAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // prepare melt
    const txData = await hWallet.prepareMeltTokensData('01', 100, {
      address: fakeAddress.base58,
      unshiftData: true,
      data: ['foobar'],
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // assert the transaction is not signed
    expect(txData.inputs).toHaveLength(2);
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: null,
        }),
        expect.objectContaining({
          data: null,
        }),
      ])
    );
    // outputs: data + authority
    expect(txData.outputs).toHaveLength(2);
    expect(txData.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          script: Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]),
          tokenData: 0,
          value: 1n,
        }),
        expect.objectContaining({
          tokenData: 129,
          value: 2n,
        }),
      ])
    );
  });

  test('prepareMeltTokensData with data outputs and selecting utxos', async () => {
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
    const fakeMeltAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MELT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: jest.fn(),
    });
    hWallet.storage.selectUtxos.mockImplementationOnce(generateSelectUtxos(fakeTokenToMeltUtxo));
    hWallet.storage.selectUtxos.mockImplementationOnce(generateSelectUtxos(fakeTokenToDepositUtxo));
    jest.spyOn(hWallet, 'getMeltAuthority').mockReturnValue(fakeMeltAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // prepare melt
    const txData = await hWallet.prepareMeltTokensData('01', 100, {
      address: fakeAddress.base58,
      unshiftData: true,
      data: ['foobar1', 'foobar2'],
      pinCode: '1234',
      signTx: false, // skip the signature
    });

    // melt authority + HTR deposit for data output + token to melt
    expect(txData.inputs).toHaveLength(3);
    // assert the transaction is not signed
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: null,
        }),
        expect.objectContaining({
          data: null,
        }),
        expect.objectContaining({
          data: null,
        }),
      ])
    );
    // outputs: data x2 + change + authority
    expect(txData.outputs).toHaveLength(4);
    expect(txData.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          script: Buffer.from([7, 102, 111, 111, 98, 97, 114, 50, 172]),
          tokenData: 0,
          value: 1n,
        }),
        expect.objectContaining({
          script: Buffer.from([7, 102, 111, 111, 98, 97, 114, 49, 172]),
          tokenData: 0,
          value: 1n,
        }),
        expect.objectContaining({
          tokenData: 0,
          value: 1n,
        }),
        expect.objectContaining({
          tokenData: 129,
          value: 2n,
        }),
      ])
    );
  });

  test('prepareMeltTokensData with over available tokens amount', async () => {
    const availableToken = 10n;
    const amountOverAvailable = 100n;
    // fake stuff to support the test
    const fakeTokenToMeltUtxo = {
      txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      index: 0,
      value: availableToken,
      token: '01',
      address: fakeAddress.base58,
      authorities: 0,
      timelock: null,
      locked: false,
    };
    const fakeMeltAuthority = [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        value: 1,
        token: '01',
        address: fakeAddress.base58,
        authorities: TOKEN_MELT_MASK,
        timelock: null,
        locked: false,
      },
    ];

    // wallet and mocks
    const hWallet = new FakeHathorWallet();
    const storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToMeltUtxo),
    });

    jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

    hWallet.storage = storage;
    jest.spyOn(hWallet, 'getMeltAuthority').mockReturnValue(fakeMeltAuthority);

    // prepare melt
    await expect(
      hWallet.prepareMeltTokensData('01', amountOverAvailable, {
        address: fakeAddress.base58,
        pinCode: '1234',
        signTx: false, // skip the signature
      })
    ).rejects.toThrow('Not enough tokens to melt: 100 requested, 10 available');
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

test('build transaction template', async () => {
  const input = new Input('d00d', 0);
  const dataSpy = jest.spyOn(input, 'setData');
  const preMadeTx = new Transaction([input], []);

  const hwallet = new FakeHathorWallet() as HathorWallet;
  const interpreter = {
    build: jest
      .fn()
      .mockImplementation(
        async (_instructions: z.infer<typeof TransactionTemplate>, _debug: boolean) => preMadeTx
      ),
  } as unknown as WalletTxTemplateInterpreter;
  hwallet.txTemplateInterpreter = interpreter;
  hwallet.debug = true;

  const tx = await hwallet.buildTxTemplate([{ type: 'action/complete' }]);
  expect(tx).toBe(preMadeTx);
  expect(interpreter.build).toHaveBeenCalledTimes(1);
  expect(interpreter.build).toHaveBeenCalledWith(
    [expect.objectContaining({ type: 'action/complete' })],
    true
  );
  expect(dataSpy).not.toHaveBeenCalled();
});

test('build transaction template with signature', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'getTxSignatures').mockReturnValue(
    Promise.resolve({
      ncCallerSignature: null,
      inputSignatures: [
        {
          signature: Buffer.from('cafe', 'hex'),
          pubkey: Buffer.from('abcd', 'hex'),
          inputIndex: 0,
          addressIndex: 1,
        },
      ],
    })
  );

  const input = new Input('d00d', 0);
  const dataSpy = jest.spyOn(input, 'setData');
  const preMadeTx = new Transaction([input], []);

  const hwallet = new FakeHathorWallet() as HathorWallet;
  hwallet.storage = storage;
  const interpreter = {
    build: jest
      .fn()
      .mockImplementation(
        async (_instructions: z.infer<typeof TransactionTemplate>, _debug: boolean) => preMadeTx
      ),
  } as unknown as WalletTxTemplateInterpreter;
  hwallet.txTemplateInterpreter = interpreter;
  hwallet.debug = true;

  const tx = await hwallet.buildTxTemplate([{ type: 'action/complete' }], {
    signTx: true,
    pinCode: '123',
  });
  expect(tx).toBe(preMadeTx);
  expect(interpreter.build).toHaveBeenCalledTimes(1);
  expect(interpreter.build).toHaveBeenCalledWith(
    [expect.objectContaining({ type: 'action/complete' })],
    true
  );
  expect(dataSpy).toHaveBeenCalledTimes(1);
});

test('runTxTemplate', async () => {
  const hwallet = new FakeHathorWallet();
  const tx = 'a-transaction';
  hwallet.buildTxTemplate.mockImplementation(async () => tx);
  hwallet.handleSendPreparedTransaction.mockImplementation(async () => tx);

  const pushedTx = await hwallet.runTxTemplate('a-template', 'pin');
  expect(pushedTx).toBe(tx);
  expect(hwallet.buildTxTemplate).toHaveBeenCalled();
  expect(hwallet.buildTxTemplate).toHaveBeenCalledWith('a-template', {
    signTx: true,
    pinCode: 'pin',
  });
  expect(hwallet.handleSendPreparedTransaction).toHaveBeenCalled();
  expect(hwallet.handleSendPreparedTransaction).toHaveBeenCalledWith(tx);
});

test('getUtxosForAmount - should always get the best utxos', async () => {
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const accessData = walletUtils.generateAccessDataFromSeed(seed, {
    pin: '123',
    password: '456',
    networkName: 'testnet',
  });
  const store = new MemoryStore();
  await store.saveAccessData(accessData);
  const storage = new Storage(store);
  const hwallet = new FakeHathorWallet();
  hwallet.storage = storage;
  // When selecting 6n we should always get the 6n output, even if the sum of
  // the first 3 may solve the required 6n.
  for (const amount of [3n, 1n, 2n, 4n, 6n]) {
    await storage.store.saveUtxo({
      txId: 'tx1',
      index: Number(amount),
      value: amount,
      address: 'addr',
      authorities: 0n,
      height: 0,
      timelock: null,
      token: '00',
      type: 1,
    });
  }

  await expect(hwallet.getUtxosForAmount(6n)).resolves.toEqual({
    changeAmount: 0n,
    utxos: [
      expect.objectContaining({
        index: 6,
        value: 6n,
      }),
    ],
  });
});

describe('hasTxOutsideFirstAddress', () => {
  test('returns true when there are transactions on addresses with index > 0', async () => {
    async function getAddressAtIndexMock(index: number) {
      return `addr${index}`;
    }
    async function* loadAddressHistoryMock() {
      yield true;
    }

    const spy = jest
      .spyOn(storageUtils, 'loadAddressHistory')
      .mockImplementation(loadAddressHistoryMock);

    try {
      const hWallet = new FakeHathorWallet();
      hWallet.getAddressAtIndex = jest.fn().mockImplementation(getAddressAtIndexMock);

      await expect(hWallet.hasTxOutsideFirstAddress()).resolves.toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test('returns false when only the first address has transactions', async () => {
    async function getAddressAtIndexMock(index: number) {
      return `addr${index}`;
    }
    async function* loadAddressHistoryMock() {
      yield false;
    }

    const spy = jest
      .spyOn(storageUtils, 'loadAddressHistory')
      .mockImplementation(loadAddressHistoryMock);

    try {
      const hWallet = new FakeHathorWallet();
      hWallet.getAddressAtIndex = jest.fn().mockImplementation(getAddressAtIndexMock);

      await expect(hWallet.hasTxOutsideFirstAddress()).resolves.toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('deposit/withdraw facade methods', () => {
  const buildWallet = (state: number) => {
    const storage = new Storage(new MemoryStore());
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;
    hWallet.state = state;
    return hWallet;
  };

  test('delegate to the util with the fraction from storage', () => {
    const hWallet = buildWallet(HathorWallet.READY);
    // 3% deposit percentage; deposit rounds up and withdraw rounds down for 1010.
    jest
      .spyOn(hWallet.storage, 'getTokenDepositPercentageFraction')
      .mockReturnValue({ numerator: 3n, denominator: 100n });

    expect(hWallet.getDepositAmount(1010n)).toBe(31n); // ceil(30.3)
    expect(hWallet.getWithdrawAmount(1010n)).toBe(30n); // floor(30.3)
  });

  test('throw when the wallet is not ready', () => {
    const hWallet = buildWallet(HathorWallet.CLOSED);
    expect(() => hWallet.getDepositAmount(1010n)).toThrow('Wallet not ready');
    expect(() => hWallet.getWithdrawAmount(1010n)).toThrow('Wallet not ready');
  });
});

describe('getAddressInfo shielded accounting (SEPARATED model)', () => {
  // SEPARATED model: owned shielded outputs are decoded in place onto
  // tx.shielded_outputs[] (value/token written after decryption) with
  // decoded.address = the shielded-spend P2PKH. getAddressInfo mirrors the
  // transparent accounting over shielded_outputs so a shielded receive/spend on
  // the queried address is reflected in the per-address totals.
  //
  // A shielded slot is wallet-OWNED only when so.value !== undefined; a slot is
  // spent when so.spent_by is non-null; a slot is locked when its decoded
  // timelock is in the future (height/reward lock stays off here since the
  // store's bestBlockHeight is 0 and storage.version is undefined).
  test('sums received/sent/locked/available over owned shielded outputs only', async () => {
    const ownedAddress = 'addrOwned';
    const token = '00';
    const futureTimelock = Math.floor(Date.now() / 1000) + 3600;

    // A history tx whose shielded_outputs[] cover every accounting branch for
    // the queried (ownedAddress, token):
    //   A: owned, unspent, unlocked  -> received + available
    //   B: owned, spent              -> received + sent (and nothing else)
    //   C: owned, locked (timelock)  -> received + locked (not available)
    //   D: non-owned (value=undef)   -> excluded from every total
    //   E: owned but wrong token     -> excluded (token filter)
    //   F: owned but wrong address   -> excluded (address filter)
    const tx = {
      tx_id: 'shieldedTx',
      timestamp: 1,
      version: 1,
      weight: 1,
      nonce: 0,
      height: 0,
      is_voided: false,
      parents: [],
      inputs: [],
      outputs: [],
      shielded_outputs: [
        // A: owned, unspent, unlocked
        {
          mode: 1,
          commitment: 'aa',
          spent_by: null,
          token,
          value: 250n,
          blindingFactor: 'cafe',
          decoded: { type: 'P2PKH', address: ownedAddress, timelock: null },
        },
        // B: owned, spent
        {
          mode: 1,
          commitment: 'bb',
          spent_by: 'spendTx',
          token,
          value: 100n,
          blindingFactor: 'beef',
          decoded: { type: 'P2PKH', address: ownedAddress, timelock: null },
        },
        // C: owned, time-locked
        {
          mode: 1,
          commitment: 'cc',
          spent_by: null,
          token,
          value: 70n,
          blindingFactor: 'face',
          decoded: { type: 'P2PKH', address: ownedAddress, timelock: futureTimelock },
        },
        // D: non-owned (value undefined) -> skipped before any total
        {
          mode: 1,
          commitment: 'dd',
          spent_by: null,
          decoded: { type: 'P2PKH', address: ownedAddress, timelock: null },
        },
        // E: owned but a different token -> token filter excludes it
        {
          mode: 1,
          commitment: 'ee',
          spent_by: null,
          token: '0102',
          value: 500n,
          blindingFactor: 'dead',
          decoded: { type: 'P2PKH', address: ownedAddress, timelock: null },
        },
        // F: owned but a different address -> address filter excludes it
        {
          mode: 1,
          commitment: 'ff',
          spent_by: null,
          token,
          value: 999n,
          blindingFactor: 'feed',
          decoded: { type: 'P2PKH', address: 'addrOther', timelock: null },
        },
      ],
    } as unknown as IHistoryTx;

    const store = new MemoryStore();
    const storage = new Storage(store);
    async function* txHistoryMock() {
      yield tx;
    }
    jest.spyOn(storage, 'txHistory').mockImplementation(txHistoryMock);
    jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
    jest
      .spyOn(storage, 'getAddressInfo')
      .mockResolvedValue({ bip32AddressIndex: 7 } as unknown as ReturnType<
        typeof storage.getAddressInfo
      >);

    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;

    const info = await hWallet.getAddressInfo(ownedAddress, { token });

    // Hand-computed expectations over the owned, matching-token slots A/B/C:
    //   received  = 250 + 100 + 70 = 420
    //   sent      = 100             (only the spent slot B)
    //   locked    = 70              (only the time-locked slot C)
    //   available = 250             (only the unspent, unlocked slot A)
    expect(info.total_amount_received).toBe(420n);
    expect(info.total_amount_sent).toBe(100n);
    expect(info.total_amount_locked).toBe(70n);
    expect(info.total_amount_available).toBe(250n);
    expect(info.token).toBe(token);
    expect(info.index).toBe(7);
  });
});
