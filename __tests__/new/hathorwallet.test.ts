/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import bitcore from 'bitcore-lib';
import Address from '../../src/models/address';
import HathorWallet from '../../src/new/wallet';
import {
  NanoContractTransactionError,
  ShieldedKeyError,
  TxNotFoundError,
  WalletFromXPubGuard,
} from '../../src/errors';
import Network from '../../src/models/network';
import Transaction from '../../src/models/transaction';
import transactionUtils from '../../src/utils/transaction';
import Input from '../../src/models/input';
import {
  DEFAULT_TX_VERSION,
  NATIVE_TOKEN_UID,
  P2PKH_ACCT_PATH,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import Queue from '../../src/models/queue';
import {
  EcdsaTxSign,
  HistorySyncMode,
  IHistoryTx,
  IWalletAccessData,
  SCANNING_POLICY,
  TxHistoryProcessingStatus,
  WALLET_FLAGS,
  WalletType,
} from '../../src/types';
import { ConnectionState, OutputType } from '../../src/wallet/types';
import { WalletWebSocketData } from '../../src/new/types';
import txApi from '../../src/api/txApi';
import * as addressUtils from '../../src/utils/address';
import * as storageUtils from '../../src/utils/storage';
import walletUtils from '../../src/utils/wallet';
import versionApi from '../../src/api/version';
import { decryptData, encryptData, verifyMessage } from '../../src/utils/crypto';
import { getOracleBuffer, unsafeGetOracleInputData } from '../../src/nano_contracts/utils';
import { WalletTxTemplateInterpreter, TransactionTemplate } from '../../src/template/transaction';
import { OutputKind, ShieldedOutputMode } from '../../src/shielded/types';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';
import walletApi from '../../src/api/wallet';
import type { IShieldedCapability, IShieldedCryptoProvider } from '../../src/shielded/types';
import { unlockScanXPrivKey } from '../../src/shielded/scanKey';

/** What a wallet keeps on its storage about its shielded view, as these tests read it. */
function shieldedOf(storage: Storage) {
  return {
    get active() {
      return storage.shieldedView.started;
    },
    get hasKey() {
      return storage.scanXPrivKey !== null;
    },
    get cause() {
      return storage.shieldedView.cause;
    },
    get integrity() {
      return storage.shieldedView.integrity;
    },
  };
}

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

test('sendManyOutputsSendTransaction maps shielded and transparent outputs', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.storage = {
    isReadonly: jest.fn().mockResolvedValue(false),
  };
  hWallet.pinCode = '123';

  const sendTx = await hWallet.sendManyOutputsSendTransaction([
    // Shielded, timelock 0 → shieldedMode carried, timelock preserved.
    {
      address: 'shielded-addr',
      value: 10n,
      token: NATIVE_TOKEN_UID,
      shielded: ShieldedOutputMode.FULLY_SHIELDED,
      timelock: 0,
    },
    // Transparent, timelock 0 → preserved via the unified `!= null` guard
    // (the old `o.timelock ?` guard would have dropped it).
    {
      address: 'transparent-timelock0-addr',
      value: 20n,
      token: NATIVE_TOKEN_UID,
      timelock: 0,
    },
    // Transparent, no timelock → no timelock key, no shieldedMode.
    {
      address: 'transparent-addr',
      value: 30n,
      token: '01',
    },
    // Shielded, no timelock → shieldedMode carried, no timelock key.
    {
      address: 'shielded-no-timelock-addr',
      value: 40n,
      token: '01',
      shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
    },
  ]);

  expect(sendTx.outputs).toHaveLength(4);
  expect(sendTx.outputs[0]).toEqual({
    address: 'shielded-addr',
    value: 10n,
    token: NATIVE_TOKEN_UID,
    timelock: 0,
    shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
  });
  expect(sendTx.outputs[1]).toEqual({
    address: 'transparent-timelock0-addr',
    value: 20n,
    token: NATIVE_TOKEN_UID,
    timelock: 0,
  });
  expect(sendTx.outputs[2]).toEqual({
    address: 'transparent-addr',
    value: 30n,
    token: '01',
  });
  expect(sendTx.outputs[3]).toEqual({
    address: 'shielded-no-timelock-addr',
    value: 40n,
    token: '01',
    shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
  });
});

test('sendTransactionInstance passes the change mode on to the send', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.storage = {
    isReadonly: jest.fn().mockResolvedValue(false),
  };
  hWallet.pinCode = '123';

  const sendTx = await hWallet.sendTransactionInstance('transparent-addr', 10n, {
    changeShieldedMode: OutputKind.TRANSPARENT,
  });

  expect(sendTx.changeShieldedMode).toBe(OutputKind.TRANSPARENT);
});

test('sendManyOutputsSendTransaction keeps data outputs untouched', async () => {
  const hWallet = new FakeHathorWallet();
  hWallet.storage = {
    isReadonly: jest.fn().mockResolvedValue(false),
  };
  hWallet.pinCode = '123';

  const dataOutput = { type: OutputType.DATA, data: 'test' } as const;
  const sendTx = await hWallet.sendManyOutputsSendTransaction([
    dataOutput,
    { address: 'transparent-addr', value: 30n, token: NATIVE_TOKEN_UID },
    {
      address: 'shielded-addr',
      value: 10n,
      token: NATIVE_TOKEN_UID,
      shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
    },
  ]);

  // A data output has no address, so rebuilding it as a token output would drop its
  // `type` and `data` and make SendTransaction fail with an undefined address.
  expect(sendTx.outputs).toHaveLength(3);
  expect(sendTx.outputs[0]).toEqual({ type: OutputType.DATA, data: 'test' });
  // SendTransaction sets `token` on its outputs, so it must get a copy, not the caller's object.
  expect(sendTx.outputs[0]).not.toBe(dataOutput);
  expect(sendTx.outputs[1]).toEqual({
    address: 'transparent-addr',
    value: 30n,
    token: NATIVE_TOKEN_UID,
  });
  expect(sendTx.outputs[2]).toEqual({
    address: 'shielded-addr',
    value: 10n,
    token: NATIVE_TOKEN_UID,
    shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
  });
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

test('signTx does not require a pinCode when an external signing method is registered', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'isReadonly').mockReturnValue(Promise.resolve(false));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  // No pin available anywhere: the external signer must cover for it.
  hWallet.pinCode = null;

  const txId = '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b';
  const tx = new Transaction([new Input(txId, 0)], [], {
    version: DEFAULT_TX_VERSION,
    tokens: [],
  });

  // An external signer produces signatures without using the pin.
  const externalSigner = jest.fn(async () => ({
    ncCallerSignature: null,
    inputSignatures: [
      {
        signature: Buffer.from('ca', 'hex'),
        pubkey: Buffer.from('fe', 'hex'),
        inputIndex: 0,
        addressIndex: 0,
      },
    ],
  }));
  storage.setTxSignatureMethod(externalSigner as unknown as EcdsaTxSign);

  // Must NOT throw the pin-required error, and must sign through the external method.
  const returnedTx = await hWallet.signTx(tx);
  expect(returnedTx).toBe(tx);
  expect(externalSigner).toHaveBeenCalledTimes(1);
  // The pin is unused by the external signer; the lib forwards an empty string.
  expect(externalSigner).toHaveBeenCalledWith(tx, storage, '');
  expect(tx.inputs[0].data.toString('hex')).toEqual('01ca01fe');
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
  // setState settles the callers waiting for a walk.
  hWallet.shieldedWalkWaiters = [];

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
  // start() queues the 'shielded-capability' event.
  hWallet.shieldedCapabilityEmitted = null;
  hWallet.shieldedCapabilityCheckQueued = false;
  hWallet.shieldedCapabilityChecks = Promise.resolve();
  hWallet.emit = jest.fn();

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
  // start() queues the 'shielded-capability' event.
  hWallet.shieldedCapabilityEmitted = null;
  hWallet.shieldedCapabilityCheckQueued = false;
  hWallet.shieldedCapabilityChecks = Promise.resolve();
  hWallet.emit = jest.fn();

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

// Helper for the external-private-key-provider tests: a started seed wallet (so addresses and
// getMainXPrivKey work), which the tests then overlay with an external provider.
async function makeStartedWallet() {
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
    resolve({ network: 'testnet' });
  });
  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  hWallet.seed = seed;
  hWallet.conn = conn;
  hWallet.getTokenData = jest.fn();
  hWallet.setState = jest.fn();
  // start() queues the 'shielded-capability' event.
  hWallet.shieldedCapabilityEmitted = null;
  hWallet.shieldedCapabilityCheckQueued = false;
  hWallet.shieldedCapabilityChecks = Promise.resolve();
  hWallet.emit = jest.fn();
  await hWallet.start({ pinCode: '1234', password: '1234' });
  return { hWallet, storage };
}

// A provider that mimics a passkey signer: derives the address key from the change-path xpriv.
function makeProvider(storage) {
  return jest.fn(async addressIndex => {
    const xprivkey = await storage.getMainXPrivKey('1234');
    return new bitcore.HDPrivateKey(xprivkey).deriveNonCompliantChild(addressIndex).privateKey;
  });
}

test('signMessageWithAddress uses an external private-key provider (no pin required)', async () => {
  const { hWallet, storage } = await makeStartedWallet();
  const provider = makeProvider(storage);
  hWallet.setExternalPrivateKeyMethod(provider);

  const message = 'sign-me-please';
  const addressIndex = 2;
  // No pin passed — the provider covers for it.
  const signedMessage = await hWallet.signMessageWithAddress(message, addressIndex);

  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider).toHaveBeenCalledWith(addressIndex, storage, { pinCode: undefined });
  expect(
    verifyMessage(message, signedMessage, await hWallet.getAddressAtIndex(addressIndex))
  ).toBeTruthy();
});

test('getPrivateKeyFromAddress uses the provider and bypasses the readonly guard', async () => {
  const { hWallet, storage } = await makeStartedWallet();
  const addressIndex = 0;
  // Return the real key for this index so it passes getVerifiedExternalPrivateKey's address check.
  const expectedKey = new bitcore.HDPrivateKey(
    await storage.getMainXPrivKey('1234')
  ).deriveNonCompliantChild(addressIndex).privateKey;
  const provider = jest.fn(async () => expectedKey);
  hWallet.setExternalPrivateKeyMethod(provider);
  // Even a readonly wallet must reach the provider (no WalletFromXPubGuard, no pin).
  jest.spyOn(storage, 'isReadonly').mockResolvedValue(true);
  // This harness doesn't persist address records, so map the real address to its index.
  const address = await hWallet.getAddressAtIndex(addressIndex);
  hWallet.getAddressIndex = jest.fn().mockResolvedValue(addressIndex);

  await expect(hWallet.getPrivateKeyFromAddress(address)).resolves.toBe(expectedKey);
  expect(provider).toHaveBeenCalledWith(addressIndex, storage, {});
  // expectedAddress is verification-only; it must not leak into the provider contract.
  expect(provider.mock.calls[0][2]).not.toHaveProperty('expectedAddress');
});

test('getPrivateKeyFromAddress rejects a provider key for the wrong address', async () => {
  const { hWallet, storage } = await makeStartedWallet();
  // Provider returns the key for index 5 regardless of the requested index.
  const wrongKey = new bitcore.HDPrivateKey(
    await storage.getMainXPrivKey('1234')
  ).deriveNonCompliantChild(5).privateKey;
  const provider = jest.fn(async () => wrongKey);
  hWallet.setExternalPrivateKeyMethod(provider);
  hWallet.getAddressIndex = jest.fn().mockResolvedValue(0);

  await expect(
    hWallet.getPrivateKeyFromAddress(await hWallet.getAddressAtIndex(0))
  ).rejects.toThrow('External private key provider returned a key for the wrong address.');
});

test('getPrivateKeyFromAddress verifies against the requested address, not just its index', async () => {
  // A BIP32 index can carry a legacy, a shielded and a shielded-spend address. Simulate a request
  // for a non-legacy sibling of index 0: a different address that resolves to the same index.
  const { hWallet, storage } = await makeStartedWallet();
  const siblingAddress = await hWallet.getAddressAtIndex(3); // stand-in for the spend address
  hWallet.getAddressIndex = jest.fn().mockResolvedValue(0);
  // An index-only provider returns the LEGACY key of index 0 — the wrong key for this address.
  const legacyKey = new bitcore.HDPrivateKey(
    await storage.getMainXPrivKey('1234')
  ).deriveNonCompliantChild(0).privateKey;
  const provider = jest.fn(async () => legacyKey);
  hWallet.setExternalPrivateKeyMethod(provider);

  // Comparing against the legacy address at index 0 would accept it and silently hand back the
  // wrong key; comparing against the requested address rejects it (fails closed).
  await expect(hWallet.getPrivateKeyFromAddress(siblingAddress)).rejects.toThrow(
    'External private key provider returned a key for the wrong address.'
  );
  expect(provider).toHaveBeenCalledWith(0, storage, {});
  // expectedAddress is verification-only; it must not leak into the provider contract.
  expect(provider.mock.calls[0][2]).not.toHaveProperty('expectedAddress');
});

test('setExternalPrivateKeyMethod toggles hasPrivateKeyMethod', () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;

  expect(storage.hasPrivateKeyMethod()).toBe(false);
  expect(hWallet.hasExternalPrivateKeyMethod()).toBe(false);
  hWallet.setExternalPrivateKeyMethod(async () => undefined);
  expect(storage.hasPrivateKeyMethod()).toBe(true);
  expect(hWallet.hasExternalPrivateKeyMethod()).toBe(true);
  hWallet.setExternalPrivateKeyMethod(null);
  expect(storage.hasPrivateKeyMethod()).toBe(false);
  expect(hWallet.hasExternalPrivateKeyMethod()).toBe(false);
});

