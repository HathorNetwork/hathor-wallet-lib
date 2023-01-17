/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mockAxiosAdapter } from '../__mocks__/wallet.mock';
import { Message } from 'bitcore-lib';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import {
  GetAddressesObject,
  WsTransaction,
  CreateWalletAuthData,
} from '../../src/wallet/types';
// import axios from 'axios';
import config from '../../src/config';
// import MockAdapter from 'axios-mock-adapter';
// import axiosInstance from '../../src/wallet/api/walletServiceAxios';
import { buildSuccessTxByIdTokenDataResponse, buildWalletToAuthenticateApiCall, defaultWalletSeed } from '../__mock_helpers/wallet-service.fixtures';
import Mnemonic from 'bitcore-mnemonic';
import storage from '../../src/storage';
import { TxNotFoundError } from '../../src/errors';

const MOCK_TX = {
  tx_id: '0009bc9bf8eab19c41a2aa9b9369d3b6a90ff12072729976634890d35788d5d7',
  nonce: 194,
  timestamp: 1640451232,
  version: 1,
  weight: 8.000001,
  parents: [
    '00000e0dada0a1512c61778cad7075e8a2c7109eb35d63199f3c986ead092684',
    '0000000090a41f17769a5acae74f98c96b0c3041c5149a9e6bbfb2d32d85997c'
  ],
  inputs: [],
  outputs: [],
};

afterEach(() => {
  jest.clearAllMocks();
});

test('getTxBalance', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  const getAllAddressesMock = async function* () {
    const addresses: GetAddressesObject[] = [{
      address: 'address0',
      index: 0,
      transactions: 0,
    }, {
      address: 'address1',
      index: 1,
      transactions: 0,
    }, {
      address: 'address2',
      index: 2,
      transactions: 0,
    }];

    for (const address of addresses) {
      yield address;
    }
  };

  const spy = jest.spyOn(wallet, 'getAllAddresses')
  .mockImplementation(getAllAddressesMock);

  let tx: WsTransaction = {
    ...MOCK_TX,
    inputs: [{
      'value': 500,
      'token_data': 1,
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'token': 'token1',
      'decoded': {
        'type': 'P2PKH',
        'address': 'address0',
        'timelock': null,
      },
      'tx_id': '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      'index': 0
    }],
    outputs: [{
      'value': 200,
      'token_data': 1,
      'token': 'token1',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'address1',
        'timelock': null,
      }
    }, {
      'value': 300,
      'token_data': 1,
      'token': 'token1',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'other-address',
        'timelock': null,
      }
    }],
  };

  let balance = await wallet.getTxBalance(tx);

  expect(balance['token1']).toStrictEqual(-300);

  tx = {
    ...MOCK_TX,
    inputs: [{
      'value': 500,
      'token_data': 1,
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'token': 'token1',
      'decoded': {
        'type': 'P2PKH',
        'address': 'address0',
        'timelock': null,
      },
      'tx_id': '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      'index': 0
    }],
    outputs: [{
      'value': 200,
      'token_data': 1,
      'token': 'token1',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'address1',
        'timelock': null,
      }
    }, {
      'value': 300,
      'token_data': 1,
      'token': 'token1',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'address2',
        'timelock': null,
      }
    }],
  };

  balance = await wallet.getTxBalance(tx);
  expect(balance['token1']).toStrictEqual(0);

  // multiple tokens in the same transaction
  tx = {
    ...MOCK_TX,
    inputs: [{
      'value': 500,
      'token_data': 1,
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'token': 'token1',
      'decoded': {
        'type': 'P2PKH',
        'address': 'address0',
        'timelock': null,
      },
      'tx_id': '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      'index': 0
    }, {
      'value': 10,
      'token_data': 1,
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'token': 'token2',
      'decoded': {
        'type': 'P2PKH',
        'address': 'address0',
        'timelock': null,
      },
      'tx_id': '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      'index': 2
    }],
    outputs: [{
      'value': 200,
      'token_data': 1,
      'token': 'token1',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'address1',
        'timelock': null,
      }
    }, {
      'value': 300,
      'token_data': 1,
      'token': 'token1',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'address2',
        'timelock': null,
      }
    }, { // change
      'value': 5,
      'token_data': 1,
      'token': 'token2',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'address2',
        'timelock': null,
      }
    }, {
      'value': 5,
      'token_data': 1,
      'token': 'token2',
      'script': 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
      'spent_by': null,
      'decoded': {
        'type': 'P2PKH',
        'address': 'other-address',
        'timelock': null,
      }
    }],
  };

  balance = await wallet.getTxBalance(tx);
  expect(balance['token1']).toStrictEqual(0);
  expect(balance['token2']).toStrictEqual(-5);
});

