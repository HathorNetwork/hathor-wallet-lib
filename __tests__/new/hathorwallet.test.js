/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../src/new/wallet';
import { WalletFromXPubGuard } from '../../src/errors';
import Transaction from '../../src/models/transaction';
import Input from '../../src/models/input';
import { DEFAULT_TX_VERSION, P2PKH_ACCT_PATH } from '../../src/constants';
import { HDPrivateKey } from 'bitcore-lib';
import transactionUtils from '../../src/utils/transaction';
import { MemoryStore, Storage } from '../../src/storage';
import Queue from '../../src/models/queue';
import { WalletType } from '../../src/types';

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
  const xpriv = new HDPrivateKey();
  jest.spyOn(storage, 'isReadonly').mockReturnValue(Promise.resolve(false));
  jest.spyOn(storage, 'getMainXPrivKey').mockReturnValue(Promise.resolve(xpriv.xprivkey));

  const hWallet = new FakeHathorWallet();
  hWallet.storage = storage;
  hWallet.getWalletInputInfo.mockReturnValue(Promise.resolve([
    {
      inputIndex: 0,
      addressIndex: 0,
    },
    {
      inputIndex: 5,
      addressIndex: 5,      
    }
  ]));
  const mockGetSig = jest.spyOn(transactionUtils, 'getSignature').mockReturnValue(Buffer.from('cafe', 'hex'));
  const tx = {
    getDataToSignHash: jest.fn().mockReturnValue(Buffer.from('d00d', 'hex')),
  }
  const signatures = await hWallet.getSignatures(tx, {pinCode: '123'});
  expect(signatures.length).toEqual(2);
  expect(signatures[0]).toMatchObject({
    signature: 'cafe',
    pubkey: xpriv.deriveNonCompliantChild(0).publicKey.toString(),
    inputIndex: 0,
    addressIndex: 0,
  });
  expect(signatures[1]).toMatchObject({
    signature: 'cafe',
    pubkey: xpriv.deriveNonCompliantChild(5).publicKey.toString(),
    inputIndex: 5,
    addressIndex: 5,
  });

  mockGetSig.mockRestore();
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
  }
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