test('oracle signing uses the external provider on a readonly wallet', async () => {
  const { hWallet, storage } = await makeStartedWallet();
  const provider = makeProvider(storage);
  hWallet.setExternalPrivateKeyMethod(provider);
  jest.spyOn(storage, 'isReadonly').mockResolvedValue(true);

  const network = new Network('testnet');
  const oracleAddress = await hWallet.getAddressAtIndex(0);
  const oracleData = getOracleBuffer(oracleAddress, network);
  hWallet.isAddressMine = jest.fn().mockReturnValue(true);
  hWallet.getAddressIndex = jest.fn().mockResolvedValue(0);

  // Must NOT throw WalletFromXPubGuard, and must produce oracle input data via the provider.
  const inputData = await unsafeGetOracleInputData(oracleData, Buffer.from('result-data'), hWallet);

  expect(provider).toHaveBeenCalled();
  expect(Buffer.isBuffer(inputData)).toBe(true);
  expect(inputData.length).toBeGreaterThan(0);
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
  // start() queues the 'shielded-capability' event.
  hWallet.shieldedCapabilityEmitted = null;
  hWallet.shieldedCapabilityCheckQueued = false;
  hWallet.shieldedCapabilityChecks = Promise.resolve();
  hWallet.emit = jest.fn();

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

  test('prepareCreateNewToken does not require a pin with an external tx-signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    // Register an external signer (mirrors a passkey wallet), which makes the pin optional.
    hWallet.setExternalTxSigningMethod(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));

    // No pinCode passed: without the external signer this throws 'Pin is required.'; with it,
    // the build proceeds (signing is delegated to the external method).
    const txData = await hWallet.prepareCreateNewToken('01', 'my01', 100n, {
      address: fakeAddress.base58,
      signTx: false,
    });

    expect(txData.inputs).toHaveLength(1);
  });

  test('prepareCreateNewToken still requires a pin without an external signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });

    await expect(
      hWallet.prepareCreateNewToken('01', 'my01', 100n, {
        address: fakeAddress.base58,
        signTx: false,
      })
    ).rejects.toThrow('Pin is required.');
  });

  test('createNanoContractCreateTokenTransaction does not require a pin with an external tx-signing method', async () => {
    const hWallet = new FakeHathorWallet();
    // Real passkey scenario: xpub-only (readOnly) storage — no private key to decrypt.
    hWallet.storage = getStorage({
      readOnly: true,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    // Register an external signer (mirrors a passkey wallet): this flips isSignedExternally, so the
    // wallet-level isReadonly() returns false and the pin becomes optional.
    hWallet.setExternalTxSigningMethod(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));

    // The method must get PAST both guards: the xpub guard (honored by the external signer) AND the
    // "Pin is required." guard. It fails later resolving the non-existent nano contract, but with
    // neither guard error. This pins both fixes: using storage.isReadonly() here would reject with
    // WalletFromXPubGuard, and reverting the condition to `if (!pin)` would reject with
    // 'Pin is required.'.
    const err = await hWallet
      .createNanoContractCreateTokenTransaction(
        'noop',
        fakeAddress.base58,
        { ncId: 'a'.repeat(64), args: [], actions: [] },
        { name: '01', symbol: 'my01', amount: 100n, mintAddress: fakeAddress.base58 },
        { signTx: false }
      )
      .catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(WalletFromXPubGuard);
    expect(err.message).not.toContain('Pin is required');
  });

  test('createNanoContractCreateTokenTransaction still requires a pin without an external signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });

    await expect(
      hWallet.createNanoContractCreateTokenTransaction(
        'noop',
        fakeAddress.base58,
        { ncId: 'a'.repeat(64), args: [], actions: [] },
        { name: '01', symbol: 'my01', amount: 100n, mintAddress: fakeAddress.base58 },
        { signTx: false }
      )
    ).rejects.toThrow('Pin is required.');
  });

  test('prepareMintTokensData does not require a pin with an external tx-signing method', async () => {
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
    const hWallet = new FakeHathorWallet();
    // Real passkey scenario: xpub-only (readOnly) storage + external signer.
    hWallet.storage = getStorage({
      readOnly: true,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    const externalSigner = jest.fn(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));
    hWallet.setExternalTxSigningMethod(externalSigner);
    jest.spyOn(hWallet, 'getMintAuthority').mockReturnValue(fakeMintAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    // No pinCode, and signTx left at its default of true: the external signer makes the pin
    // optional and isReadonly() honors it, so the build proceeds AND signs. Reverting the guard
    // to `if (!pin)` would reject with 'Pin is required.'.
    const txData = await hWallet.prepareMintTokensData('01', 100n, {
      address: fakeAddress.base58,
    });
    expect(txData.inputs.length).toBeGreaterThan(0);

    // The relaxation is only worth anything if signing actually reaches the external method.
    expect(externalSigner).toHaveBeenCalledTimes(1);
    // ...and it must receive '' rather than the null pin: `prepareTransaction` is typed for a
    // string, so a bare `pin` here would hand the signer a null.
    expect(externalSigner.mock.calls[0][2]).toBe('');
  });

  test('prepareMintTokensData still requires a pin without an external signing method', async () => {
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
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    jest.spyOn(hWallet, 'getMintAuthority').mockReturnValue(fakeMintAuthority);
    jest.spyOn(hWallet.storage, 'getToken').mockImplementation(mockGetToken);

    await expect(
      hWallet.prepareMintTokensData('01', 100n, { address: fakeAddress.base58, signTx: false })
    ).rejects.toThrow('Pin is required.');
  });

  test('createNanoContractTransaction does not require a pin with an external tx-signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: true,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    hWallet.setExternalTxSigningMethod(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));

    // Must clear BOTH the xpub guard (was storage.isReadonly() → now this.isReadonly()) and the
    // pin guard. Default signTx:true, so the pin guard — which is conditional on signTx !== false
    // — is exercised. The build then gets as far as validating the caller address, which this
    // minimal mock storage does not own; pinning that exact failure is what keeps the test
    // honest, since asserting merely "some error that isn't the two guard errors" would pass on
    // any unrelated breakage. Signing itself is exercised end to end by the nano case in the
    // external-signer integration tests.
    const err = await hWallet
      .createNanoContractTransaction('noop', fakeAddress.base58, {
        ncId: 'a'.repeat(64),
        args: [],
        actions: [],
      })
      .catch(e => e);
    expect(err).toBeInstanceOf(NanoContractTransactionError);
    expect(err.message).toContain('does not belong to the wallet');
  });

  test('createNanoContractTransaction still requires a pin without an external signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });

    // Default signTx:true → the pin guard fires without a pin and without an external signer.
    await expect(
      hWallet.createNanoContractTransaction('noop', fakeAddress.base58, {
        ncId: 'a'.repeat(64),
        args: [],
        actions: [],
      })
    ).rejects.toThrow('Pin is required.');
  });

  test('createOnChainBlueprintTransaction does not require a pin with an external tx-signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: true,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    hWallet.setExternalTxSigningMethod(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));

    // Must clear the xpub guard (was storage.isReadonly() → now this.isReadonly()) and the pin
    // guard. As with the nano test above, the build then reaches caller-address validation, which
    // this minimal mock storage fails; pin that exact failure rather than accepting any error, so
    // an unrelated breakage cannot masquerade as the guards being cleared.
    const err = await hWallet
      .createOnChainBlueprintTransaction('0123abcd', fakeAddress.base58)
      .catch(e => e);
    expect(err).toBeInstanceOf(NanoContractTransactionError);
    expect(err.message).toContain('does not belong to the wallet');
  });

  test('createOnChainBlueprintTransaction still requires a pin without an external signing method', async () => {
    const hWallet = new FakeHathorWallet();
    // Not readonly, so the xpub guard passes and the pin guard is what fires.
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });

    await expect(
      hWallet.createOnChainBlueprintTransaction('0123abcd', fakeAddress.base58)
    ).rejects.toThrow('Pin is required.');
  });

  test('getSignatures does not require a pin with an external tx-signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: true,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    const externalSigner = jest.fn(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));
    hWallet.setExternalTxSigningMethod(externalSigner);

    // Public API returning signature material, so the external-signer path is
    // worth pinning: it must reach the signer, and hand it '' rather than a null.
    const tx = new Transaction([], []);
    await expect(hWallet.getSignatures(tx)).resolves.toEqual([]);
    expect(externalSigner).toHaveBeenCalledTimes(1);
    expect(externalSigner.mock.calls[0][2]).toBe('');
  });

  test('getSignatures still requires a pin without an external signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });

    await expect(hWallet.getSignatures(new Transaction([], []))).rejects.toThrow(
      'Pin is required.'
    );
  });

  test('buildTxTemplate does not require a pin with an external tx-signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: true,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    hWallet.setExternalTxSigningMethod(async () => ({
      inputSignatures: [],
      ncCallerSignature: null,
    }));

    const builtTx = new Transaction([], []);
    hWallet.txTemplateInterpreter = { build: jest.fn().mockResolvedValue(builtTx) };
    jest.spyOn(builtTx, 'prepareToSend').mockImplementation(() => {});
    jest.spyOn(transactionUtils, 'getWeightConstantsFromStorage').mockReturnValue({});
    const signSpy = jest.spyOn(transactionUtils, 'signTransaction').mockResolvedValue(builtTx);

    // signTx must be requested for the guard to be reached at all.
    await expect(hWallet.buildTxTemplate([], { signTx: true })).resolves.toBe(builtTx);
    // Reaching the signer with '' is the whole point of the relaxation.
    expect(signSpy).toHaveBeenCalledWith(builtTx, hWallet.storage, '');

    signSpy.mockRestore();
  });

  test('buildTxTemplate still requires a pin without an external signing method', async () => {
    const hWallet = new FakeHathorWallet();
    hWallet.storage = getStorage({
      readOnly: false,
      currentAddress: fakeAddress.base58,
      selectUtxos: generateSelectUtxos(fakeTokenToDepositUtxo),
    });
    hWallet.txTemplateInterpreter = { build: jest.fn().mockResolvedValue(new Transaction([], [])) };

    await expect(hWallet.buildTxTemplate([], { signTx: true })).rejects.toThrow('Pin is required.');
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

describe('address loading across a reconnect', () => {
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  // The shielded chain only needs a provider to be registered; an empty history decodes nothing.
  const provider = { id: 'mock' } as unknown as IShieldedCryptoProvider;

  function makeConn() {
    return {
      getState: jest.fn().mockReturnValue(ConnectionState.CLOSED),
      getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
      getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
      startControlHandlers: jest.fn(),
      removeMetricsHandlers: jest.fn(),
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      onReload: jest.fn().mockResolvedValue(undefined),
      subscribeAddresses: jest.fn(),
      unsubscribeAddress: jest.fn(),
      emit: jest.fn(),
    };
  }

  it('a reconnect loads the same addresses without deriving any', async () => {
    jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
      resolve({ network: 'testnet' });
    });
    jest
      .spyOn(walletApi, 'getAddressHistoryForAwait')
      .mockResolvedValue({ data: { success: true, history: [], has_more: false } } as never);
    const conn = makeConn();
    const hWallet = new HathorWallet({
      seed,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: conn as any,
      password: '456',
      pinCode: '123',
      scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 3 },
    });
    hWallet.setShieldedCryptoProvider(provider);
    await hWallet.start();

    // The first sync derives both chains for indexes 0-2.
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    while (!hWallet.isReady()) {
      await new Promise(resolve => {
        setTimeout(resolve, 10);
      });
    }
    const firstSubscriptions = conn.subscribeAddresses.mock.calls.flatMap(call => call[0]);
    expect(firstSubscriptions).toHaveLength(6);

    conn.subscribeAddresses.mockClear();
    const legacySpy = jest.spyOn(addressUtils, 'deriveAddressP2PKH');
    const pairSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

    // A reconnect wipes the stored addresses and loads the same window again.
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);

    expect(legacySpy).not.toHaveBeenCalled();
    expect(pairSpy).not.toHaveBeenCalled();
    expect(conn.subscribeAddresses.mock.calls.flatMap(call => call[0])).toEqual(firstSubscriptions);
    await hWallet.stop();
  }, 60000);
});