test('checkAddressesMine', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  jest.spyOn(wallet, 'validateAndRenewAuthToken')
  .mockImplementation(jest.fn());

  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      address1: true,
      address2: false,
      address3: false,
    },
  });

  const walletAddressMap = await wallet.checkAddressesMine(['address1', 'address2', 'address3']);

  expect(walletAddressMap.address1).toStrictEqual(true);
  expect(walletAddressMap.address2).toStrictEqual(false);
  expect(walletAddressMap.address3).toStrictEqual(false);

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(400, {
    success: false,
  });

  await expect(wallet.checkAddressesMine(['address1', 'address2', 'address3'])).rejects.toThrowError('Error checking wallet addresses.');
});

test('generateCreateWalletAuthData should return correct auth data', async () => {
  const requestPassword = jest.fn();

  jest.spyOn(Date, 'now').mockImplementation(() => 10000);

  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const pin = '123456';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  const authData: CreateWalletAuthData = await wallet.generateCreateWalletAuthData(pin);
  const timestampNow = Math.floor(Date.now() / 1000); // in seconds

  // these are deterministic, so we can avoid using the lib's methods to generate them
  const xpub = 'xpub6D2LLyX98BCEkbTHsE14kgP6atagb9TR3ZBvHYQrT9yEUDYeHVBmrnnyWo3u2cADp4upagFyuu5msxtosceN1FykN22oa41o3fMEJmFG766';
  // const xprivAccountPath = 'tnpr4ugT6rZcxFWFVXBpx3YX4eS5LnUwEzGAvfbzQ9tGst2MTBjijC783X5g2LMfxPrbLJxTPHJ99nB6qDbcqehfXDVTtA33cpn49ZuA6s6WQWP';
  const walletId = '83f704d8b24d4f9cc252b080b008280bf4b3342065f7b4baee43fd0ec7186db7';
  const authXpub = 'xpub6AyEt1FdSvP2mXsZfJ4SLHbMugNMQVNdtkhzWoF6nQSSXcstiqEZDXd4Jg7XBscM2K9YMt2ubWXChYXMTAPS99E8Wot1tcMtyfJhhKLZLok';
  // const authXprivKey = 'tnpr4sdMdtJ7Gzh3WTc6k7bteFeLfaGc4LBPms84dQiXD8VZWb4yAY9uQFukpEaJLMpqBds8UUiamnmJWYQt97a3qGqZ5dv7yy3fWERia6CAXNh';
  const firstAddress = 'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX';
  const xpubAddress = 'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu';
  const authXpubAddress = 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM';

  // const privKeyAccountPath: HDPrivateKey = new HDPrivateKey(xprivAccountPath);
  // const authDerivedPrivKey: HDPrivateKey = new HDPrivateKey(authXprivKey);

  const xpubMessage = new Message(String(timestampNow).concat(walletId).concat(xpubAddress));
  const authXpubMessage = new Message(String(timestampNow).concat(walletId).concat(authXpubAddress));

  expect(authData.xpub).toBe(xpub);
  expect(authData.authXpub).toBe(authXpub);
  expect(authData.timestampNow).toBe(timestampNow);
  expect(authData.firstAddress).toBe(firstAddress);
  expect(xpubMessage.verify(xpubAddress, authData.xpubkeySignature)).toBe(true);
  expect(authXpubMessage.verify(authXpubAddress, authData.authXpubkeySignature)).toBe(true);
});