describe('history rewrites on newTxPromise', () => {
  // The change-level xpub of the 'upon tennis …' test seed, and its index-0 address on testnet.
  const XPUB =
    'xpub6EvdxHF4vBs38uFrs6UuN8Zu78LDoqLrskMffXk531wy7xMFb7X9Ntxb9dGL2kbYdKJ1d83dqAifQS2Wzcq2DxJf7HPDPvMZMtNQxyBzAWn';
  const ADDRESS_0 = 'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN';
  // An address of another wallet.
  const FOREIGN_ADDRESS = 'WPhehTyNHTPz954CskfuSgLEfuKXbXeK3f';
  const TX_A = 'aa'.repeat(32);
  const TX_B = 'bb'.repeat(32);
  const TX_C = 'cc'.repeat(32);

  function makeConn() {
    return {
      getState: jest.fn().mockReturnValue(ConnectionState.CLOSED),
      getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
      getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
      startControlHandlers: jest.fn(),
      removeMetricsHandlers: jest.fn(),
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      onReload: jest.fn().mockResolvedValue(undefined),
      subscribeAddresses: jest.fn(),
      unsubscribeAddress: jest.fn(),
      emit: jest.fn(),
    };
  }

  function makeWallet(conn: ReturnType<typeof makeConn>): HathorWallet {
    jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
      resolve({ network: 'testnet' });
    });
    return new HathorWallet({
      xpub: XPUB,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: conn as any,
      scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
    });
  }

  /** A promise the test resolves when it wants a stubbed step to finish. */
  function gate() {
    let open: () => void = () => {};
    const opened = new Promise<void>(resolve => {
      open = resolve;
    });
    return { opened, open };
  }

  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 500; i++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => {
        setTimeout(resolve, 2);
      });
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function settle(): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, 20);
    });
  }

  function txPaying(txId: string, address: string) {
    return {
      tx_id: txId,
      version: 1,
      weight: 1,
      timestamp: 1700000000,
      is_voided: false,
      nonce: 0,
      inputs: [],
      outputs: [
        {
          value: 100n,
          token_data: 0,
          token: NATIVE_TOKEN_UID,
          script: '',
          spent_by: null,
          decoded: { type: 'P2PKH', address, timelock: null },
        },
      ],
      parents: [],
      tokens: [],
    };
  }

  function message(tx: ReturnType<typeof txPaying>): WalletWebSocketData {
    return { type: 'wallet:address_history', history: tx as unknown as IHistoryTx };
  }

  it('isReady() stays true while a realtime tx is processed', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    const processing = gate();
    let readyWhileProcessing: boolean | null = null;
    jest.spyOn(hWallet.storage, 'processNewTx').mockImplementation(async () => {
      readyWhileProcessing = hWallet.isReady();
      await processing.opened;
    });
    hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
    await until(() => readyWhileProcessing !== null, 'processNewTx');
    processing.open();
    await hWallet.newTxPromise;

    expect(readyWhileProcessing).toBe(true);
    expect(hWallet.isReady()).toBe(true);
    await hWallet.stop();
  });

  it('a ws message that arrives while another tx is processed is processed without a reconnect', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    const processingA = gate();
    const processed: string[] = [];
    const processNewTxSpy = jest
      .spyOn(hWallet.storage, 'processNewTx')
      .mockImplementation(async tx => {
        if (tx.tx_id === TX_A) {
          await processingA.opened;
        }
        processed.push(tx.tx_id);
      });
    hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
    await until(() => processNewTxSpy.mock.calls.length === 1, 'tx A');
    hWallet.handleWebsocketMsg(message(txPaying(TX_B, FOREIGN_ADDRESS)));
    processingA.open();

    await until(() => processed.length === 2, 'tx B');
    expect(processed).toEqual([TX_A, TX_B]);
    expect(hWallet.wsTxQueue.size()).toBe(0);
    expect((await hWallet.storage.getTx(TX_B))?.processingStatus).toBe(
      TxHistoryProcessingStatus.FINISHED
    );
    await hWallet.stop();
  });

  describe('a voided-flag change, which processes the whole history again', () => {
    /**
     * A READY wallet that already processed tx A, with processNewTx recording
     * the txs it gets and processHistory held at a gate the test opens.
     */
    async function walletAboutToReprocess() {
      const hWallet = makeWallet(makeConn());
      jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
      await hWallet.start();
      await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
      await until(() => hWallet.isReady(), 'the first walk');

      const processed: string[] = [];
      jest.spyOn(hWallet.storage, 'processNewTx').mockImplementation(async tx => {
        processed.push(tx.tx_id);
      });
      hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
      await until(() => processed.length === 1, 'tx A');
      await hWallet.newTxPromise;

      const reprocess = gate();
      let duringReprocess: { ready: boolean; state: unknown } | null = null;
      let rebuildFails = false;
      const processHistorySpy = jest
        .spyOn(hWallet.storage, 'processHistory')
        .mockImplementation(async () => {
          duringReprocess = { ready: hWallet.isReady(), state: hWallet.state };
          await reprocess.opened;
          if (rebuildFails) {
            throw new Error('the rebuild failed');
          }
        });
      const voidTxA = () =>
        hWallet.handleWebsocketMsg(
          message({ ...txPaying(TX_A, FOREIGN_ADDRESS), is_voided: true })
        );
      return {
        hWallet,
        processed,
        reprocess,
        processHistorySpy,
        voidTxA,
        during: () => duringReprocess,
        failTheRebuild: () => {
          rebuildFails = true;
        },
      };
    }

    it('reports PROCESSING while it runs, then READY', async () => {
      const { hWallet, reprocess, processHistorySpy, voidTxA, during } =
        await walletAboutToReprocess();
      const states: unknown[] = [];
      hWallet.on('state', state => states.push(state));

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      reprocess.open();
      await hWallet.newTxPromise;

      expect(during()).toEqual({ ready: false, state: HathorWallet.PROCESSING });
      expect(states).toEqual([HathorWallet.PROCESSING, HathorWallet.READY]);
      // No walk was started on top of it.
      expect(processHistorySpy).toHaveBeenCalledTimes(1);
      expect(hWallet.isReady()).toBe(true);
      await hWallet.stop();
    });

    it('processes a message that arrives meanwhile right after it, without a reconnect', async () => {
      const { hWallet, processed, reprocess, voidTxA, during } = await walletAboutToReprocess();

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      hWallet.handleWebsocketMsg(message(txPaying(TX_B, FOREIGN_ADDRESS)));
      reprocess.open();

      await until(() => processed.includes(TX_B), 'tx B');
      await hWallet.newTxPromise;
      expect(processed).toEqual([TX_A, TX_B]);
      expect(hWallet.wsTxQueue.size()).toBe(0);
      expect(hWallet.isReady()).toBe(true);
      expect((await hWallet.storage.getTx(TX_B))?.processingStatus).toBe(
        TxHistoryProcessingStatus.FINISHED
      );
      await hWallet.stop();
    });

    it('leaves the state to a stop() that comes meanwhile', async () => {
      const { hWallet, reprocess, voidTxA, during } = await walletAboutToReprocess();

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      const stopping = hWallet.stop();
      reprocess.open();
      await stopping;
      await hWallet.newTxPromise;

      expect(hWallet.state).toBe(HathorWallet.CLOSED);
    });

    it('leaves the state to a reconnect that comes meanwhile', async () => {
      const { hWallet, reprocess, voidTxA, during } = await walletAboutToReprocess();

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      const reload = gate();
      jest.spyOn(hWallet, 'reloadStorage').mockImplementation(() => reload.opened);
      const reconnecting = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
      expect(hWallet.state).toBe(HathorWallet.SYNCING);
      reprocess.open();
      await hWallet.newTxPromise;

      // The reconnect owns the state: the reprocess did not put READY over it.
      expect(hWallet.state).toBe(HathorWallet.SYNCING);
      reload.open();
      await reconnecting;
      await until(() => hWallet.isReady(), 'the walk of the reconnect');
      await hWallet.stop();
    });

    it('leaves the state, and the parked messages, to a disconnect that comes meanwhile', async () => {
      const { hWallet, processed, reprocess, voidTxA, during } = await walletAboutToReprocess();

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      await hWallet.onConnectionChangedState(ConnectionState.CONNECTING);
      hWallet.handleWebsocketMsg(message(txPaying(TX_B, FOREIGN_ADDRESS)));
      reprocess.open();
      await hWallet.newTxPromise;

      expect(hWallet.state).toBe(HathorWallet.CONNECTING);
      // The next connection's walk processes it.
      expect(hWallet.wsTxQueue.size()).toBe(1);
      expect(processed).toEqual([TX_A]);
      await hWallet.stop();
    });

    it('reports ERROR when the rebuild fails, and leaves the parked messages to the next walk', async () => {
      const { hWallet, processed, reprocess, voidTxA, during, failTheRebuild } =
        await walletAboutToReprocess();

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      hWallet.handleWebsocketMsg(message(txPaying(TX_B, FOREIGN_ADDRESS)));
      failTheRebuild();
      reprocess.open();
      await hWallet.newTxPromise;

      expect(hWallet.state).toBe(HathorWallet.ERROR);
      expect(hWallet.isReady()).toBe(false);
      expect(hWallet.wsTxQueue.size()).toBe(1);
      expect(processed).toEqual([TX_A]);
      await hWallet.stop();
    });

    it('runs the walk that a reprocess asks for meanwhile, after it', async () => {
      const { hWallet, reprocess, processHistorySpy, voidTxA, during } =
        await walletAboutToReprocess();

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      const reprocessed = hWallet.reprocessShieldedOutputs();
      reprocess.open();
      await reprocessed;

      // The voided reprocess, then the walk the request asked for.
      expect(processHistorySpy).toHaveBeenCalledTimes(2);
      expect(hWallet.isReady()).toBe(true);
      expect(hWallet.walkPending).toBe(false);
      await hWallet.stop();
    });

    it('rebuilds and returns to READY when a state listener throws', async () => {
      const { hWallet, reprocess, processHistorySpy, voidTxA, during } =
        await walletAboutToReprocess();
      hWallet.on('state', state => {
        if (state === HathorWallet.PROCESSING) {
          throw new Error('a listener failed');
        }
      });

      voidTxA();
      await until(() => during() !== null, 'the reprocess');
      reprocess.open();
      await hWallet.newTxPromise;

      expect(processHistorySpy).toHaveBeenCalledTimes(1);
      expect(hWallet.isReady()).toBe(true);
      await hWallet.stop();
    });
  });

  it('every message parked during a sync and its walk is processed once, before READY', async () => {
    const hWallet = makeWallet(makeConn());
    const sync = gate();
    jest.spyOn(hWallet, 'syncHistory').mockImplementation(() => sync.opened);
    const walk = gate();
    const processHistorySpy = jest
      .spyOn(hWallet.storage, 'processHistory')
      .mockImplementationOnce(() => walk.opened);
    const processed: string[] = [];
    jest.spyOn(hWallet.storage, 'processNewTx').mockImplementation(async tx => {
      processed.push(tx.tx_id);
    });
    let atReady: { parked: number; processed: string[] } | null = null;
    hWallet.on('state', state => {
      if (state === HathorWallet.READY) {
        atReady = { parked: hWallet.wsTxQueue.size(), processed: [...processed] };
      }
    });
    await hWallet.start();

    const connected = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    // Parked while the first sync runs, and replayed by the walk.
    hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
    sync.open();
    await connected;
    await until(
      () => processHistorySpy.mock.calls.length === 1,
      'the walk to reach processHistory'
    );
    // Parked while the walk's processHistory runs.
    hWallet.handleWebsocketMsg(message(txPaying(TX_B, FOREIGN_ADDRESS)));
    expect(hWallet.wsTxQueue.size()).toBe(1);
    walk.open();

    await until(() => hWallet.isReady(), 'READY');
    expect(atReady).toEqual({ parked: 0, processed: [TX_A, TX_B] });
    await settle();
    expect(processed).toEqual([TX_A, TX_B]);
    await hWallet.stop();
  });

  it('a sender-local insert during a walk runs after it', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    const walk = gate();
    const order: string[] = [];
    const processHistorySpy = jest
      .spyOn(hWallet.storage, 'processHistory')
      .mockImplementationOnce(async () => {
        await walk.opened;
        order.push('walk');
      });
    jest.spyOn(hWallet.storage, 'processNewTx').mockImplementation(async tx => {
      order.push(`insert ${tx.tx_id}`);
    });
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(
      () => processHistorySpy.mock.calls.length === 1,
      'the walk to reach processHistory'
    );

    // What SendTransaction does after a successful push: it bypasses the READY gate.
    hWallet.enqueueOnNewTx(message(txPaying(TX_C, FOREIGN_ADDRESS)), '123');
    await settle();
    expect(order).toEqual([]);
    walk.open();

    await until(() => order.length === 2, 'the insert');
    expect(order).toEqual(['walk', `insert ${TX_C}`]);
    await hWallet.stop();
  });

  it('reloadStorage waits for an onNewTx in progress', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    const processing = gate();
    const order: string[] = [];
    const processNewTxSpy = jest
      .spyOn(hWallet.storage, 'processNewTx')
      .mockImplementation(async tx => {
        await processing.opened;
        order.push(`processNewTx ${tx.tx_id}`);
      });
    jest.spyOn(hWallet.storage, 'cleanStorage').mockImplementation(async () => {
      order.push('cleanStorage');
    });
    hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
    await until(() => processNewTxSpy.mock.calls.length === 1, 'tx A');

    const reload = hWallet.reloadStorage();
    await settle();
    expect(order).toEqual([]);
    processing.open();
    await reload;

    expect(order).toEqual([`processNewTx ${TX_A}`, 'cleanStorage']);
    await hWallet.stop();
  });

  it('a reconnect during a walk ends READY once, with the balance and cursors of the reloaded history', async () => {
    jest.spyOn(walletApi, 'getAddressHistoryForAwait').mockImplementation(
      async (addresses: string[]) =>
        ({
          data: {
            success: true,
            history: addresses.includes(ADDRESS_0) ? [txPaying(TX_A, ADDRESS_0)] : [],
            has_more: false,
          },
        }) as never
    );
    const hWallet = makeWallet(makeConn());
    const states: unknown[] = [];
    hWallet.on('state', state => {
      states.push(state);
    });
    const firstWalk = gate();
    const realProcessHistory = hWallet.storage.processHistory.bind(hWallet.storage);
    const processHistorySpy = jest
      .spyOn(hWallet.storage, 'processHistory')
      .mockImplementationOnce(async pinCode => {
        await firstWalk.opened;
        await realProcessHistory(pinCode);
      });
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => processHistorySpy.mock.calls.length === 1, 'the first walk');

    // The connection drops and comes back while the first walk runs.
    states.length = 0;
    const reconnect = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    firstWalk.open();
    await reconnect;
    await until(() => hWallet.isReady(), 'READY');
    await settle();

    // The overtaken walk did not set READY; the reconnect's walk did, after the reload.
    expect(states).toEqual([HathorWallet.SYNCING, HathorWallet.PROCESSING, HathorWallet.READY]);
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        balance: { locked: 0n, unlocked: 100n },
        transactions: 1,
      }),
    ]);
    expect(await hWallet.storage.getWalletData()).toMatchObject({
      lastLoadedAddressIndex: 2,
      lastUsedAddressIndex: 0,
      currentAddressIndex: 1,
    });
    await hWallet.stop();
  }, 60000);

  it('a reconnect during the first sync reloads after it, and every tx is processed', async () => {
    // Txs on indexes 1 and 3 make the first sync load three windows of two addresses.
    const history = [
      txPaying(TX_A, addressUtils.deriveAddressFromXPubP2PKH(XPUB, 1, 'testnet').base58),
      txPaying(TX_B, addressUtils.deriveAddressFromXPubP2PKH(XPUB, 3, 'testnet').base58),
      txPaying(TX_C, ADDRESS_0),
    ];
    const hWallet = makeWallet(makeConn());
    let reconnect: Promise<void> | null = null;
    let requests = 0;
    jest
      .spyOn(walletApi, 'getAddressHistoryForAwait')
      .mockImplementation(async (addresses: string[]) => {
        requests += 1;
        if (requests === 1) {
          // The connection drops and comes back while the first request of the
          // first sync is on the wire, and tx C arrives while the wallet reloads.
          setTimeout(() => {
            reconnect = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
            hWallet.handleWebsocketMsg(message(txPaying(TX_C, ADDRESS_0)));
          }, 1);
        }
        await new Promise(resolve => {
          setTimeout(resolve, 30);
        });
        return {
          data: {
            success: true,
            history: history.filter(tx => addresses.includes(tx.outputs[0].decoded.address)),
            has_more: false,
          },
        } as never;
      });
    await hWallet.start();

    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => reconnect !== null, 'the reconnect');
    await reconnect;
    await until(() => hWallet.isReady(), 'READY');
    await hWallet.newTxPromise;

    expect(hWallet.wsTxQueue.size()).toBe(0);
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        balance: { locked: 0n, unlocked: 300n },
        transactions: 3,
      }),
    ]);
    await hWallet.stop();
  }, 60000);

  it('a walk that ends after the connection dropped does not set READY', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    const walk = gate();
    const processHistorySpy = jest
      .spyOn(hWallet.storage, 'processHistory')
      .mockImplementationOnce(() => walk.opened);
    const states: unknown[] = [];
    hWallet.on('state', state => {
      states.push(state);
    });
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(
      () => processHistorySpy.mock.calls.length === 1,
      'the walk to reach processHistory'
    );

    states.length = 0;
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTING);
    walk.open();
    await settle();

    expect(states).toEqual([HathorWallet.CONNECTING]);
    expect(hWallet.state).toBe(HathorWallet.CONNECTING);
    await hWallet.stop();
  });

  it('a connection overtaken by a newer one leaves PROCESSING and READY to the newer one', async () => {
    const hWallet = makeWallet(makeConn());
    const syncSpy = jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    const states: unknown[] = [];
    hWallet.on('state', state => {
      states.push(state);
    });
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    const staleSync = gate();
    syncSpy.mockImplementationOnce(() => staleSync.opened);
    states.length = 0;
    // The first walk's address discovery syncs too, so count from here.
    const syncsBefore = syncSpy.mock.calls.length;
    const second = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => syncSpy.mock.calls.length === syncsBefore + 1, 'the second reload to sync');
    const third = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    staleSync.open();
    await Promise.all([second, third]);
    await until(() => hWallet.isReady(), 'READY');
    await settle();

    expect(states).toEqual([
      HathorWallet.SYNCING,
      HathorWallet.SYNCING,
      HathorWallet.PROCESSING,
      HathorWallet.READY,
    ]);
    await hWallet.stop();
  });

  it('a reload overtaken by a newer connection does not set ERROR when it fails', async () => {
    const hWallet = makeWallet(makeConn());
    const syncSpy = jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    const states: unknown[] = [];
    hWallet.on('state', state => {
      states.push(state);
    });
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    // The newer connection's reload aborts the stream the older reload was waiting on.
    const staleSync = gate();
    syncSpy.mockImplementationOnce(async () => {
      await staleSync.opened;
      throw new Error('Stream aborted');
    });
    states.length = 0;
    // The first walk's address discovery syncs too, so count from here.
    const syncsBefore = syncSpy.mock.calls.length;
    const second = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => syncSpy.mock.calls.length === syncsBefore + 1, 'the second reload to sync');
    const third = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    staleSync.open();
    await Promise.all([second, third]);
    await until(() => hWallet.isReady(), 'READY');
    await settle();

    expect(states).toEqual([
      HathorWallet.SYNCING,
      HathorWallet.SYNCING,
      HathorWallet.PROCESSING,
      HathorWallet.READY,
    ]);
    await hWallet.stop();
  });

  it('a reconnect while a queued tx waits on a stream of the dropped connection does not deadlock', async () => {
    const conn = makeConn();
    const hWallet = makeWallet(conn);
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    // A history stream on a dropped connection ends only when the reconnect
    // aborts it, through conn.onReload(). The tx being processed holds one.
    const streamAborted = gate();
    conn.onReload.mockImplementation(async () => {
      streamAborted.open();
    });
    const scanSpy = jest.spyOn(hWallet, 'scanAddressesToLoad').mockImplementationOnce(async () => {
      await streamAborted.opened;
      throw new Error('Stream aborted');
    });
    hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
    await until(() => scanSpy.mock.calls.length === 1, 'tx A to wait on the stream');

    const reconnect = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'READY after the reconnect');
    await expect(reconnect).resolves.toBeUndefined();
    expect(conn.onReload).toHaveBeenCalledTimes(1);
    await hWallet.stop();
  });

  it("a reload requested from a 'new-tx' listener runs after the tx that emitted the event", async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => hWallet.isReady(), 'the first walk');

    const cleanSpy = jest.spyOn(hWallet.storage, 'cleanStorage');
    let reload: Promise<void> | null = null;
    hWallet.on('new-tx', () => {
      reload = hWallet.reloadStorage();
    });
    hWallet.handleWebsocketMsg(message(txPaying(TX_A, FOREIGN_ADDRESS)));
    await until(() => reload !== null, "the 'new-tx' event");
    await reload;

    expect(cleanSpy).toHaveBeenCalledTimes(1);
    await hWallet.stop();
  });

  it('a sync of a stopped session does not start a walk after the wallet starts again', async () => {
    const hWallet = makeWallet(makeConn());
    const staleSync = gate();
    const syncSpy = jest
      .spyOn(hWallet, 'syncHistory')
      .mockImplementationOnce(() => staleSync.opened)
      .mockResolvedValue(undefined);
    await hWallet.start();
    const firstSession = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => syncSpy.mock.calls.length === 1, 'the first sync');

    await hWallet.stop();
    await hWallet.start();
    const states: unknown[] = [];
    hWallet.on('state', state => {
      states.push(state);
    });
    staleSync.open();
    await firstSession;
    await settle();

    expect(states).toEqual([]);
    expect(hWallet.state).toBe(HathorWallet.CONNECTING);
    await hWallet.stop();
  });

  it('a reload queued behind a walk is skipped when a newer connection queued its own', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    const walk = gate();
    const processHistorySpy = jest
      .spyOn(hWallet.storage, 'processHistory')
      .mockImplementationOnce(() => walk.opened);
    const cleanSpy = jest.spyOn(hWallet.storage, 'cleanStorage');
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(
      () => processHistorySpy.mock.calls.length === 1,
      'the walk to reach processHistory'
    );

    // Two reconnects while the walk runs: both reloads queue behind it.
    const second = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    const third = hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    walk.open();
    await Promise.all([second, third]);
    await until(() => hWallet.isReady(), 'READY');

    expect(cleanSpy).toHaveBeenCalledTimes(1);
    await hWallet.stop();
  });

  it('a walk that ends after stop() leaves the wallet CLOSED', async () => {
    const hWallet = makeWallet(makeConn());
    jest.spyOn(hWallet, 'syncHistory').mockResolvedValue(undefined);
    const walk = gate();
    const processHistorySpy = jest
      .spyOn(hWallet.storage, 'processHistory')
      .mockImplementationOnce(() => walk.opened);
    await hWallet.start();
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(
      () => processHistorySpy.mock.calls.length === 1,
      'the walk to reach processHistory'
    );

    await hWallet.stop();
    walk.open();
    await settle();

    expect(hWallet.state).toBe(HathorWallet.CLOSED);
  });
});

describe('start() with a record that predates shielded support', () => {
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  function withoutShieldedKeys(accessData: IWalletAccessData): IWalletAccessData {
    const {
      scanXpubkey: _scanXpubkey,
      scanMainKey: _scanMainKey,
      spendXpubkey: _spendXpubkey,
      spendMainKey: _spendMainKey,
      ...preShielded
    } = accessData;
    return preShielded;
  }

  it.each([
    {
      failure: 'a migration from another passphrase',
      cause: 'passphrase-mismatch',
      // A wallet started from its root xpriv runs the migration with an empty
      // passphrase, whatever passphrase its words were created with.
      setup: () => {
        const root = walletUtils.getXPrivKeyFromSeed(seed, {
          passphrase: 'my-bip39-passphrase',
          networkName: 'testnet',
        });
        return {
          secret: { xpriv: root.xprivkey },
          accessData: walletUtils.generateAccessDataFromXpriv(root.xprivkey, {
            pin: '123',
            seed,
            password: '456',
          }),
        };
      },
      pinCode: '123',
      password: '456',
    },
    {
      failure: 'a wrong password',
      cause: 'wrong-password',
      setup: () => ({
        secret: { seed },
        accessData: walletUtils.generateAccessDataFromSeed(seed, {
          pin: '123',
          password: '456',
          networkName: 'testnet',
        }),
      }),
      pinCode: '123',
      password: 'not-the-password',
    },
    {
      failure: 'a wrong PIN',
      cause: 'wrong-pin',
      setup: () => ({
        secret: { seed },
        accessData: walletUtils.generateAccessDataFromSeed(seed, {
          pin: '123',
          password: '456',
          networkName: 'testnet',
        }),
      }),
      pinCode: '999',
      password: '456',
    },
  ])(
    'starts without shielded keys after $failure, and keeps the stored record',
    async ({ cause, setup, pinCode, password }) => {
      const { secret, accessData } = setup();
      const preShielded = withoutShieldedKeys(accessData);
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(preShielded);
      const before = JSON.parse(JSON.stringify(preShielded));
      jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
        resolve({ network: 'testnet' });
      });
      const conn = {
        network: 'testnet',
        getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
        on: jest.fn(),
        start: jest.fn(),
        getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
      };
      const hWallet = new FakeHathorWallet();
      Object.assign(hWallet, secret);
      hWallet.storage = storage;
      hWallet.passphrase = '';
      hWallet.conn = conn;
      hWallet.getTokenData = jest.fn();
      hWallet.setState = jest.fn();
      hWallet.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      // start() queues the 'shielded-capability' event.
      hWallet.shieldedCapabilityEmitted = null;
      hWallet.shieldedCapabilityCheckQueued = false;
      hWallet.shieldedCapabilityChecks = Promise.resolve();
      hWallet.emit = jest.fn();

      await expect(hWallet.start({ pinCode, password })).resolves.toEqual({ network: 'testnet' });

      expect(JSON.parse(JSON.stringify(await storage.getAccessData()))).toEqual(before);
      expect(conn.start).toHaveBeenCalled();
      const shielded = shieldedOf(storage);
      expect(shielded.active).toBe(true);
      expect(shielded.hasKey).toBe(false);
      expect(shielded.cause).toBe(cause);
      expect(hWallet.logger.warn).toHaveBeenCalledTimes(1);
      expect(hWallet.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`shielded-${cause}`)
      );
      await expect(hWallet.getShieldedCapability()).resolves.toMatchObject({
        level: 'none',
        reason: 'needs-password',
        cause,
      });
      await hWallet.shieldedCapabilityChecks;
      expect(hWallet.emit).toHaveBeenCalledTimes(1);
      expect(hWallet.emit).toHaveBeenCalledWith(
        'shielded-capability',
        expect.objectContaining({ level: 'none', reason: 'needs-password', cause })
      );
    },
    30000
  );
});