test('getTxById', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  spyOn(wallet, 'isReady').and.returnValue(true);

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onGet('wallet/transactions/123')
    .replyOnce(200, buildSuccessTxByIdTokenDataResponse())
    .onGet('wallet/transactions/123')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [{ message: 'vida', path: ['txId'] }],
    });

  const successCall = wallet.getTxById('123');

  await expect(successCall).resolves.toStrictEqual({
    success: true,
    txTokens: [
      {
        balance: 10,
        height: 1,
        timestamp: 10,
        tokenId: 'token1',
        tokenName: 'Token 1',
        tokenSymbol: 'T1',
        txId: 'txId1',
        version: 3,
        voided: false,
        weight: 65.4321,
      },
      {
        balance: 7,
        height: 1,
        timestamp: 10,
        tokenId: 'token2',
        tokenName: 'Token 2',
        tokenSymbol: 'T2',
        txId: 'txId1',
        version: 3,
        voided: false,
        weight: 65.4321,
      },
    ],
  });

  const invalidCall = wallet.getTxById('123');

  await expect(invalidCall).rejects.toThrowError('Error getting transaction by its id.');
});

test('prepareDelegateAuthorityData', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ]

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  const code = new Mnemonic(seed);
  const xpriv = code.toHDPrivateKey('', network.getNetwork());

  wallet.setState('Ready');

  const getUtxosMock = async () => ({
    utxos: [{
      txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      index: 0,
      tokenId: '00',
      address: addresses[0],
      value: 1,
      authorities: 1,
      timelock: null,
      heightlock: null,
      locked: false,
      addressPath: 'm/280\'/280\'/0/1/0',
    }],
    changeAmount: 4,
  });
  const getXprivKeyMock = () => xpriv.xprivkey;
  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);

  const spy1 = jest.spyOn(wallet, 'getUtxos').mockImplementation(getUtxosMock);
  const spy2 = jest.spyOn(storage, 'getMainXPrivKey').mockImplementation(getXprivKeyMock);
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);

  // createAnother option should create another authority utxo to the given address
  const delegate1 = await wallet.prepareDelegateAuthorityData('00', 'mint', addresses[1], {
    anotherAuthorityAddress: addresses[2],
    createAnother: true,
    pinCode: '123456',
  });

  expect(delegate1.outputs).toHaveLength(2);

  // if we don't pass createAnother, we should not create another authority utxo
  const delegate2 = await wallet.prepareDelegateAuthorityData('00', 'mint', addresses[1], {
    anotherAuthorityAddress: addresses[2],
    createAnother: false,
    pinCode: '123456',
  });

  expect(delegate2.outputs).toHaveLength(1);

  await expect(wallet.prepareDelegateAuthorityData('00', 'mint', addresses[1], {
    anotherAuthorityAddress: 'invalid-address',
    createAnother: true,
    pinCode: '123456',
  })).rejects.toThrowError('Address invalid-address is not valid.');

  await expect(wallet.prepareDelegateAuthorityData('00', 'mint', addresses[1], {
    anotherAuthorityAddress: addresses[2],
    createAnother: false,
    pinCode: null,
  })).rejects.toThrowError('PIN not specified in prepareDelegateAuthorityData options');

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
});

test('prepareDelegateAuthorityData should fail if type is invalid', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  wallet.setState('Ready');

  // createAnother option should create another authority utxo to the given address
  await expect(wallet.prepareDelegateAuthorityData('00', 'explode', 'addr1', {
    anotherAuthorityAddress: 'addr2',
    createAnother: true,
    pinCode: '123456',
  })).rejects.toThrowError('Type options are mint and melt for delegate authority method.');
});

test('delegateAuthority should throw if wallet is not ready', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  await expect(wallet.delegateAuthority('00', 'mint', 'address1', {
    createAnother: false,
    anotherAuthorityAddress: null,
    pinCode: '123456',
  })).rejects.toThrowError('Wallet not ready');
});