describe('the shielded view key from start() to stop()', () => {
  const SEED =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const PIN = '123';
  const PASSWORD = '456';
  const TX_SYNCED = 'e1'.repeat(32);
  const TX_PARKED = 'e2'.repeat(32);
  const TX_REALTIME = 'e3'.repeat(32);
  const TX_CHANGE = 'e4'.repeat(32);
  // The outputs the provider opens: each one, paid to the wallet's shielded
  // address at `addressIndex`, opens with that address's scan key only.
  const OPENINGS: Record<string, { addressIndex: number; value: bigint }> = {
    ['0a'.repeat(33)]: { addressIndex: 0, value: 50n },
    ['0b'.repeat(33)]: { addressIndex: 1, value: 30n },
    ['0c'.repeat(33)]: { addressIndex: 0, value: 20n },
    ['0d'.repeat(33)]: { addressIndex: 1, value: 5n },
    ['0e'.repeat(33)]: { addressIndex: 3, value: 7n },
  };
  const [OPENS_50, OPENS_30, OPENS_20, OPENS_5, OPENS_7] = Object.keys(OPENINGS);

  let fixture: {
    accessData: string;
    scanXpriv: string;
    childKeys: string[];
    spend: string[];
  } | null = null;
  /**
   * The test seed's record, its scan xpriv, the scan keys of its first four
   * shielded addresses as bitcore derives them, and their spend addresses.
   */
  function walletFixture() {
    if (!fixture) {
      const accessData = walletUtils.generateAccessDataFromSeed(SEED, {
        pin: PIN,
        password: PASSWORD,
        networkName: 'testnet',
      });
      const scanKey = walletUtils
        .getXPrivKeyFromSeed(SEED, { networkName: 'testnet' })
        .deriveChild("m/44'/280'/1'")
        .deriveChild(0);
      const indexes = [0, 1, 2, 3];
      fixture = {
        accessData: JSON.stringify(accessData),
        scanXpriv: scanKey.xprivkey,
        childKeys: indexes.map(i => scanKey.deriveChild(i).privateKey.toBuffer().toString('hex')),
        spend: indexes.map(
          i =>
            addressUtils.deriveShieldedAddressPair(
              accessData.scanXpubkey!,
              accessData.spendXpubkey!,
              i,
              'testnet'
            ).spendAddress.base58
        ),
      };
    }
    return fixture;
  }

  function makeCryptoProvider(): IShieldedCryptoProvider {
    const { childKeys } = walletFixture();
    return {
      generateRandomBlindingFactor: jest.fn(),
      createAmountShieldedOutput: jest.fn(),
      createShieldedOutputWithBothBlindings: jest.fn(),
      rewindAmountShieldedOutput: jest
        .fn()
        .mockImplementation(async (privkey: Buffer, _ephemeral: Buffer, commitment: Buffer) => {
          const opening = OPENINGS[commitment.toString('hex')];
          if (!opening || privkey.toString('hex') !== childKeys[opening.addressIndex]) {
            throw new Error('rewind failed');
          }
          return { value: opening.value, blindingFactor: Buffer.alloc(32, 0x0b) };
        }),
      rewindFullShieldedOutput: jest.fn(),
      computeBalancingBlindingFactor: jest.fn(),
      deriveTag: jest.fn(),
      createAssetCommitment: jest.fn(),
      createSurjectionProof: jest.fn(),
      deriveEcdhSharedSecret: jest.fn(),
    } as unknown as IShieldedCryptoProvider;
  }

  /** A tx paying one shielded output, which opens with `commitment`'s key, to a spend address. */
  function shieldedTx(txId: string, commitment: string) {
    const { spend } = walletFixture();
    return {
      tx_id: txId,
      version: 1,
      weight: 1,
      timestamp: 1700000000,
      is_voided: false,
      nonce: 0,
      inputs: [],
      outputs: [],
      shielded_outputs: [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED,
          commitment,
          range_proof: 'bb'.repeat(10),
          script: '',
          token_data: 0,
          ephemeral_pubkey: '02'.repeat(33),
          decoded: {
            type: 'P2PKH',
            address: spend[OPENINGS[commitment].addressIndex],
            timelock: null,
          },
          spent_by: null,
        },
      ],
      parents: [],
      tokens: [],
    };
  }

  function message(tx: ReturnType<typeof shieldedTx>): WalletWebSocketData {
    return { type: 'wallet:address_history', history: tx as unknown as IHistoryTx };
  }

  function makeConn() {
    return {
      getState: jest.fn().mockReturnValue(ConnectionState.CLOSED),
      getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
      getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
      startControlHandlers: jest.fn(),
      removeMetricsHandlers: jest.fn(),
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      onReload: jest.fn().mockResolvedValue(undefined),
      subscribeAddresses: jest.fn(),
      unsubscribeAddress: jest.fn(),
      emit: jest.fn(),
    };
  }

  function makeLogger() {
    return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  }

  /**
   * A wallet of the test seed over a storage that holds its record, with a
   * crypto provider. The fullnode serves `history()` and runs on `network`.
   */
  async function makeWallet({
    constructorPin = null,
    history = () => [] as ReturnType<typeof shieldedTx>[],
    network = 'testnet',
  }: {
    constructorPin?: string | null;
    history?: () => ReturnType<typeof shieldedTx>[];
    network?: string;
  } = {}) {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(JSON.parse(walletFixture().accessData));
    jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
      resolve({ network });
    });
    jest
      .spyOn(walletApi, 'getAddressHistoryForAwait')
      .mockImplementation(async (addresses: string[]) => {
        const txs = history().filter(tx =>
          tx.shielded_outputs.some(output => addresses.includes(output.decoded.address))
        );
        return { data: { success: true, history: txs, has_more: false } } as never;
      });
    const conn = makeConn();
    const logger = makeLogger();
    const wallet = new HathorWallet({
      seed: SEED,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: conn as any,
      storage,
      password: PASSWORD,
      pinCode: constructorPin,
      scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
      logger,
    });
    wallet.setShieldedCryptoProvider(makeCryptoProvider());
    return { wallet, storage, conn, logger, shielded: shieldedOf(storage) };
  }

  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1500; i++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => {
        setTimeout(resolve, 2);
      });
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  /** A promise the test resolves when it wants a stubbed step to finish. */
  function gate() {
    let open: () => void = () => {};
    const opened = new Promise<void>(resolve => {
      open = resolve;
    });
    return { opened, open };
  }

  async function settle(): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, 20);
    });
  }

  /** Hold the next rewind of `storage`'s provider until the returned gate opens. */
  function holdNextRewind(storage: Storage) {
    const rewind = storage.shieldedCryptoProvider!.rewindAmountShieldedOutput as jest.Mock;
    const release = gate();
    const held = { reached: false, open: release.open };
    const opens = rewind.getMockImplementation()!;
    rewind.mockImplementationOnce(async (...args: unknown[]) => {
      held.reached = true;
      await release.opened;
      return opens(...args);
    });
    return held;
  }

  async function sync(wallet: HathorWallet): Promise<void> {
    await wallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => wallet.isReady(), 'READY');
  }

  async function htrBalance(wallet: HathorWallet): Promise<bigint> {
    const [balance] = await wallet.getBalance(NATIVE_TOKEN_UID);
    return balance?.balance.unlocked ?? 0n;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unlocks the view key after clearing the secrets and before CONNECTING', async () => {
    const { wallet, storage, shielded } = await makeWallet();
    const clearSpy = jest.spyOn(wallet, 'clearSensitiveData');
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    const stateSpy = jest.spyOn(wallet, 'setState');

    await wallet.start({ pinCode: PIN, password: PASSWORD });

    expect(shielded.active).toBe(true);
    expect(shielded.hasKey).toBe(true);
    expect(shielded.cause).toBeNull();
    expect(unlockSpy).toHaveBeenCalledTimes(1);
    const connecting = stateSpy.mock.calls.findIndex(
      ([state]) => state === HathorWallet.CONNECTING
    );
    expect(clearSpy.mock.invocationCallOrder[0]).toBeLessThan(
      unlockSpy.mock.invocationCallOrder[0]
    );
    expect(unlockSpy.mock.invocationCallOrder[0]).toBeLessThan(
      stateSpy.mock.invocationCallOrder[connecting]
    );
    await wallet.stop();
  }, 60000);

  it('starts with the view key locked, and says why, when the PIN is wrong', async () => {
    const { wallet, shielded, conn, logger } = await makeWallet();

    await expect(wallet.start({ pinCode: '999', password: PASSWORD })).resolves.toEqual({
      network: 'testnet',
    });

    expect(conn.start).toHaveBeenCalled();
    expect(shielded.active).toBe(true);
    expect(shielded.hasKey).toBe(false);
    expect(shielded.cause).toBe('wrong-pin');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('shielded-wrong-pin'));
    await wallet.stop();
  }, 60000);

  it('reports a record whose scan key and scan xpub disagree as an integrity failure', async () => {
    const { wallet, storage, shielded } = await makeWallet();
    const record = (await storage.getAccessData())!;
    // The scan key of another seed, encrypted under the wallet's PIN.
    const otherScan = walletUtils
      .getXPrivKeyFromSeed(walletUtils.generateWalletWords(), { networkName: 'testnet' })
      .deriveChild("m/44'/280'/1'")
      .deriveChild(0);
    await storage.saveAccessData({
      ...record,
      scanMainKey: encryptData(otherScan.xprivkey, PIN),
    });

    await wallet.start({ pinCode: PIN, password: PASSWORD });

    expect(shielded.hasKey).toBe(false);
    expect(shielded.integrity).toBe('key-mismatch');
    expect(shielded.cause).toBeNull();
    await wallet.stop();
  }, 60000);

  it('reports an unexpected unlock failure as error, with its name only, and starts', async () => {
    const { wallet, storage, shielded, logger } = await makeWallet();
    const failure = new Error('IndexedDB read failed');
    failure.name = 'StoreReadError';
    jest.spyOn(storage, 'getScanXPrivKey').mockRejectedValue(failure);

    await wallet.start({ pinCode: PIN, password: PASSWORD });

    expect(shielded.hasKey).toBe(false);
    expect(shielded.cause).toBe('error');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('StoreReadError'));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('IndexedDB read failed');
    await wallet.stop();
  }, 60000);

  it.each([
    {
      record: 'a seed record started from its xpub, without a PIN',
      accessData: () => JSON.parse(walletFixture().accessData),
    },
    {
      record: 'a read-only record with the shielded xpubs and no encrypted key',
      accessData: () => {
        const full = JSON.parse(walletFixture().accessData);
        return {
          xpubkey: full.xpubkey,
          walletType: full.walletType,
          walletFlags: WALLET_FLAGS.READONLY,
          scanXpubkey: full.scanXpubkey,
          spendXpubkey: full.spendXpubkey,
        };
      },
    },
  ])(
    'starts with the view key locked as not-supplied for $record',
    async ({ accessData }) => {
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(accessData());
      jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
        resolve({ network: 'testnet' });
      });
      const wallet = new HathorWallet({
        xpub: JSON.parse(walletFixture().accessData).xpubkey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: makeConn() as any,
        storage,
        logger: makeLogger(),
      });

      await wallet.start();

      const shielded = shieldedOf(storage);
      expect(shielded.active).toBe(true);
      expect(shielded.hasKey).toBe(false);
      expect(shielded.cause).toBe('not-supplied');
      await wallet.stop();
    },
    60000
  );

  it.each([
    {
      failure: 'the version request fails',
      arrange: (wallet: HathorWallet) => {
        jest
          .spyOn(versionApi, 'getVersion')
          .mockImplementation(() => Promise.reject(new Error('fullnode unreachable')));
        return wallet;
      },
      error: 'fullnode unreachable',
    },
    {
      failure: 'the fullnode runs another network',
      arrange: (wallet: HathorWallet) => {
        jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
          resolve({ network: 'mainnet' });
        });
        return wallet;
      },
      error: 'Wrong network',
    },
    {
      failure: "a 'state' listener throws at CONNECTING",
      arrange: (wallet: HathorWallet) => {
        wallet.on('state', state => {
          if (state === HathorWallet.CONNECTING) {
            throw new Error('listener failed');
          }
        });
        return wallet;
      },
      error: 'listener failed',
    },
  ])(
    'drops the scan key when $failure, and start() rejects',
    async ({ arrange, error }) => {
      const { wallet, shielded } = await makeWallet();
      arrange(wallet);

      await expect(wallet.start({ pinCode: PIN, password: PASSWORD })).rejects.toThrow(error);

      expect(shielded.active).toBe(false);
      expect(shielded.hasKey).toBe(false);
    },
    60000
  );

  it('drops the scan key before stop() runs a listener, even one that throws', async () => {
    const { wallet, shielded } = await makeWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    expect(shielded.hasKey).toBe(true);
    let keyAtClosed: boolean | null = null;
    wallet.on('state', state => {
      if (state === HathorWallet.CLOSED) {
        keyAtClosed = shielded.hasKey;
        throw new Error('listener failed');
      }
    });

    const stopping = wallet.stop();
    // Before stop() awaits anything.
    expect(shielded.hasKey).toBe(false);
    await expect(stopping).rejects.toThrow('listener failed');

    expect(keyAtClosed).toBe(false);
    expect(shielded.active).toBe(false);
  }, 60000);

  it('rejects start() with shielded-not-started, and keeps no key, when stop() runs during the unlock', async () => {
    const { wallet, storage, shielded, conn } = await makeWallet();
    const readKey = storage.getScanXPrivKey.bind(storage);
    const unlocking = gate();
    let reached = false;
    jest.spyOn(storage, 'getScanXPrivKey').mockImplementation(async pin => {
      reached = true;
      await unlocking.opened;
      return readKey(pin);
    });

    const starting = wallet.start({ pinCode: PIN, password: PASSWORD });
    await until(() => reached, 'the unlock');
    const stopping = wallet.stop();
    unlocking.open();

    await expect(starting).rejects.toMatchObject({ errorCode: 'shielded-not-started' });
    await stopping;
    expect(shielded.active).toBe(false);
    expect(shielded.hasKey).toBe(false);
    expect(conn.start).not.toHaveBeenCalled();
  }, 60000);

  /**
   * Another wallet of the test seed on `storage`, with a crypto provider: what
   * an app builds when it replaces its wallet and reuses the storage.
   */
  function walletOn(storage: Storage): HathorWallet {
    const wallet = new HathorWallet({
      seed: SEED,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: makeConn() as any,
      storage,
      password: PASSWORD,
      scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
      logger: makeLogger(),
    });
    wallet.setShieldedCryptoProvider(makeCryptoProvider());
    return wallet;
  }

  it('keeps the scan key of the next wallet on the storage when the previous one finishes stopping after it started', async () => {
    const { wallet: previous, storage, shielded } = await makeWallet();
    await previous.start({ pinCode: PIN, password: PASSWORD });
    await sync(previous);
    // The previous wallet's stop is still unsubscribing its addresses.
    const allAddresses = storage.getAllAddresses.bind(storage);
    const unsubscribing = gate();
    let reached = false;
    jest.spyOn(storage, 'getAllAddresses').mockImplementationOnce(async function* held(opts) {
      reached = true;
      await unsubscribing.opened;
      yield* allAddresses(opts);
    });

    // An app that replaces its wallet stops it without awaiting, and starts the
    // next one on the same storage.
    const stopping = previous.stop({ cleanStorage: false });
    await until(() => reached, 'the stop to unsubscribe the addresses');
    const next = walletOn(storage);
    await next.start({ pinCode: PIN, password: PASSWORD });
    unsubscribing.open();
    await stopping;

    expect(shielded.active).toBe(true);
    expect(shielded.hasKey).toBe(true);
    await next.stop();
  }, 60000);

  it('keeps the scan key of the next wallet when the start() it replaced fails afterwards', async () => {
    const { wallet: first, storage, shielded } = await makeWallet();
    // The first wallet's version request fails only after the app replaced it.
    let failVersion: (error: Error) => void = () => {};
    let asked = false;
    jest.spyOn(versionApi, 'getVersion').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          asked = true;
          failVersion = reject;
        }) as never
    );
    const firstStart = first.start({ pinCode: PIN, password: PASSWORD });
    await until(() => asked, 'the version request');

    await first.stop({ cleanStorage: false });
    const next = walletOn(storage);
    await next.start({ pinCode: PIN, password: PASSWORD });
    failVersion(new Error('server unreachable'));

    await expect(firstStart).rejects.toThrow('server unreachable');
    expect(shielded.active).toBe(true);
    expect(shielded.hasKey).toBe(true);
    await next.stop();
  }, 60000);

  it('keeps the scan key of the next wallet when stop() overtook the unlock of the start() it replaced', async () => {
    const { wallet: first, storage, shielded } = await makeWallet();
    const readKey = storage.getScanXPrivKey.bind(storage);
    const unlocking = gate();
    let reached = false;
    jest.spyOn(storage, 'getScanXPrivKey').mockImplementationOnce(async pin => {
      reached = true;
      await unlocking.opened;
      return readKey(pin);
    });
    const firstStart = first.start({ pinCode: PIN, password: PASSWORD });
    await until(() => reached, 'the unlock');

    await first.stop({ cleanStorage: false });
    const next = walletOn(storage);
    await next.start({ pinCode: PIN, password: PASSWORD });
    unlocking.open();

    await expect(firstStart).rejects.toMatchObject({ errorCode: 'shielded-not-started' });
    expect(shielded.active).toBe(true);
    expect(shielded.hasKey).toBe(true);
    await next.stop();
  }, 60000);

  it('cleans the storage after a realtime tx that stop() caught while it was credited', async () => {
    const { wallet, storage } = await makeWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    await sync(wallet);
    // Hold the save of the decoded shielded UTXO.
    const saveUtxo = storage.store.saveUtxo.bind(storage.store);
    const crediting = gate();
    let reached = false;
    jest.spyOn(storage.store, 'saveUtxo').mockImplementation(async utxo => {
      if (utxo.shielded) {
        reached = true;
        await crediting.opened;
      }
      return saveUtxo(utxo);
    });
    wallet.handleWebsocketMsg(message(shieldedTx(TX_REALTIME, OPENS_20)));
    await until(() => reached, 'the crediting');

    // The default stop cleans the history, the UTXOs and the metadata.
    const stopping = wallet.stop();
    await settle();
    crediting.open();
    await stopping;
    await wallet.newTxPromise;

    expect(await storage.getTx(TX_REALTIME)).toBeNull();
    expect(await storage.store.getUtxo({ txId: TX_REALTIME, index: 0 })).toBeNull();
    expect(await storage.store.getTokenMeta(NATIVE_TOKEN_UID)).toBeNull();
  }, 60000);

  it('ends quietly when stop() runs while a walk decodes', async () => {
    const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
    const { wallet, storage, logger } = await makeWallet({
      history: () => synced.map(tx => structuredClone(tx)),
    });
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    const rewind = holdNextRewind(storage);

    await wallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => rewind.reached, 'the walk to decode');
    await wallet.stop({ cleanStorage: false });
    rewind.open();
    await settle();

    expect(wallet.state).toBe(HathorWallet.CLOSED);
    expect(logger.error).not.toHaveBeenCalled();
    // Only the tx decoded when stop() ran is finished; nothing more is unlocked.
    expect(storage.scanXPrivKey).toBeNull();
  }, 60000);

  it('ends a walk quietly when a second start() runs during it', async () => {
    const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
    const { wallet, storage, logger } = await makeWallet({
      history: () => synced.map(tx => structuredClone(tx)),
    });
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    const rewind = holdNextRewind(storage);
    await wallet.onConnectionChangedState(ConnectionState.CONNECTED);
    await until(() => rewind.reached, 'the walk to decode');

    await wallet.start({ pinCode: PIN, password: PASSWORD });
    rewind.open();
    await settle();

    // The second start owns the state; the walk of the first one sets neither READY nor ERROR.
    expect(wallet.state).toBe(HathorWallet.CONNECTING);
    expect(logger.error).not.toHaveBeenCalled();
    await wallet.stop();
  }, 60000);

  it('reports no failure when stop() runs while a realtime tx decodes', async () => {
    const { wallet, storage, logger } = await makeWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    await sync(wallet);
    const rewind = holdNextRewind(storage);

    wallet.handleWebsocketMsg(message(shieldedTx(TX_REALTIME, OPENS_20)));
    await until(() => rewind.reached, 'the decode');
    await wallet.stop({ cleanStorage: false });
    rewind.open();
    await wallet.newTxPromise;

    expect(logger.error).not.toHaveBeenCalled();
    expect(storage.scanXPrivKey).toBeNull();
  }, 60000);

  it('unlocks the view key again at every start', async () => {
    const { wallet, shielded } = await makeWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    expect(shielded.hasKey).toBe(true);
    await wallet.stop();

    await wallet.start({ pinCode: '999', password: PASSWORD });
    expect(shielded.hasKey).toBe(false);
    expect(shielded.cause).toBe('wrong-pin');
    await wallet.stop();

    await wallet.start({ pinCode: PIN, password: PASSWORD });
    expect(shielded.hasKey).toBe(true);
    expect(shielded.cause).toBeNull();
    await wallet.stop();
  }, 60000);

  it('decodes without a constructor PIN: the first sync, a reconnect with a parked message, and realtime receives', async () => {
    const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
    const { wallet, storage } = await makeWallet({
      history: () => synced.map(tx => structuredClone(tx)),
    });
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    // Every decode below uses the key in memory: no PIN is decrypted again.
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');

    await sync(wallet);
    expect(await htrBalance(wallet)).toBe(50n);

    // A reconnect wipes the store and processes the history again. A message
    // that arrives during its sync is parked, and processed by its walk.
    const reconnect = wallet.onConnectionChangedState(ConnectionState.CONNECTED);
    wallet.handleWebsocketMsg(message(shieldedTx(TX_PARKED, OPENS_30)));
    await reconnect;
    await until(() => wallet.isReady(), 'READY after the reconnect');
    await wallet.newTxPromise;
    expect(await htrBalance(wallet)).toBe(80n);

    // Another wallet pays this one.
    wallet.handleWebsocketMsg(message(shieldedTx(TX_REALTIME, OPENS_20)));
    await wallet.newTxPromise;
    expect(await htrBalance(wallet)).toBe(100n);
    expect((await storage.getTx(TX_REALTIME))!.processingStatus).toBe(
      TxHistoryProcessingStatus.FINISHED
    );
    expect(unlockSpy).not.toHaveBeenCalled();
    await wallet.stop();
  }, 60000);

  it('credits the change of a send made with a stub PIN', async () => {
    const { wallet, storage } = await makeWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    await sync(wallet);
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');

    // What SendTransaction does after a dApp send whose request carried a stub PIN.
    wallet.enqueueOnNewTx(message(shieldedTx(TX_CHANGE, OPENS_5)), '111111');
    await wallet.newTxPromise;

    expect(await htrBalance(wallet)).toBe(5n);
    expect(unlockSpy).not.toHaveBeenCalled();
    await wallet.stop();
  }, 60000);

  it('keeps decoding after the PIN changes', async () => {
    const { wallet, storage } = await makeWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    await sync(wallet);

    await storage.changePin(PIN, '777');
    wallet.handleWebsocketMsg(message(shieldedTx(TX_REALTIME, OPENS_20)));
    await wallet.newTxPromise;

    expect(await htrBalance(wallet)).toBe(20n);
    await wallet.stop();
  }, 60000);

  it('decodes the same values and balances with a constructor PIN as with the PIN path alone', async () => {
    const synced = [shieldedTx(TX_SYNCED, OPENS_50), shieldedTx(TX_REALTIME, OPENS_30)];
    const history = () => synced.map(tx => structuredClone(tx));

    // A wallet that keeps its PIN for its whole life, as headless does.
    const { wallet, storage, shielded } = await makeWallet({ constructorPin: PIN, history });
    await wallet.start();
    expect(shielded.hasKey).toBe(true);
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    await sync(wallet);
    expect(unlockSpy).not.toHaveBeenCalled();

    // The same record and history, decoded with the PIN on a storage that keeps no key in memory.
    const reference = new Storage(new MemoryStore());
    await reference.saveAccessData(JSON.parse(walletFixture().accessData));
    reference.setShieldedCryptoProvider(makeCryptoProvider());
    await storageUtils.loadAddresses(0, 2, reference);
    for (const tx of history()) {
      await reference.addTx(tx as unknown as IHistoryTx);
    }
    await storageUtils.processHistory(reference, { pinCode: PIN });

    const decoded = async (s: Storage) =>
      Promise.all(synced.map(async tx => (await s.getTx(tx.tx_id))!.shielded_outputs));
    const utxos = async (s: Storage) => {
      const found: unknown[] = [];
      for await (const utxo of s.selectUtxos({ token: NATIVE_TOKEN_UID })) {
        found.push(utxo);
      }
      return found;
    };
    expect(await decoded(storage)).toEqual(await decoded(reference));
    expect(await utxos(storage)).toEqual(await utxos(reference));
    expect(await storage.store.getTokenMeta(NATIVE_TOKEN_UID)).toEqual(
      await reference.store.getTokenMeta(NATIVE_TOKEN_UID)
    );
    expect(await htrBalance(wallet)).toBe(80n);
    await wallet.stop();
  }, 60000);

  it('never writes, logs or emits the view key', async () => {
    const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
    const { wallet, storage, logger } = await makeWallet({
      history: () => synced.map(tx => structuredClone(tx)),
    });
    const { scanXpriv, childKeys } = walletFixture();
    const scanKeyHex = new bitcore.HDPrivateKey(scanXpriv).privateKey
      .toBuffer({ size: 32 })
      .toString('hex');
    const writes = [
      jest.spyOn(storage.store, 'saveAccessData'),
      jest.spyOn(storage.store, 'setItem'),
      jest.spyOn(storage.store, 'saveTx'),
    ];
    const emitSpy = jest.spyOn(wallet, 'emit');

    await wallet.start({ pinCode: PIN, password: PASSWORD });
    await sync(wallet);
    wallet.handleWebsocketMsg(message(shieldedTx(TX_REALTIME, OPENS_20)));
    await wallet.newTxPromise;
    // A reconnect saves the record again, and decodes the whole history again.
    synced.push(shieldedTx(TX_REALTIME, OPENS_20));
    await sync(wallet);
    await wallet.stop({ cleanStorage: false });

    expect(await htrBalance(wallet)).toBe(70n);
    expect(writes[0]).toHaveBeenCalled();
    expect(writes[2]).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      'shielded-capability',
      expect.objectContaining({ level: 'full' })
    );
    const seen = JSON.stringify(
      [
        ...writes.flatMap(spy => spy.mock.calls),
        ...emitSpy.mock.calls,
        ...Object.values(logger).flatMap(fn => fn.mock.calls),
      ],
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
    );
    for (const secret of [scanXpriv, scanKeyHex, ...childKeys, 'htpr', 'tnpr', 'xprv']) {
      expect(seen).not.toContain(secret);
    }
  }, 60000);

  describe('its capability and the shielded-capability event', () => {
    /** Record the 'shielded-capability' events of `wallet`. */
    function capabilityEvents(wallet: HathorWallet): jest.Mock {
      const listener = jest.fn();
      wallet.on('shielded-capability', listener);
      return listener;
    }

    function verdictOf({ level, reason, cause }: IShieldedCapability) {
      return { level, reason, cause };
    }

    it('is full after a start with the right PIN, which emits it once', async () => {
      const { wallet } = await makeWallet();
      const events = capabilityEvents(wallet);

      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await settle();

      const capability = await wallet.getShieldedCapability();
      expect(capability).toEqual({
        level: 'full',
        reason: null,
        cause: null,
        canReceive: true,
        canSpend: true,
        historyComplete: true,
        undecoded: { txIds: [], locked: 0, unreadable: 0, error: 0 },
      });
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(capability);
      await wallet.stop();
    }, 60000);

    it('is watch, locked, wrong-pin after a start with a wrong PIN, which resolves and emits it once', async () => {
      const { wallet } = await makeWallet();
      const events = capabilityEvents(wallet);

      await expect(wallet.start({ pinCode: '999', password: PASSWORD })).resolves.toEqual({
        network: 'testnet',
      });
      await settle();

      const locked = { level: 'watch', reason: 'locked', cause: 'wrong-pin' };
      expect(verdictOf(await wallet.getShieldedCapability())).toEqual(locked);
      expect(events).toHaveBeenCalledTimes(1);
      expect(verdictOf(events.mock.calls[0][0])).toEqual(locked);
      await wallet.stop();
    }, 60000);

    it('is watch, locked, not-supplied for a read-only record with the shielded xpubs, which counts what it cannot decode', async () => {
      const record = JSON.parse(walletFixture().accessData);
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData({
        xpubkey: record.xpubkey,
        walletType: record.walletType,
        walletFlags: WALLET_FLAGS.READONLY,
        scanXpubkey: record.scanXpubkey,
        spendXpubkey: record.spendXpubkey,
      });
      jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
        resolve({ network: 'testnet' });
      });
      const history = [shieldedTx(TX_SYNCED, OPENS_50)];
      jest
        .spyOn(walletApi, 'getAddressHistoryForAwait')
        .mockImplementation(async (addresses: string[]) => {
          const txs = history.filter(tx =>
            tx.shielded_outputs.some(output => addresses.includes(output.decoded.address))
          );
          return { data: { success: true, history: txs, has_more: false } } as never;
        });
      const wallet = new HathorWallet({
        xpub: record.xpubkey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: makeConn() as any,
        storage,
        scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
        logger: makeLogger(),
      });
      wallet.setShieldedCryptoProvider(makeCryptoProvider());

      await wallet.start();
      await sync(wallet);

      expect(await wallet.getShieldedCapability()).toMatchObject({
        level: 'watch',
        reason: 'locked',
        cause: 'not-supplied',
        canSpend: false,
        undecoded: { txIds: [TX_SYNCED], locked: 1, unreadable: 0, error: 0 },
      });
      expect(await htrBalance(wallet)).toBe(0n);
      await wallet.stop();
    }, 60000);

    it('is none, integrity, for a record whose scan key and scan xpub disagree, which derives and gives out no shielded address', async () => {
      const { wallet, storage } = await makeWallet();
      const record = (await storage.getAccessData())!;
      // The scan key of another seed, encrypted under the wallet's PIN.
      const otherScan = walletUtils
        .getXPrivKeyFromSeed(walletUtils.generateWalletWords(), { networkName: 'testnet' })
        .deriveChild("m/44'/280'/1'")
        .deriveChild(0);
      await storage.saveAccessData({
        ...record,
        scanMainKey: encryptData(otherScan.xprivkey, PIN),
      });

      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);

      expect(verdictOf(await wallet.getShieldedCapability())).toEqual({
        level: 'none',
        reason: 'integrity',
        cause: 'key-mismatch',
      });
      expect(await storage.getAddressAtIndex(0)).not.toBeNull();
      expect(await storage.getAddressAtIndex(0, { legacy: false })).toBeNull();
      await expect(wallet.getAddressAtIndex(0, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-integrity',
      });
      await expect(wallet.getCurrentAddress({}, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-integrity',
      });
      await wallet.stop();
    }, 60000);

    it('is none, no-provider, for a wallet started without a crypto provider, which gives out no shielded address', async () => {
      const { wallet } = await makeWallet();
      wallet.setShieldedCryptoProvider(undefined);

      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);

      expect(verdictOf(await wallet.getShieldedCapability())).toEqual({
        level: 'none',
        reason: 'no-provider',
        cause: null,
      });
      await expect(wallet.getCurrentAddress({}, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-no-provider',
      });
      await expect(wallet.getNextAddress({ legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-no-provider',
      });
      await expect(wallet.getCurrentAddress()).resolves.toMatchObject({ index: 0 });
      await wallet.stop();
    }, 60000);

    it('gives out no shielded receive address while the view key is locked', async () => {
      const { wallet, storage } = await makeWallet();
      await wallet.start({ pinCode: '999', password: PASSWORD });
      await sync(wallet);
      const cursor = (await storage.getWalletData()).shieldedCurrentAddressIndex;

      await expect(wallet.getCurrentAddress({}, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-locked',
      });
      await expect(
        wallet.getCurrentAddress({ markAsUsed: true }, { legacy: false })
      ).rejects.toMatchObject({ errorCode: 'shielded-locked' });
      await expect(wallet.getNextAddress({ legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-locked',
      });

      expect((await storage.getWalletData()).shieldedCurrentAddressIndex).toBe(cursor);
      // The transparent address, and the shielded address at an explicit index, are given as before.
      await expect(wallet.getCurrentAddress()).resolves.toMatchObject({ index: 0 });
      await expect(wallet.getAddressAtIndex(1, { legacy: false })).resolves.toEqual(
        (await storage.getAddressAtIndex(1, { legacy: false }))!.base58
      );
      await wallet.stop();
    }, 60000);

    it('gives out shielded receive addresses at level full', async () => {
      const { wallet } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);

      const current = await wallet.getCurrentAddress({}, { legacy: false });
      expect(current.index).toBe(0);
      expect(current.address).toBe(await wallet.getAddressAtIndex(0, { legacy: false }));
      await expect(wallet.getNextAddress({ legacy: false })).resolves.toMatchObject({ index: 1 });
      await wallet.stop();
    }, 60000);

    it('gives out no shielded address before start()', async () => {
      const { wallet } = await makeWallet();

      expect(verdictOf(await wallet.getShieldedCapability())).toEqual({
        level: 'none',
        reason: 'not-started',
        cause: null,
      });
      await expect(wallet.getCurrentAddress({}, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-not-started',
      });
    }, 60000);

    it('gives no shielded address at any index for a multisig wallet', async () => {
      const { wallet, storage } = await makeWallet();
      const record = (await storage.getAccessData())!;
      await storage.saveAccessData({ ...record, walletType: WalletType.MULTISIG });

      await expect(wallet.getAddressAtIndex(0, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-multisig',
      });
    }, 60000);

    it('lists no shielded address for a multisig wallet', async () => {
      const { wallet, storage } = await makeWallet();
      // Shielded addresses a load stored from the record's single-signature keys.
      await storageUtils.loadAddresses(0, 2, storage);
      const record = (await storage.getAccessData())!;
      await storage.saveAccessData({ ...record, walletType: WalletType.MULTISIG });
      expect(await storage.getAddressAtIndex(0, { legacy: false })).not.toBeNull();

      await expect(wallet.getAllAddresses({ legacy: false }).next()).rejects.toMatchObject({
        errorCode: 'shielded-multisig',
      });
      await expect(wallet.getAllAddresses().next()).resolves.toMatchObject({
        value: { index: 0 },
      });
    }, 60000);

    it('lists no shielded address while the record fails its integrity check', async () => {
      const { wallet, storage } = await makeWallet();
      // A first session loads the shielded chain, and the stop keeps it.
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      await wallet.stop({ cleanStorage: false });
      expect(await storage.getAddressAtIndex(0, { legacy: false })).not.toBeNull();
      // The scan key of another seed, encrypted under the wallet's PIN.
      const otherScan = walletUtils
        .getXPrivKeyFromSeed(walletUtils.generateWalletWords(), { networkName: 'testnet' })
        .deriveChild("m/44'/280'/1'")
        .deriveChild(0);
      await storage.saveAccessData({
        ...(await storage.getAccessData())!,
        scanMainKey: encryptData(otherScan.xprivkey, PIN),
      });

      await wallet.start({ pinCode: PIN, password: PASSWORD });

      expect(shieldedOf(storage).integrity).toBe('key-mismatch');
      await expect(wallet.getAllAddresses({ legacy: false }).next()).rejects.toMatchObject({
        errorCode: 'shielded-integrity',
      });
      await wallet.stop();
    }, 60000);

    it('gives the code of the missing provider or keys for a shielded address at an index that is not loaded', async () => {
      const { wallet } = await makeWallet();
      wallet.setShieldedCryptoProvider(undefined);
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      await expect(wallet.getAddressAtIndex(0, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-no-provider',
      });
      await wallet.stop();

      // A record without the shielded xpubs, with a provider.
      const record = JSON.parse(walletFixture().accessData);
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData({
        xpubkey: record.xpubkey,
        walletType: record.walletType,
        walletFlags: WALLET_FLAGS.READONLY,
      });
      const xpubWallet = new HathorWallet({
        xpub: record.xpubkey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: makeConn() as any,
        storage,
        scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
        logger: makeLogger(),
      });
      xpubWallet.setShieldedCryptoProvider(makeCryptoProvider());
      await xpubWallet.start();
      await sync(xpubWallet);
      await expect(xpubWallet.getAddressAtIndex(0, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-no-keys',
      });
      await xpubWallet.stop();
    }, 60000);

    it('stores no injected shielded pair for a record whose scan key and scan xpub disagree', async () => {
      const record = JSON.parse(walletFixture().accessData);
      const pair = addressUtils.deriveShieldedAddressPair(
        record.scanXpubkey,
        record.spendXpubkey,
        0,
        'testnet'
      );
      // The scan key of another seed, encrypted under the wallet's PIN.
      const otherScan = walletUtils
        .getXPrivKeyFromSeed(walletUtils.generateWalletWords(), { networkName: 'testnet' })
        .deriveChild("m/44'/280'/1'")
        .deriveChild(0);
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData({
        ...record,
        scanMainKey: encryptData(otherScan.xprivkey, PIN),
      });
      jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
        resolve({ network: 'testnet' });
      });
      const wallet = new HathorWallet({
        seed: SEED,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: makeConn() as any,
        storage,
        password: PASSWORD,
        scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
        logger: makeLogger(),
        preCalculatedAddresses: [
          {
            bip32AddressIndex: 0,
            shielded: {
              shieldedBase58: pair.shieldedAddress.base58,
              spendBase58: pair.spendAddress.base58,
              scanPubkey: pair.shieldedAddress.publicKey!,
              spendPubkey: pair.spendAddress.publicKey!,
            },
          },
        ],
      });
      wallet.setShieldedCryptoProvider(makeCryptoProvider());

      await wallet.start({ pinCode: PIN, password: PASSWORD });

      expect(shieldedOf(storage).integrity).toBe('key-mismatch');
      expect(await storage.getAddressAtIndex(0, { legacy: false })).toBeNull();
      expect(await storage.isAddressMine(pair.spendAddress.base58)).toBe(false);
      await wallet.stop();
    }, 60000);

    it('is view with an external signer that did not declare shielded spends, and full once it does', async () => {
      const { wallet } = await makeWallet();
      const events = capabilityEvents(wallet);
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await settle();
      const signer: EcdsaTxSign = async () => ({ inputSignatures: [], ncCallerSignature: null });

      wallet.setExternalTxSigningMethod(signer);
      await settle();
      expect(verdictOf(events.mock.calls[1][0])).toEqual({
        level: 'view',
        reason: 'no-spend-authority',
        cause: null,
      });

      wallet.setExternalTxSigningMethod(signer, { shieldedSpend: true });
      await settle();
      expect(verdictOf(events.mock.calls[2][0])).toEqual({
        level: 'full',
        reason: null,
        cause: null,
      });

      // Without a signer, the record's spend key signs: the capability stays full.
      wallet.setExternalTxSigningMethod(null);
      await settle();
      expect(events).toHaveBeenCalledTimes(3);
      expect(await wallet.getShieldedCapability()).toMatchObject({ level: 'full', canSpend: true });
      await wallet.stop();
    }, 60000);

    it('emits only on change, after the call that changed it returns, and logs a listener that throws', async () => {
      const { wallet, storage, logger } = await makeWallet();
      const events = capabilityEvents(wallet);
      wallet.on('shielded-capability', () => {
        throw new Error('listener failed');
      });
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await settle();
      expect(events).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        "A 'shielded-capability' listener failed",
        expect.anything()
      );

      // A sync and a walk that leave the capability as it was emit nothing.
      wallet.setShieldedCryptoProvider(storage.shieldedCryptoProvider);
      await sync(wallet);
      await settle();
      expect(events).toHaveBeenCalledTimes(1);

      wallet.setShieldedCryptoProvider(undefined);
      expect(events).toHaveBeenCalledTimes(1);
      await settle();
      expect(events).toHaveBeenCalledTimes(2);
      expect(verdictOf(events.mock.calls[1][0])).toEqual({
        level: 'none',
        reason: 'no-provider',
        cause: null,
      });
      await wallet.stop();
    }, 60000);

    it('emits the outputs a realtime tx leaves undecoded', async () => {
      const { wallet } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      await settle();
      const events = capabilityEvents(wallet);
      // Paid to the wallet's shielded address, but it does not open with the wallet's key.
      const unreadable = shieldedTx(TX_REALTIME, OPENS_20);
      unreadable.shielded_outputs[0].commitment = 'ff'.repeat(33);

      wallet.handleWebsocketMsg(message(unreadable));
      await wallet.newTxPromise;
      await settle();

      expect(events).toHaveBeenCalledTimes(1);
      expect(events.mock.calls[0][0]).toMatchObject({
        level: 'full',
        undecoded: { txIds: [TX_REALTIME], locked: 0, unreadable: 1, error: 0 },
      });
      await wallet.stop();
    }, 60000);

    it('reports neither receive nor a complete history while the wallet syncs by streaming, and both once the sync falls back to polling', async () => {
      const { wallet, conn } = await makeWallet();
      // The fullnode does not stream histories, so the sync falls back to polling.
      Object.assign(conn, { hasCapability: jest.fn().mockResolvedValue(false) });
      wallet.setHistorySyncMode(HistorySyncMode.XPUB_STREAM_WS);
      const events = capabilityEvents(wallet);

      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await settle();
      expect(await wallet.getShieldedCapability()).toMatchObject({
        level: 'full',
        canReceive: false,
        historyComplete: false,
      });

      await sync(wallet);
      await settle();
      expect(await wallet.getShieldedCapability()).toMatchObject({
        level: 'full',
        canReceive: true,
        historyComplete: true,
      });
      expect(events).toHaveBeenCalledTimes(2);
      await wallet.stop();
    }, 60000);
  });

  describe('unlockShieldedView, reprocessShieldedOutputs and the address discovery', () => {
    const TX_FAR = 'e5'.repeat(32);

    function recordStates(wallet: HathorWallet): unknown[] {
      const states: unknown[] = [];
      wallet.on('state', state => {
        states.push(state);
      });
      return states;
    }

    function verdictOf({ level, reason, cause }: IShieldedCapability) {
      return { level, reason, cause };
    }

    it('unlockShieldedView fills the key and returns before the walk, whose READY resolves reprocessed', async () => {
      const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
      const { wallet, storage, shielded } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      await wallet.start({ pinCode: '999', password: PASSWORD });
      await sync(wallet);
      expect((await wallet.getShieldedCapability()).undecoded.locked).toBe(1);
      const states = recordStates(wallet);
      const rewind = holdNextRewind(storage);

      const { capability, reprocessed } = await wallet.unlockShieldedView({ pinCode: PIN });

      // The key is in memory; the walk that decodes with it has not decoded yet.
      expect(shielded.hasKey).toBe(true);
      expect(capability).toMatchObject({ level: 'full', undecoded: { locked: 1 } });
      expect(wallet.state).toBe(HathorWallet.PROCESSING);
      await until(() => rewind.reached, 'the walk to decode');
      rewind.open();
      await expect(reprocessed).resolves.toMatchObject({
        level: 'full',
        undecoded: { txIds: [], locked: 0, unreadable: 0, error: 0 },
      });
      expect(wallet.state).toBe(HathorWallet.READY);
      expect(states).toEqual([HathorWallet.PROCESSING, HathorWallet.READY]);
      expect(await htrBalance(wallet)).toBe(50n);
      await wallet.stop();
    }, 60000);

    it('unlockShieldedView runs no walk when no output is locked, nor when the wallet held the same key', async () => {
      const { wallet } = await makeWallet();
      await wallet.start({ pinCode: '999', password: PASSWORD });
      await sync(wallet);
      const states = recordStates(wallet);

      const first = await wallet.unlockShieldedView({ pinCode: PIN });
      expect(first.capability.level).toBe('full');
      await expect(first.reprocessed).resolves.toEqual(first.capability);

      const again = await wallet.unlockShieldedView({ pinCode: PIN });
      await expect(again.reprocessed).resolves.toEqual(again.capability);
      await settle();
      expect(states).toEqual([]);
      expect(wallet.isReady()).toBe(true);
      await wallet.stop();
    }, 60000);

    it('a wrong-PIN unlockShieldedView throws shielded-wrong-pin and changes nothing', async () => {
      const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
      const { wallet, shielded } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      await wallet.start({ pinCode: '999', password: PASSWORD });
      await sync(wallet);
      const before = await wallet.getShieldedCapability();
      const states = recordStates(wallet);

      await expect(wallet.unlockShieldedView({ pinCode: '888' })).rejects.toMatchObject({
        errorCode: 'shielded-wrong-pin',
      });
      await expect(wallet.unlockShieldedView({ pinCode: '' })).rejects.toMatchObject({
        errorCode: 'shielded-wrong-pin',
      });

      expect(shielded.hasKey).toBe(false);
      expect(await wallet.getShieldedCapability()).toEqual(before);
      await settle();
      expect(states).toEqual([]);
      await wallet.stop();
    }, 60000);

    it('unlockShieldedView and reprocessShieldedOutputs reject with shielded-not-started before start() and after stop()', async () => {
      const { wallet } = await makeWallet();
      await expect(wallet.unlockShieldedView({ pinCode: PIN })).rejects.toMatchObject({
        errorCode: 'shielded-not-started',
      });
      await expect(wallet.reprocessShieldedOutputs()).rejects.toMatchObject({
        errorCode: 'shielded-not-started',
      });

      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await wallet.stop();

      await expect(wallet.unlockShieldedView({ pinCode: PIN })).rejects.toMatchObject({
        errorCode: 'shielded-not-started',
      });
      await expect(wallet.reprocessShieldedOutputs()).rejects.toMatchObject({
        errorCode: 'shielded-not-started',
      });
    }, 60000);

    it('an unlockShieldedView whose key does not match the record marks its shielded keys inconsistent', async () => {
      const { wallet, storage } = await makeWallet();
      await wallet.start({ pinCode: '999', password: PASSWORD });
      await sync(wallet);
      const record = (await storage.getAccessData())!;
      // The scan key of another seed, encrypted under the wallet's PIN.
      const otherScan = walletUtils
        .getXPrivKeyFromSeed(walletUtils.generateWalletWords(), { networkName: 'testnet' })
        .deriveChild("m/44'/280'/1'")
        .deriveChild(0);
      await storage.saveAccessData({
        ...record,
        scanMainKey: encryptData(otherScan.xprivkey, PIN),
      });

      await expect(wallet.unlockShieldedView({ pinCode: PIN })).rejects.toMatchObject({
        errorCode: 'shielded-key-mismatch',
      });

      expect(verdictOf(await wallet.getShieldedCapability())).toEqual({
        level: 'none',
        reason: 'integrity',
        cause: 'key-mismatch',
      });
      await wallet.stop();
    }, 60000);

    it.each([
      {
        record: 'whose encrypted scan key holds no extended private key',
        before: { level: 'watch', reason: 'locked', cause: 'corrupt-key' },
        damage: (record: IWalletAccessData) => ({
          ...record,
          scanMainKey: encryptData('not an extended key', PIN),
        }),
      },
      {
        record: 'whose scan xpub is not the xpub of its scan key',
        before: { level: 'none', reason: 'integrity', cause: 'key-mismatch' },
        damage: (record: IWalletAccessData) => ({
          ...record,
          // The scan xpub of another seed.
          scanXpubkey: walletUtils
            .getXPrivKeyFromSeed(walletUtils.generateWalletWords(), { networkName: 'testnet' })
            .deriveChild("m/44'/280'/1'")
            .deriveChild(0).xpubkey,
        }),
      },
    ])(
      'repairs a record $record when its shielded keys are derived again, saved and unlocked',
      async ({ before, damage }) => {
        const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
        const { wallet, storage } = await makeWallet({
          history: () => synced.map(tx => structuredClone(tx)),
        });
        await storage.saveAccessData(damage((await storage.getAccessData())!));
        await wallet.start({ pinCode: PIN, password: PASSWORD });
        await sync(wallet);
        expect(verdictOf(await wallet.getShieldedCapability())).toEqual(before);

        const accessData = (await storage.getAccessData())!;
        expect(
          walletUtils.migrateShieldedAccessData(accessData, {
            pin: PIN,
            password: PASSWORD,
            networkName: 'testnet',
            replaceShieldedKeys: true,
          })
        ).toBe(true);
        await storage.saveAccessData(accessData);
        const { capability, reprocessed } = await wallet.unlockShieldedView({ pinCode: PIN });

        expect(verdictOf(capability)).toEqual({ level: 'full', reason: null, cause: null });
        await expect(reprocessed).resolves.toMatchObject({ level: 'full' });
        expect(await htrBalance(wallet)).toBe(50n);
        await wallet.stop();
      },
      60000
    );

    it('unlockShieldedView rejects with shielded-not-started, and keeps no key, when stop() runs during the unlock', async () => {
      const { wallet, storage, shielded } = await makeWallet();
      await wallet.start({ pinCode: '999', password: PASSWORD });
      const readKey = storage.getScanXPrivKey.bind(storage);
      const unlocking = gate();
      let reached = false;
      jest.spyOn(storage, 'getScanXPrivKey').mockImplementation(async pin => {
        reached = true;
        await unlocking.opened;
        return readKey(pin);
      });

      const unlock = wallet.unlockShieldedView({ pinCode: PIN });
      await until(() => reached, 'the unlock');
      await wallet.stop();
      unlocking.open();

      await expect(unlock).rejects.toMatchObject({ errorCode: 'shielded-not-started' });
      expect(shielded.hasKey).toBe(false);
    }, 60000);

    it('reprocessShieldedOutputs rejects with shielded-not-ready while the wallet is connecting', async () => {
      const { wallet } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      expect(wallet.state).toBe(HathorWallet.CONNECTING);

      await expect(wallet.reprocessShieldedOutputs()).rejects.toMatchObject({
        errorCode: 'shielded-not-ready',
      });
      await wallet.stop();
    }, 60000);

    it('reprocessShieldedOutputs runs a walk that decodes the outputs a failure left in error, and resolves at READY', async () => {
      const { wallet, storage } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      // A store read fails while a realtime tx is decoded: its output is counted in error.
      jest.spyOn(storage, 'getAddressInfo').mockRejectedValueOnce(new Error('store read failed'));
      wallet.handleWebsocketMsg(message(shieldedTx(TX_REALTIME, OPENS_20)));
      await wallet.newTxPromise;
      expect((await wallet.getShieldedCapability()).undecoded).toEqual({
        txIds: [TX_REALTIME],
        locked: 0,
        unreadable: 0,
        error: 1,
      });
      expect(await htrBalance(wallet)).toBe(0n);
      const states = recordStates(wallet);

      const capability = await wallet.reprocessShieldedOutputs();

      expect(capability.undecoded).toEqual({ txIds: [], locked: 0, unreadable: 0, error: 0 });
      expect(states).toEqual([HathorWallet.PROCESSING, HathorWallet.READY]);
      expect(await htrBalance(wallet)).toBe(20n);
      await wallet.stop();
    }, 60000);

    it('a reprocessShieldedOutputs request during a walk makes the walk process the history once more', async () => {
      const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
      const { wallet, storage } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      const processSpy = jest.spyOn(storage, 'processHistory');
      const rewind = holdNextRewind(storage);
      const states = recordStates(wallet);

      await wallet.onConnectionChangedState(ConnectionState.CONNECTED);
      await until(() => rewind.reached, 'the walk to decode');
      expect(wallet.state).toBe(HathorWallet.PROCESSING);
      const reprocessing = wallet.reprocessShieldedOutputs();
      rewind.open();

      await expect(reprocessing).resolves.toMatchObject({ level: 'full' });
      expect(processSpy).toHaveBeenCalledTimes(2);
      expect(states).toEqual([HathorWallet.SYNCING, HathorWallet.PROCESSING, HathorWallet.READY]);
      expect(await htrBalance(wallet)).toBe(50n);
      await wallet.stop();
    }, 60000);

    it('reprocessShieldedOutputs rejects with shielded-not-ready when the walk fails', async () => {
      const { wallet, storage } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      jest.spyOn(storage, 'processHistory').mockRejectedValueOnce(new Error('store write failed'));

      await expect(wallet.reprocessShieldedOutputs()).rejects.toMatchObject({
        errorCode: 'shielded-not-ready',
      });
      expect(wallet.state).toBe(HathorWallet.ERROR);
      await wallet.stop();
    }, 60000);

    it('when stop() ends a walk, reprocessShieldedOutputs rejects and the reprocessed promise of unlockShieldedView resolves', async () => {
      const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
      const { wallet, storage } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      await wallet.start({ pinCode: '999', password: PASSWORD });
      await sync(wallet);
      const rewind = holdNextRewind(storage);
      const { reprocessed } = await wallet.unlockShieldedView({ pinCode: PIN });
      const reprocessing = wallet.reprocessShieldedOutputs();
      await until(() => rewind.reached, 'the walk to decode');

      await wallet.stop({ cleanStorage: false });
      rewind.open();

      await expect(reprocessed).resolves.toMatchObject({ level: 'none', reason: 'not-started' });
      await expect(reprocessing).rejects.toMatchObject({ errorCode: 'shielded-not-started' });
    }, 60000);

    it('the walk loads the next shielded window when decoding moves the used address, until no cursor moves', async () => {
      // Paid to shielded indexes 1 and 3: index 3 is past the first window of a gap limit of 2.
      const synced = [shieldedTx(TX_SYNCED, OPENS_30), shieldedTx(TX_FAR, OPENS_7)];
      const { wallet, storage } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      const syncSpy = jest.spyOn(wallet, 'syncHistory');

      await sync(wallet);

      expect(await htrBalance(wallet)).toBe(37n);
      expect(await storage.getAddressAtIndex(3, { legacy: false })).not.toBeNull();
      // The first sync, then one round per window: [2, 3] holds the second
      // output, and [4, 5] holds nothing, so no cursor moves after it.
      expect(syncSpy.mock.calls.map(([startIndex, count]) => [startIndex, count])).toEqual([
        [0, 2],
        [2, 2],
        [4, 2],
      ]);
      expect((await wallet.getShieldedCapability()).historyComplete).toBe(true);
      await wallet.stop();
    }, 60000);

    it('the address discovery stops after a round that moves no cursor', async () => {
      const { wallet } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      // A scanning policy that keeps asking for a window the wallet already loaded.
      jest.spyOn(storageUtils, 'checkScanningPolicy').mockResolvedValue({ nextIndex: 0, count: 1 });
      const syncSpy = jest.spyOn(wallet, 'syncHistory');

      const capability = await wallet.reprocessShieldedOutputs();

      expect(syncSpy).toHaveBeenCalledTimes(1);
      expect(capability.historyComplete).toBe(true);
      await wallet.stop();
    }, 60000);

    it('the address discovery stops at its round limit, logs it, and reports an incomplete history until a walk completes it', async () => {
      const { wallet, storage, logger } = await makeWallet();
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      // Every round loads one more address, and the scanning policy always asks for another.
      let next = 100;
      const policySpy = jest
        .spyOn(storageUtils, 'checkScanningPolicy')
        .mockImplementation(async () => ({ nextIndex: next, count: 1 }));
      const syncSpy = jest.spyOn(wallet, 'syncHistory').mockImplementation(async () => {
        await storage.saveAddress({ base58: `W-discovered-${next}`, bip32AddressIndex: next });
        next += 1;
      });

      const capped = await wallet.reprocessShieldedOutputs();

      expect(syncSpy).toHaveBeenCalledTimes(50);
      expect(capped.historyComplete).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('after 50 rounds'));

      policySpy.mockRestore();
      syncSpy.mockRestore();
      const completed = await wallet.reprocessShieldedOutputs();
      expect(completed.historyComplete).toBe(true);
      await wallet.stop();
    }, 60000);

    it('a provider set on a started wallet loads the shielded chain from index 0 and decodes it, in one walk', async () => {
      const synced = [shieldedTx(TX_SYNCED, OPENS_50), shieldedTx(TX_PARKED, OPENS_30)];
      const { wallet, storage, conn } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      wallet.setShieldedCryptoProvider(undefined);
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      expect(await storage.getAddressAtIndex(0, { legacy: false })).toBeNull();
      expect(await htrBalance(wallet)).toBe(0n);
      const states = recordStates(wallet);
      conn.subscribeAddresses.mockClear();

      wallet.setShieldedCryptoProvider(makeCryptoProvider());
      await until(() => states.includes(HathorWallet.READY), 'the walk');
      await settle();

      expect(states).toEqual([HathorWallet.PROCESSING, HathorWallet.READY]);
      expect(await storage.getAddressAtIndex(0, { legacy: false })).not.toBeNull();
      const { spend } = walletFixture();
      expect(conn.subscribeAddresses.mock.calls.flat(2)).toEqual(
        expect.arrayContaining([spend[0], spend[1]])
      );
      expect(await htrBalance(wallet)).toBe(80n);
      expect(verdictOf(await wallet.getShieldedCapability())).toEqual({
        level: 'full',
        reason: null,
        cause: null,
      });
      await wallet.stop();
    }, 60000);

    it('emits the capability a provider set on a started wallet gives once its walk loaded and decoded the chain', async () => {
      const synced = [shieldedTx(TX_SYNCED, OPENS_50)];
      const { wallet } = await makeWallet({
        history: () => synced.map(tx => structuredClone(tx)),
      });
      wallet.setShieldedCryptoProvider(undefined);
      await wallet.start({ pinCode: PIN, password: PASSWORD });
      await sync(wallet);
      await settle();
      // What a UI does on each event: show a shielded receive address and the balance.
      const seen: Array<{ state: unknown; level: string; address: string; balance: bigint }> = [];
      wallet.on('shielded-capability', capability => {
        const { state } = wallet;
        Promise.all([
          wallet.getCurrentAddress({}, { legacy: false }).then(
            ({ address }) => address,
            (error: Error) => `error: ${error.message}`
          ),
          htrBalance(wallet),
        ]).then(([address, balance]) => {
          seen.push({ state, level: capability.level, address, balance });
        });
      });

      wallet.setShieldedCryptoProvider(makeCryptoProvider());
      await until(() => seen.length > 0, 'the event');
      await settle();

      expect(seen).toEqual([
        {
          state: HathorWallet.READY,
          level: 'full',
          address: (await wallet.getCurrentAddress({}, { legacy: false })).address,
          balance: 50n,
        },
      ]);
      await wallet.stop();
    }, 60000);

    it('the mobile seed flow: a start with the PIN, a reload with a stale PIN, an unlock and a stop', async () => {
      // One tx pays 100 to the wallet's first address and 50 to its first shielded address.
      let firstAddress = '';
      const history = () => {
        const tx = structuredClone(shieldedTx(TX_SYNCED, OPENS_50));
        return [
          {
            ...tx,
            outputs: [
              {
                value: 100n,
                token_data: 0,
                token: NATIVE_TOKEN_UID,
                script: '',
                spent_by: null,
                decoded: { type: 'P2PKH', address: firstAddress, timelock: null },
              },
            ],
          } as unknown as ReturnType<typeof shieldedTx>,
        ];
      };
      const NEW_PIN = '777';
      const first = await makeWallet({ history });

      // The first start, with the PIN.
      await first.wallet.start({ pinCode: PIN, password: PASSWORD });
      // Derived once start() set the network.
      firstAddress = (await addressUtils.deriveAddressP2PKH(0, first.storage)).base58;
      await sync(first.wallet);
      expect(verdictOf(await first.wallet.getShieldedCapability())).toEqual({
        level: 'full',
        reason: null,
        cause: null,
      });
      expect(await htrBalance(first.wallet)).toBe(150n);

      // The PIN changes, and the app reloads the wallet: it stops the old one and
      // starts a new one, on a new Storage over the same store, with the old PIN.
      await first.storage.changePin(PIN, NEW_PIN);
      await first.wallet.stop();
      const storage = new Storage(first.storage.store);
      const wallet = new HathorWallet({
        seed: SEED,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: makeConn() as any,
        storage,
        password: PASSWORD,
        scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 },
        logger: makeLogger(),
      });
      wallet.setShieldedCryptoProvider(makeCryptoProvider());
      await expect(wallet.start({ pinCode: PIN, password: PASSWORD })).resolves.toEqual({
        network: 'testnet',
      });
      await sync(wallet);

      // The transparent side works; the shielded output is counted locked.
      expect(await wallet.getShieldedCapability()).toMatchObject({
        level: 'watch',
        reason: 'locked',
        cause: 'wrong-pin',
        undecoded: { txIds: [TX_SYNCED], locked: 1 },
      });
      expect(await htrBalance(wallet)).toBe(100n);
      // The first address was used, so the wallet gives out the next one.
      await expect(wallet.getCurrentAddress()).resolves.toMatchObject({ index: 1 });
      await expect(wallet.getCurrentAddress({}, { legacy: false })).rejects.toMatchObject({
        errorCode: 'shielded-locked',
      });

      // The lock screen gives the current PIN.
      const { capability, reprocessed } = await wallet.unlockShieldedView({ pinCode: NEW_PIN });
      expect(capability.level).toBe('full');
      expect(await reprocessed).toMatchObject({
        level: 'full',
        undecoded: { txIds: [], locked: 0, unreadable: 0, error: 0 },
      });
      expect(await htrBalance(wallet)).toBe(150n);

      await wallet.stop();
      expect(verdictOf(await wallet.getShieldedCapability())).toEqual({
        level: 'none',
        reason: 'not-started',
        cause: null,
      });
      expect(shieldedOf(storage).hasKey).toBe(false);
      expect(shieldedOf(first.storage).hasKey).toBe(false);
    }, 60000);
  });
});

describe('multisig wallets and shielded keys', () => {
  // Seed derivation and real shielded EC derivation run here, which jest's vm
  // sandbox slows down.
  const TEST_TIMEOUT = 60000;
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const multisig = {
    pubkeys: [
      walletUtils.getMultiSigXPubFromWords(seed, { networkName: 'testnet' }),
      new bitcore.HDPrivateKey().xpubkey,
      new bitcore.HDPrivateKey().xpubkey,
    ],
    numSignatures: 2,
  };
  const SHIELDED_FIELDS = ['scanXpubkey', 'scanMainKey', 'spendXpubkey', 'spendMainKey'];
  const walletTypes = [
    { walletType: WalletType.P2PKH, walletMultisig: undefined, hasKeys: true },
    { walletType: WalletType.MULTISIG, walletMultisig: multisig, hasKeys: false },
  ];
  // The refusal carries its reason in errorCode, and its message says why.
  const MULTISIG_REFUSAL = {
    name: 'ShieldedKeyError',
    errorCode: 'shielded-multisig',
    message: expect.stringMatching(
      /^A multisig wallet has no shielded addresses: its shielded keys are single-signature keys/
    ),
  };
  // The shielded chain needs a registered provider; nothing is decoded here.
  const provider = { id: 'mock' } as unknown as IShieldedCryptoProvider;

  function shieldedFieldsOf(accessData: object | null): string[] {
    return SHIELDED_FIELDS.filter(field => accessData !== null && field in accessData);
  }

  /**
   * A wallet that start() can run on `storage` without a fullnode.
   */
  function startableWallet(storage: Storage) {
    jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
      resolve({ network: 'testnet' });
    });
    const hWallet = new FakeHathorWallet();
    hWallet.storage = storage;
    hWallet.conn = {
      network: 'testnet',
      getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
      on: jest.fn(),
      start: jest.fn(),
      getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
    };
    hWallet.getTokenData = jest.fn();
    hWallet.setState = jest.fn();
    // start() queues the 'shielded-capability' event.
    hWallet.shieldedCapabilityEmitted = null;
    hWallet.shieldedCapabilityCheckQueued = false;
    hWallet.shieldedCapabilityChecks = Promise.resolve();
    hWallet.emit = jest.fn();
    return hWallet;
  }

  describe('start()', () => {
    it.each(walletTypes)(
      '$walletType wallet started from a seed: shielded keys saved: $hasKeys',
      async ({ walletType, walletMultisig, hasKeys }) => {
        const storage = new Storage(new MemoryStore());
        const hWallet = startableWallet(storage);
        hWallet.seed = seed;
        hWallet.multisig = walletMultisig;

        await hWallet.start({ pinCode: '123', password: '456' });

        const accessData = await storage.getAccessData();
        expect(accessData!.walletType).toBe(walletType);
        expect(shieldedFieldsOf(accessData)).toEqual(hasKeys ? SHIELDED_FIELDS : []);
      },
      TEST_TIMEOUT
    );

    it.each(walletTypes)(
      '$walletType wallet started from a root xpriv: shielded keys saved: $hasKeys',
      async ({ walletType, walletMultisig, hasKeys }) => {
        const storage = new Storage(new MemoryStore());
        const hWallet = startableWallet(storage);
        hWallet.xpriv = walletUtils.getXPrivKeyFromSeed(seed, { networkName: 'testnet' }).xprivkey;
        hWallet.multisig = walletMultisig;

        await hWallet.start({ pinCode: '123', password: '456' });

        const accessData = await storage.getAccessData();
        expect(accessData!.walletType).toBe(walletType);
        expect(shieldedFieldsOf(accessData)).toEqual(hasKeys ? SHIELDED_FIELDS : []);
      },
      TEST_TIMEOUT
    );

    it.each(walletTypes)(
      '$walletType record that predates shielded support: the migration adds shielded keys: $hasKeys',
      async ({ walletType, walletMultisig, hasKeys }) => {
        const {
          scanXpubkey: _scanXpubkey,
          scanMainKey: _scanMainKey,
          spendXpubkey: _spendXpubkey,
          spendMainKey: _spendMainKey,
          ...preShielded
        } = walletUtils.generateAccessDataFromSeed(seed, {
          pin: '123',
          password: '456',
          networkName: 'testnet',
          multisig: walletMultisig,
        });
        const storage = new Storage(new MemoryStore());
        await storage.saveAccessData(preShielded);
        const saveSpy = jest.spyOn(storage, 'saveAccessData');
        const hWallet = startableWallet(storage);
        hWallet.seed = seed;
        hWallet.multisig = walletMultisig;

        await hWallet.start({ pinCode: '123', password: '456' });

        const accessData = await storage.getAccessData();
        expect(accessData!.walletType).toBe(walletType);
        expect(shieldedFieldsOf(accessData)).toEqual(hasKeys ? SHIELDED_FIELDS : []);
        expect(saveSpy).toHaveBeenCalledTimes(hasKeys ? 1 : 0);
        expect(hWallet.conn.start).toHaveBeenCalled();
      },
      TEST_TIMEOUT
    );
  });

  describe('shielded addresses', () => {
    const p2pkhRecord = walletUtils.generateAccessDataFromSeed(seed, {
      pin: '123',
      password: '456',
      networkName: 'testnet',
    });
    // A multisig record that an older version gave the shielded keys of its
    // root, which are the keys of the P2PKH record of the same seed.
    const olderMultisigRecord = {
      ...walletUtils.generateAccessDataFromSeed(seed, {
        pin: '123',
        password: '456',
        networkName: 'testnet',
        multisig,
      }),
      scanXpubkey: p2pkhRecord.scanXpubkey,
      scanMainKey: p2pkhRecord.scanMainKey,
      spendXpubkey: p2pkhRecord.spendXpubkey,
      spendMainKey: p2pkhRecord.spendMainKey,
    };

    /**
     * The shielded pair the record's shielded xpubs derive at `index`.
     */
    function shieldedPairAt(record: typeof p2pkhRecord, index: number, networkName: string) {
      return addressUtils.deriveShieldedAddressPair(
        record.scanXpubkey!,
        record.spendXpubkey!,
        index,
        networkName
      );
    }

    /**
     * A wallet on `record`, with a crypto provider and the addresses of indexes
     * 0 and 1 in its storage: the legacy addresses, and the shielded pairs of
     * the record's shielded xpubs, which older versions stored for multisig
     * wallets too.
     */
    async function walletOn(record: typeof p2pkhRecord) {
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(record);
      await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 20 });
      storage.setShieldedCryptoProvider(provider);
      const networkName = storage.config.getNetwork().name;
      await storageUtils.savePrecalculatedShieldedAddresses(
        storage,
        [0, 1].map(index => {
          const { shieldedAddress, spendAddress } = shieldedPairAt(record, index, networkName);
          return {
            bip32AddressIndex: index,
            shieldedBase58: shieldedAddress.base58,
            spendBase58: spendAddress.base58,
            scanPubkey: shieldedAddress.publicKey!,
            spendPubkey: spendAddress.publicKey!,
          };
        })
      );
      await storageUtils.loadAddresses(0, 2, storage);
      const hWallet = new FakeHathorWallet();
      hWallet.storage = storage;
      return { hWallet, storage, networkName };
    }

    it(
      'a P2PKH wallet gives out its shielded addresses',
      async () => {
        const { hWallet, storage, networkName } = await walletOn(p2pkhRecord);
        // A started wallet, with the scan key start() unlocks in memory: the
        // current shielded address is given out at the levels view and full only.
        storage.shieldedView.started = true;
        storage.scanXPrivKey = await unlockScanXPrivKey(storage, '123');
        const shielded0 = shieldedPairAt(p2pkhRecord, 0, networkName).shieldedAddress.base58;
        const shielded1 = shieldedPairAt(p2pkhRecord, 1, networkName).shieldedAddress.base58;

        await expect(hWallet.getAddressAtIndex(0, { legacy: false })).resolves.toBe(shielded0);
        // An index that is not stored is derived.
        await expect(hWallet.getAddressAtIndex(5, { legacy: false })).resolves.toBe(
          shieldedPairAt(p2pkhRecord, 5, networkName).shieldedAddress.base58
        );
        await expect(hWallet.getCurrentAddress({}, { legacy: false })).resolves.toMatchObject({
          address: shielded0,
          index: 0,
        });
        await expect(hWallet.getNextAddress({ legacy: false })).resolves.toMatchObject({
          address: shielded1,
          index: 1,
        });
        const all = await hWallet.getAllAddresses({ legacy: false }).next();
        expect(all.value).toMatchObject({ address: shielded0, index: 0 });
        expect((await storage.getWalletData()).shieldedCurrentAddressIndex).toBe(1);
      },
      TEST_TIMEOUT
    );

    it(
      'a multisig wallet refuses every shielded address, also the ones an older version stored',
      async () => {
        const { hWallet, storage } = await walletOn(olderMultisigRecord);
        // A started wallet: before start(), the current shielded address is
        // refused as not started, whatever the wallet type.
        storage.shieldedView.started = true;
        // The pairs are in the store.
        expect(await storage.getAddressAtIndex(0, { legacy: false })).not.toBeNull();

        await expect(hWallet.getAddressAtIndex(0, { legacy: false })).rejects.toThrow(
          ShieldedKeyError
        );
        await expect(hWallet.getAddressAtIndex(0, { legacy: false })).rejects.toMatchObject(
          MULTISIG_REFUSAL
        );
        await expect(hWallet.getAddressAtIndex(5, { legacy: false })).rejects.toMatchObject(
          MULTISIG_REFUSAL
        );
        await expect(hWallet.getCurrentAddress({}, { legacy: false })).rejects.toMatchObject(
          MULTISIG_REFUSAL
        );
        await expect(hWallet.getNextAddress({ legacy: false })).rejects.toMatchObject(
          MULTISIG_REFUSAL
        );
        await expect(hWallet.getAllAddresses({ legacy: false }).next()).rejects.toMatchObject(
          MULTISIG_REFUSAL
        );
        // No refusal moved the shielded cursor.
        expect((await storage.getWalletData()).shieldedCurrentAddressIndex).toBe(0);
      },
      TEST_TIMEOUT
    );

    it(
      'a multisig wallet created without shielded keys refuses shielded addresses for the same reason',
      async () => {
        const storage = new Storage(new MemoryStore());
        await storage.saveAccessData(
          walletUtils.generateAccessDataFromSeed(seed, {
            pin: '123',
            password: '456',
            networkName: 'testnet',
            multisig,
          })
        );
        storage.setShieldedCryptoProvider(provider);
        const hWallet = new FakeHathorWallet();
        hWallet.storage = storage;

        await expect(hWallet.getAddressAtIndex(0, { legacy: false })).rejects.toMatchObject(
          MULTISIG_REFUSAL
        );
      },
      TEST_TIMEOUT
    );

    it(
      'a multisig wallet gives out its legacy addresses as before',
      async () => {
        const { hWallet, storage, networkName } = await walletOn(olderMultisigRecord);
        const legacy0 = addressUtils.deriveAddressFromDataP2SH(
          olderMultisigRecord.multisigData!,
          0,
          networkName
        ).base58;
        expect((await storage.getAddressAtIndex(0))!.base58).toBe(legacy0);

        await expect(hWallet.getAddressAtIndex(0)).resolves.toBe(legacy0);
        // An index that is not stored is derived.
        await expect(hWallet.getAddressAtIndex(5)).resolves.toBe(
          addressUtils.deriveAddressFromDataP2SH(olderMultisigRecord.multisigData!, 5, networkName)
            .base58
        );
        await expect(hWallet.getCurrentAddress()).resolves.toMatchObject({
          address: legacy0,
          index: 0,
        });
        // A legacy flag that is not false, as an untyped caller may pass, reads
        // the legacy chain: the refusal and the store pick the same chain, so
        // the shielded pairs in the store are not given out.
        const notFalse = { legacy: 0 as unknown as boolean };
        await expect(hWallet.getAddressAtIndex(0, notFalse)).resolves.toBe(legacy0);
        await expect(hWallet.getAllAddresses(notFalse).next()).resolves.toMatchObject({
          value: { address: legacy0, index: 0 },
        });
      },
      TEST_TIMEOUT
    );

    /**
     * A store that keeps its contents across sessions, as an older version left
     * it: the shielded pairs, and a history it decoded and credited.
     */
    describe('start() on what an older version stored', () => {
      const TX_ID = 'ab00ee11ff22003344556677889900aabbccddeeff00112233445566778899aa';

      /**
       * A tx that pays 50 to `legacyAddress` and, when `spendAddress` is given,
       * 77 in a shielded output that an older version decoded.
       */
      function txPaying(legacyAddress: string, spendAddress?: string): IHistoryTx {
        return {
          tx_id: TX_ID,
          version: 1,
          timestamp: 1,
          is_voided: false,
          nonce: 0,
          weight: 1,
          parents: [],
          inputs: [],
          height: 100,
          tokens: [],
          outputs: [
            {
              value: 50n,
              token_data: 0,
              token: NATIVE_TOKEN_UID,
              decoded: { address: legacyAddress, timelock: null },
              script: '',
              spent_by: null,
            },
          ],
          shielded_outputs: spendAddress
            ? [
                {
                  mode: ShieldedOutputMode.AMOUNT_SHIELDED,
                  commitment: 'aa'.repeat(33),
                  range_proof: 'bb'.repeat(10),
                  script: '',
                  token_data: 0,
                  ephemeral_pubkey: 'cc'.repeat(33),
                  decoded: { address: spendAddress, timelock: null },
                  spent_by: null,
                  // What the decode of the older version wrote.
                  value: 77n,
                  token: NATIVE_TOKEN_UID,
                  blindingFactor: 'dd'.repeat(32),
                },
              ]
            : [],
        } as unknown as IHistoryTx;
      }

      async function unlockedHtrOf(hWallet: Pick<HathorWallet, 'getBalance'>): Promise<bigint> {
        const [balance] = await hWallet.getBalance(NATIVE_TOKEN_UID);
        return balance.balance.unlocked;
      }

      it.each([
        { walletType: WalletType.P2PKH, record: p2pkhRecord, drops: false },
        { walletType: WalletType.MULTISIG, record: olderMultisigRecord, drops: true },
      ])(
        '$walletType wallet: the shielded pairs and the history credited with them are dropped: $drops',
        async ({ record, drops }) => {
          const { storage, networkName } = await walletOn(record);
          const legacy0 = (await storage.getAddressAtIndex(0))!.base58;
          const legacy1 = (await storage.getAddressAtIndex(1))!.base58;
          const spend0 = shieldedPairAt(record, 0, networkName).spendAddress.base58;
          await storage.store.saveTx(txPaying(legacy0, spend0));
          await storage.processHistory();
          const accessData = JSON.parse(JSON.stringify(await storage.getAccessData()));
          const hWallet = startableWallet(storage);
          // The legacy addresses are injected again, as an app does on each start.
          hWallet.preCalculatedAddresses = [legacy0, legacy1];
          // What the older version left: the shielded output is credited.
          expect(await unlockedHtrOf(hWallet)).toBe(127n);

          await hWallet.start({ pinCode: '123', password: '456' });

          // The shielded pairs, also for the Storage address reads.
          expect(await storage.store.addressCount({ legacy: false })).toBe(drops ? 0 : 2);
          expect((await storage.getAddressAtIndex(0, { legacy: false })) === null).toBe(drops);
          expect(await storage.isAddressMine(spend0)).toBe(!drops);
          // The history and what was credited with it. The first sync loads the
          // history of the legacy chain again.
          expect((await storage.getTx(TX_ID)) === null).toBe(drops);
          expect((await storage.store.getUtxo({ txId: TX_ID, index: 1 })) === null).toBe(drops);
          expect(await unlockedHtrOf(hWallet)).toBe(drops ? 0n : 127n);
          expect((await hWallet.getShieldedUnblindingForTx(TX_ID)).outputs).toHaveLength(
            drops ? 0 : 1
          );
          // The record is kept as it was, and the injected legacy addresses are saved.
          expect(JSON.parse(JSON.stringify(await storage.getAccessData()))).toEqual(accessData);
          expect((await storage.getAddressAtIndex(0))!.base58).toBe(legacy0);
          expect((await storage.getAddressAtIndex(1))!.base58).toBe(legacy1);
          expect(hWallet.conn.start).toHaveBeenCalled();
        },
        TEST_TIMEOUT
      );

      it(
        'a multisig wallet whose store holds no shielded address keeps its history',
        async () => {
          // The record holds the shielded keys an older version gave it, but no
          // shielded pair was stored.
          const storage = new Storage(new MemoryStore());
          await storage.saveAccessData(olderMultisigRecord);
          await storageUtils.loadAddresses(0, 2, storage);
          const legacy0 = (await storage.getAddressAtIndex(0))!.base58;
          await storage.store.saveTx(txPaying(legacy0));
          await storage.processHistory();
          const cleanSpy = jest.spyOn(storage, 'cleanStorage');
          const hWallet = startableWallet(storage);

          await hWallet.start({ pinCode: '123', password: '456' });

          expect(cleanSpy).not.toHaveBeenCalled();
          expect(await storage.getTx(TX_ID)).not.toBeNull();
          expect(await unlockedHtrOf(hWallet)).toBe(50n);
        },
        TEST_TIMEOUT
      );
    });
  });
});