test('prepareDestroyAuthority', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ]

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  const code = new Mnemonic(seed);
  const xpriv = code.toHDPrivateKey('', network.getNetwork());

  wallet.setState('Ready');

  const getUtxosMock = async () => ({
    utxos: [{
      txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      index: 0,
      tokenId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
      address: addresses[0],
      value: 1,
      authorities: 1,
      timelock: null,
      heightlock: null,
      locked: false,
      addressPath: 'm/280\'/280\'/0/1/0',
    }],
    changeAmount: 4,
  });
  const getXprivKeyMock = () => xpriv;
  const getInputDataMock = () => Buffer.from([]);

  const spy1 = jest.spyOn(wallet, 'getUtxos').mockImplementation(getUtxosMock);
  const spy2 = jest.spyOn(storage, 'getMainXPrivKey').mockImplementation(getXprivKeyMock);
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);

  // createAnother option should create another authority utxo to the given address
  const delegate1 = await wallet.prepareDestroyAuthorityData('00', 'mint', 1, {
    pinCode: '123456',
  });

  expect(delegate1.outputs).toHaveLength(0);
  expect(delegate1.inputs).toHaveLength(1);
  expect(delegate1.inputs[0].hash).toStrictEqual('002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f');

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();  
});

test('destroyAuthority should throw if wallet is not ready', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  await expect(wallet.destroyAuthority('00', 'mint', 1, {
    pinCode: '123456',
  })).rejects.toThrowError('Wallet not ready');
});

test('getFullTxById', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  wallet.setState('Ready');

  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx1').reply(200, {
    success: true,
    tx: { hash: 'tx1' },
    meta: {},
  });

  const proxiedTx = await wallet.getFullTxById('tx1');

  expect(proxiedTx.tx.hash).toStrictEqual('tx1');

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx2').reply(400, {});
  await expect(wallet.getFullTxById('tx2')).rejects.toThrowError('Error getting transaction by its id from the proxied fullnode.');

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx3').reply(200, { success: false, message: 'Transaction not found' });
  await expect(wallet.getFullTxById('tx3')).rejects.toThrowError(TxNotFoundError);
});

test('getTxConfirmationData', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  wallet.setState('Ready');

  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  const mockData = {
    success: true,
    accumulated_weight: 67.45956109191802,
    accumulated_bigger: true,
    stop_value: 67.45416781056525,
    confirmation_level: 1,
  };

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx1/confirmation_data').reply(200, mockData);

  const proxiedConfirmationData = await wallet.getTxConfirmationData('tx1');

  expect(proxiedConfirmationData).toStrictEqual(mockData);

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx1/confirmation_data').reply(400, '');
  await expect(wallet.getTxConfirmationData('tx1')).rejects.toThrowError('Error getting transaction confirmation data by its id from the proxied fullnode.');

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx2/confirmation_data').reply(200, { success: false, message: 'Transaction not found' });
  await expect(wallet.getTxConfirmationData('tx2')).rejects.toThrowError(TxNotFoundError);
});

test('graphvizNeighborsQuery', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  wallet.setState('Ready');

  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  const mockData = 'digraph {}';

  mockAxiosAdapter.onGet('wallet/proxy/graphviz/neighbours?txId=tx1&graphType=test&maxLevel=1').reply(200, mockData);

  const proxiedGraphvizResponse = await wallet.graphvizNeighborsQuery('tx1', 'test', 1);

  expect(proxiedGraphvizResponse).toStrictEqual(mockData);

  mockAxiosAdapter.onGet('wallet/proxy/graphviz/neighbours?txId=tx1&graphType=test&maxLevel=1').reply(500, '');
  // Axios will throw on 500 status code
  await expect(wallet.graphvizNeighborsQuery('tx1', 'test', 1)).rejects.toThrowError('Request failed with status code 500');

  mockAxiosAdapter.onGet('wallet/proxy/graphviz/neighbours?txId=tx2&graphType=test&maxLevel=1').reply(200, { success: false, message: 'Transaction not found' });
  await expect(wallet.graphvizNeighborsQuery('tx2', 'test', 1)).rejects.toThrowError(TxNotFoundError);
});
