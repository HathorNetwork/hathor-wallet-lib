/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Message } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { mockAxiosAdapter } from '../__mock_helpers__/axios-adapter.mock';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import {
  GetAddressesObject,
  WsTransaction,
  CreateWalletAuthData,
  AddressInfoObject,
} from '../../src/wallet/types';
import config from '../../src/config';
import {
  buildSuccessTxByIdTokenDataResponse,
  buildWalletToAuthenticateApiCall,
  defaultWalletSeed,
} from '../__mock_helpers__/wallet-service.fixtures';
import {
  TxNotFoundError,
  SendTxError,
  UninitializedWalletError,
  WalletRequestError,
} from '../../src/errors';
import SendTransactionWalletService from '../../src/wallet/sendTransactionWalletService';
import transaction from '../../src/utils/transaction';
import {
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
  WALLET_SERVICE_AUTH_DERIVATION_PATH,
} from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import { decryptData, verifyMessage } from '../../src/utils/crypto';
import { IHistoryTx } from '../../src/types';

// Mock SendTransactionWalletService class so we don't try to send actual transactions
// TODO: We should refactor the way we use classes from inside other classes. Using dependency injection would facilitate unit tests a lot and avoid mocks like this.
jest.mock('../../src/wallet/sendTransactionWalletService', () => {
  return jest.fn().mockImplementation(() => {
    return { run: () => {} };
  });
});

const addressPath = "m/280'/280'/0/1/0";

const MOCK_TX = {
  tx_id: '0009bc9bf8eab19c41a2aa9b9369d3b6a90ff12072729976634890d35788d5d7',
  nonce: 194,
  timestamp: 1640451232,
  version: 1,
  weight: 8.000001,
  parents: [
    '00000e0dada0a1512c61778cad7075e8a2c7109eb35d63199f3c986ead092684',
    '0000000090a41f17769a5acae74f98c96b0c3041c5149a9e6bbfb2d32d85997c',
  ],
  inputs: [],
  outputs: [],
};

afterEach(() => {
  jest.clearAllMocks();
});

test('getAddressAtIndex', async () => {
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

  const address = {
    address: 'address1',
    index: 0,
    transactions: 50,
  };

  const spy = jest.spyOn(walletApi, 'getAddresses');

  // We should return only the address property on success
  spy.mockImplementationOnce(() =>
    Promise.resolve({
      success: true,
      addresses: [address],
    })
  );

  const addressAtIndex = await wallet.getAddressAtIndex(0);
  expect(addressAtIndex).toStrictEqual(address.address);

  // We should fail if no addresses were returned
  spy.mockImplementationOnce(() =>
    Promise.resolve({
      success: false,
      addresses: [],
    })
  );

  await expect(wallet.getAddressAtIndex(0)).rejects.toThrow('Error getting wallet addresses.');
});

describe('onNewTx', () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;

  it('should call getNewAddresses if an output address is in newAddresses', async () => {
    const wallet = new HathorWalletServiceWallet({
      requestPassword,
      seed,
      network,
    });

    const testAddress = 'testAddress1';
    // @ts-expect-error: Monkey-patching wallet instance
    wallet.newAddresses = [
      { address: testAddress, index: 0, addressPath: "m/0'/0/0" },
    ] as AddressInfoObject[];

    const getNewAddressesSpy = jest
      // @ts-expect-error: Monkey-patching wallet instance
      .spyOn(wallet, 'getNewAddresses')
      .mockResolvedValue(undefined);

    const newTx: WsTransaction = {
      tx_id: 'tx1',
      nonce: 0,
      timestamp: 0,
      signal_bits: 0,
      version: 1,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [
        {
          value: 100n,
          token_data: 0,
          script: { type: 'Buffer', data: [] },
          token: '00',
          decoded: {
            type: 'P2PKH',
            address: testAddress,
            timelock: null,
          },
          locked: false,
          index: 0,
        },
      ],
    };

    await wallet.onNewTx(newTx);

    expect(getNewAddressesSpy).toHaveBeenCalled();
  });

  it('should not call getNewAddresses if no output address is in newAddresses', async () => {
    const wallet = new HathorWalletServiceWallet({
      requestPassword,
      seed,
      network,
    });

    // @ts-expect-error: Monkey-patching newAddresses
    wallet.newAddresses = [
      { address: 'otherAddress', index: 0, addressPath: "m/0'/0/0" },
    ] as AddressInfoObject[];

    const getNewAddressesSpy = jest.spyOn(wallet, 'getNewAddresses').mockResolvedValue(undefined);

    const newTx: WsTransaction = {
      tx_id: 'tx2',
      nonce: 0,
      timestamp: 0,
      signal_bits: 0,
      version: 1,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [
        {
          value: 100n,
          token_data: 0,
          script: { type: 'Buffer', data: [] },
          token: '00',
          decoded: {
            type: 'P2PKH',
            address: 'someRandomAddress',
            timelock: null,
          },
          locked: false,
          index: 0,
        },
      ],
    };

    await wallet.onNewTx(newTx);

    expect(getNewAddressesSpy).not.toHaveBeenCalled();
  });
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

  async function* getAllAddressesMock() {
    const addresses: GetAddressesObject[] = [
      {
        address: 'address0',
        index: 0,
        transactions: 0,
      },
      {
        address: 'address1',
        index: 1,
        transactions: 0,
      },
      {
        address: 'address2',
        index: 2,
        transactions: 0,
      },
    ];

    for (const address of addresses) {
      yield address;
    }
  }

  jest.spyOn(wallet, 'getAllAddresses').mockImplementation(getAllAddressesMock);

  let tx: WsTransaction = {
    ...MOCK_TX,
    inputs: [
      {
        value: 500n,
        token_data: 1,
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        token: 'token1',
        decoded: {
          type: 'P2PKH',
          address: 'address0',
          timelock: null,
        },
        tx_id: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
      },
    ],
    outputs: [
      {
        value: 200n,
        token_data: 1,
        token: 'token1',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'address1',
          timelock: null,
        },
      },
      {
        value: 300n,
        token_data: 1,
        token: 'token1',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'other-address',
          timelock: null,
        },
      },
    ],
  };

  let balance = await wallet.getTxBalance(tx);

  expect(balance.token1).toStrictEqual(-300n);

  tx = {
    ...MOCK_TX,
    inputs: [
      {
        value: 500n,
        token_data: 1,
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        token: 'token1',
        decoded: {
          type: 'P2PKH',
          address: 'address0',
          timelock: null,
        },
        tx_id: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
      },
    ],
    outputs: [
      {
        value: 200n,
        token_data: 1,
        token: 'token1',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'address1',
          timelock: null,
        },
      },
      {
        value: 300n,
        token_data: 1,
        token: 'token1',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'address2',
          timelock: null,
        },
      },
    ],
  };

  balance = await wallet.getTxBalance(tx);
  expect(balance.token1).toStrictEqual(0n);

  // multiple tokens in the same transaction
  tx = {
    ...MOCK_TX,
    inputs: [
      {
        value: 500n,
        token_data: 1,
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        token: 'token1',
        decoded: {
          type: 'P2PKH',
          address: 'address0',
          timelock: null,
        },
        tx_id: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
      },
      {
        value: 10n,
        token_data: 1,
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        token: 'token2',
        decoded: {
          type: 'P2PKH',
          address: 'address0',
          timelock: null,
        },
        tx_id: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 2,
      },
    ],
    outputs: [
      {
        value: 200n,
        token_data: 1,
        token: 'token1',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'address1',
          timelock: null,
        },
      },
      {
        value: 300n,
        token_data: 1,
        token: 'token1',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'address2',
          timelock: null,
        },
      },
      {
        // change
        value: 5n,
        token_data: 1,
        token: 'token2',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'address2',
          timelock: null,
        },
      },
      {
        value: 5n,
        token_data: 1,
        token: 'token2',
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        spent_by: null,
        decoded: {
          type: 'P2PKH',
          address: 'other-address',
          timelock: null,
        },
      },
    ],
  };

  balance = await wallet.getTxBalance(tx);
  expect(balance.token1).toStrictEqual(0n);
  expect(balance.token2).toStrictEqual(-5n);
});

test('getTxBalance with authority outputs', async () => {
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

  async function* getAllAddressesMock() {
    const addresses: GetAddressesObject[] = [
      {
        address: 'address0',
        index: 0,
        transactions: 0,
      },
      {
        address: 'address1',
        index: 1,
        transactions: 0,
      },
    ];

    for (const address of addresses) {
      yield address;
    }
  }

  jest.spyOn(wallet, 'getAllAddresses').mockImplementation(getAllAddressesMock);

  const tx: IHistoryTx = {
    tx_id: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
    version: 1,
    weight: 1,
    timestamp: 1234567890,
    is_voided: false,
    inputs: [
      {
        tx_id: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        token: 'token1',
        token_data: 129, // Melt authority
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'address0',
        },
        value: 1n,
      },
    ],
    outputs: [
      {
        token: 'token1',
        token_data: 130, // Mint authority
        script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
        value: 1n,
        decoded: {
          type: 'P2PKH',
          address: 'address1',
        },
        spent_by: null,
      },
    ],
    parents: [],
    height: undefined,
  };

  // Without includeAuthorities, balance should be empty
  let balance = await wallet.getTxBalance(tx);
  expect(balance).toStrictEqual({});

  // With includeAuthorities, balance should be 0 (mint authority gained, melt authority lost)
  balance = await wallet.getTxBalance(tx, { includeAuthorities: true });
  expect(balance.token1).toStrictEqual(0n);
});

test('checkAddressesMine', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  jest.spyOn(wallet, 'isReady').mockReturnValue(true);

  const addr1 = 'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu';
  const addr2 = 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM';
  const addr3 = 'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX';

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      [addr1]: true,
      [addr2]: false,
      [addr3]: false,
    },
  });

  const walletAddressMap = await wallet.checkAddressesMine([addr1, addr2, addr3]);

  expect(walletAddressMap[addr1]).toStrictEqual(true);
  expect(walletAddressMap[addr2]).toStrictEqual(false);
  expect(walletAddressMap[addr3]).toStrictEqual(false);

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(400, {
    success: false,
  });

  await expect(wallet.checkAddressesMine([addr1, addr2, addr3])).rejects.toThrow(
    'Error checking wallet addresses.'
  );
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
  const xpub =
    'xpub6D2LLyX98BCEkbTHsE14kgP6atagb9TR3ZBvHYQrT9yEUDYeHVBmrnnyWo3u2cADp4upagFyuu5msxtosceN1FykN22oa41o3fMEJmFG766';
  const walletId = '83f704d8b24d4f9cc252b080b008280bf4b3342065f7b4baee43fd0ec7186db7';
  const authXpub =
    'xpub6AyEt1FdSvP2mXsZfJ4SLHbMugNMQVNdtkhzWoF6nQSSXcstiqEZDXd4Jg7XBscM2K9YMt2ubWXChYXMTAPS99E8Wot1tcMtyfJhhKLZLok';
  const firstAddress = 'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX';
  const xpubAddress = 'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu';
  const authXpubAddress = 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM';

  const xpubMessage = new Message(String(timestampNow).concat(walletId).concat(xpubAddress));
  const authXpubMessage = new Message(
    String(timestampNow).concat(walletId).concat(authXpubAddress)
  );

  expect(authData.xpub).toBe(xpub);
  expect(authData.authXpub).toBe(authXpub);
  expect(authData.timestampNow).toBe(timestampNow);
  expect(authData.firstAddress).toBe(firstAddress);
  expect(xpubMessage.verify(xpubAddress, authData.xpubkeySignature)).toBe(true);
  expect(authXpubMessage.verify(authXpubAddress, authData.authXpubkeySignature)).toBe(true);
});

test('getTxById', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  jest.spyOn(wallet, 'isReady').mockReturnValue(true);

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
        txId: 'txId1',
        timestamp: 10,
        version: 3,
        balance: 10n,
        height: 1,
        tokenId: 'token1',
        tokenName: 'Token 1',
        tokenSymbol: 'T1',
        voided: false,
        weight: 65.4321,
      },
      {
        balance: 7n,
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

  await expect(invalidCall).rejects.toThrow('Error getting transaction by its id.');
});

test('prepareMintTokens', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      WR1i8USJWQuaU423fwuFQbezfevmT4vFWX: true,
    },
  });

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  expect(wallet.getNetwork()).toEqual('testnet');

  const code = new Mnemonic(seed);
  const xpriv = code.toHDPrivateKey('', network.getNetwork());

  wallet.setState('Ready');

  const getUtxosMock = async params => {
    if (params.tokenId === '00') {
      return {
        utxos: [
          {
            txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5d',
            index: 0,
            tokenId: '00',
            address: addresses[0],
            value: 1n,
            authorities: 0n,
            timelock: null,
            heightlock: null,
            locked: false,
            addressPath,
          },
        ],
        changeAmount: 0n,
      };
    }
    return {
      utxos: [
        {
          txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
          index: 0,
          tokenId: '01',
          address: addresses[0],
          value: 1n,
          authorities: TOKEN_MINT_MASK,
          timelock: null,
          heightlock: null,
          locked: false,
          addressPath,
        },
      ],
      changeAmount: 0n,
    };
  };
  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);

  const spy1 = jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(getUtxosMock);
  const spy2 = jest
    .spyOn(wallet.storage, 'getMainXPrivKey')
    .mockReturnValue(Promise.resolve(xpriv.xprivkey));
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);

  // error because of wrong authority output address
  await expect(
    wallet.prepareMintTokensData('01', 100n, {
      address: addresses[1],
      createAnotherMint: true,
      mintAuthorityAddress: 'abc',
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // error because of wrong authority output address
  await expect(
    wallet.prepareMintTokensData('01', 100n, {
      address: addresses[1],
      createAnotherMint: true,
      mintAuthorityAddress: 'abc',
      allowExternalMintAuthorityAddress: true,
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // mint data without sign the transaction
  const mintDataNotSigned = await wallet.prepareMintTokensData('01', 100n, {
    address: addresses[1],
    mintAuthorityAddress: addresses[2],
    pinCode: '123456',
    signTx: false,
  });
  expect(mintDataNotSigned.inputs).toEqual([
    expect.objectContaining({
      data: null,
    }),
    expect.objectContaining({
      data: null,
    }),
  ]);

  // mint data with correct address for authority output
  const mintData = await wallet.prepareMintTokensData('01', 100n, {
    address: addresses[1],
    createAnotherMint: true,
    mintAuthorityAddress: addresses[2],
    pinCode: '123456',
  });

  expect(mintDataNotSigned.inputs).toEqual([
    expect.objectContaining({
      data: expect.any(Object),
    }),
    expect.objectContaining({
      data: expect.any(Object),
    }),
  ]);
  expect(mintData.outputs).toHaveLength(2);

  const authorityOutputs = mintData.outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );

  expect(authorityOutputs).toHaveLength(1);
  const authorityOutput = authorityOutputs[0];
  expect(authorityOutput.value).toEqual(TOKEN_MINT_MASK);
  const p2pkh = authorityOutput.parseScript(network);
  // Validate that the authority output was sent to the correct address
  expect(p2pkh.address.base58).toEqual(addresses[2]);

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
});

test('prepareMeltTokens', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      WR1i8USJWQuaU423fwuFQbezfevmT4vFWX: true,
    },
  });

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
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

  const getUtxosMock = async params => {
    if (params.authority === TOKEN_MELT_MASK) {
      return {
        utxos: [
          {
            txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
            index: 0,
            tokenId: '01',
            address: addresses[0],
            value: 1n,
            authorities: TOKEN_MELT_MASK,
            timelock: null,
            heightlock: null,
            locked: false,
            addressPath,
          },
        ],
        changeAmount: 0n,
      };
    }
    return {
      utxos: [
        {
          txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5d',
          index: 0,
          tokenId: '01',
          address: addresses[0],
          value: 1n,
          authorities: 0n,
          timelock: null,
          heightlock: null,
          locked: false,
          addressPath,
        },
      ],
      changeAmount: 0n,
    };
  };
  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);

  const spy1 = jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(getUtxosMock);
  const spy2 = jest
    .spyOn(wallet.storage, 'getMainXPrivKey')
    .mockReturnValue(Promise.resolve(xpriv.xprivkey));
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);

  // error because of wrong authority output address
  await expect(
    wallet.prepareMeltTokensData('01', 1n, {
      address: addresses[1],
      createAnotherMelt: true,
      meltAuthorityAddress: 'abc',
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // error because of wrong authority output address
  await expect(
    wallet.prepareMeltTokensData('01', 1n, {
      address: addresses[1],
      createAnotherMelt: true,
      meltAuthorityAddress: 'abc',
      allowExternalMeltAuthorityAddress: true,
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // melt data without sign the transaction
  const meltDataNotSigned = await wallet.prepareMeltTokensData('01', 100n, {
    address: addresses[1],
    meltAuthorityAddress: addresses[2],
    pinCode: '123456',
    signTx: false,
  });
  expect(meltDataNotSigned.inputs).toEqual([
    expect.objectContaining({
      data: null,
    }),
    expect.objectContaining({
      data: null,
    }),
  ]);

  // melt data with correct address for authority output
  const meltData = await wallet.prepareMeltTokensData('01', 1n, {
    address: addresses[1],
    createAnotherMelt: true,
    meltAuthorityAddress: addresses[2],
    pinCode: '123456',
  });

  expect(meltDataNotSigned.inputs).toEqual([
    expect.objectContaining({
      data: expect.any(Object),
    }),
    expect.objectContaining({
      data: expect.any(Object),
    }),
  ]);
  expect(meltData.outputs).toHaveLength(1);

  const authorityOutputs = meltData.outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );

  expect(authorityOutputs).toHaveLength(1);
  const authorityOutput = authorityOutputs[0];
  expect(authorityOutput.value).toEqual(TOKEN_MELT_MASK);
  const p2pkh = authorityOutput.parseScript(network);
  // Validate that the authority output was sent to the correct address
  expect(p2pkh.address.base58).toEqual(addresses[2]);

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
});

test('prepareDelegateAuthorityData', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
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
    utxos: [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        tokenId: '00',
        address: addresses[0],
        value: 1n,
        authorities: 1n,
        timelock: null,
        heightlock: null,
        locked: false,
        addressPath,
      },
    ],
    changeAmount: 4n,
  });
  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);

  const spy1 = jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(getUtxosMock);
  const spy2 = jest
    .spyOn(wallet.storage, 'getMainXPrivKey')
    .mockReturnValue(Promise.resolve(xpriv.xprivkey));
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

  await expect(
    wallet.prepareDelegateAuthorityData('00', 'mint', addresses[1], {
      anotherAuthorityAddress: 'invalid-address',
      createAnother: true,
      pinCode: '123456',
    })
  ).rejects.toThrow('Address invalid-address is not valid.');

  await expect(
    wallet.prepareDelegateAuthorityData('00', 'mint', addresses[1], {
      anotherAuthorityAddress: addresses[2],
      createAnother: false,
      pinCode: null,
    })
  ).rejects.toThrow('PIN not specified in prepareDelegateAuthorityData options');

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
});

test('prepareDelegateAuthorityData should fail if type is invalid', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
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
  await expect(
    wallet.prepareDelegateAuthorityData('00', 'explode', 'addr1', {
      anotherAuthorityAddress: 'addr2',
      createAnother: true,
      pinCode: '123456',
    })
  ).rejects.toThrow('Type options are mint and melt for delegate authority method.');
});

test('delegateAuthority should throw if wallet is not ready', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  await expect(
    wallet.delegateAuthority('00', 'mint', 'address1', {
      createAnother: false,
      anotherAuthorityAddress: null,
      pinCode: '123456',
    })
  ).rejects.toThrow('Wallet not ready');
});

test('prepareDestroyAuthority', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
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
    utxos: [
      {
        txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        index: 0,
        tokenId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f',
        address: addresses[0],
        value: 1n,
        authorities: 1n,
        timelock: null,
        heightlock: null,
        locked: false,
        addressPath,
      },
    ],
    changeAmount: 4n,
  });
  const getInputDataMock = () => Buffer.from([]);

  const spy1 = jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(getUtxosMock);
  const spy2 = jest
    .spyOn(wallet.storage, 'getMainXPrivKey')
    .mockReturnValue(Promise.resolve(xpriv.xprivkey));
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);

  // createAnother option should create another authority utxo to the given address
  const delegate1 = await wallet.prepareDestroyAuthorityData('00', 'mint', 1, {
    pinCode: '123456',
  });

  expect(delegate1.outputs).toHaveLength(0);
  expect(delegate1.inputs).toHaveLength(1);
  expect(delegate1.inputs[0].hash).toStrictEqual(
    '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5f'
  );

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
});

test('destroyAuthority should throw if wallet is not ready', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  await expect(
    wallet.destroyAuthority('00', 'mint', 1, {
      pinCode: '123456',
    })
  ).rejects.toThrow('Wallet not ready');
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
    tx: {
      hash: 'tx1',
      nonce: '0',
      timestamp: 1234567890,
      version: 1,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [],
      tokens: [],
      token_name: null,
      token_symbol: null,
      raw: '0x',
    },
    meta: {
      hash: 'tx1',
      received_by: [],
      children: [],
      conflict_with: [],
      first_block: null,
      height: 0,
      voided_by: [],
      spent_outputs: [],
      received_timestamp: null,
      is_voided: false,
      verification_status: 'verified',
      twins: [],
      accumulated_weight: 0,
      score: 0,
    },
  });

  const proxiedTx = await wallet.getFullTxById('tx1');

  expect(proxiedTx.tx.hash).toStrictEqual('tx1');

  mockAxiosAdapter.onGet('wallet/proxy/transactions/tx2').reply(400, {});
  await expect(wallet.getFullTxById('tx2')).rejects.toThrow(
    'Error getting transaction by its id from the proxied fullnode.'
  );

  mockAxiosAdapter
    .onGet('wallet/proxy/transactions/tx3')
    .reply(200, { success: false, message: 'Transaction not found' });
  await expect(wallet.getFullTxById('tx3')).rejects.toThrow(TxNotFoundError);
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
  await expect(wallet.getTxConfirmationData('tx1')).rejects.toThrow(
    'Error getting transaction confirmation data by its id from the proxied fullnode.'
  );

  mockAxiosAdapter
    .onGet('wallet/proxy/transactions/tx2/confirmation_data')
    .reply(200, { success: false, message: 'Transaction not found' });
  await expect(wallet.getTxConfirmationData('tx2')).rejects.toThrow(TxNotFoundError);
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

  mockAxiosAdapter
    .onGet('wallet/proxy/graphviz/neighbours?txId=tx1&graphType=test&maxLevel=1')
    .reply(200, mockData);

  const proxiedGraphvizResponse = await wallet.graphvizNeighborsQuery('tx1', 'test', 1);

  expect(proxiedGraphvizResponse).toStrictEqual(mockData);

  mockAxiosAdapter
    .onGet('wallet/proxy/graphviz/neighbours?txId=tx1&graphType=test&maxLevel=1')
    .reply(500, '');
  // Axios will throw on 500 status code
  await expect(wallet.graphvizNeighborsQuery('tx1', 'test', 1)).rejects.toThrow(
    'Request failed with status code 500'
  );

  mockAxiosAdapter
    .onGet('wallet/proxy/graphviz/neighbours?txId=tx2&graphType=test&maxLevel=1')
    .reply(200, { success: false, message: 'Transaction not found' });
  await expect(wallet.graphvizNeighborsQuery('tx2', 'test', 1)).rejects.toThrow(TxNotFoundError);
});

test('instantiate a new wallet without web socket initialization', async () => {
  /**
   * New wallet without web socket initialization
   */
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
    enableWs: false,
  });
  expect(wallet.isWsEnabled()).toBe(false);
  expect(wallet.isReady()).toBe(false);

  /**
   * Wallet change its state to ready
   */
  // @ts-expect-error -- getNewAddress is a private method, so invisible for this typing
  const spyOnGetNewAddress = jest.spyOn(wallet, 'getNewAddresses').mockImplementation(() => {
    return Promise.resolve();
  });
  const spyOnSetupConnection = jest.spyOn(wallet, 'setupConnection');

  // get original method implementation for the private method onWalletReady
  wallet.walletId = 'wallet-id';
  const onWalletReadyImplementation = jest
    // @ts-expect-error -- onWalletReady is a private method that's invisible to the wallet type
    .spyOn(wallet, 'onWalletReady')
    .getMockImplementation();
  // call method binding to the wallet instance
  await onWalletReadyImplementation?.call(wallet);

  expect(spyOnGetNewAddress).toHaveBeenCalledTimes(1);
  expect(spyOnSetupConnection).toHaveBeenCalledTimes(0);
  expect(wallet.isReady()).toBeTruthy();
});

test('sendTransaction', async () => {
  // Initialize wallet
  const wallet = buildWalletToAuthenticateApiCall();
  jest.spyOn(wallet, 'isReady').mockReturnValue(true);

  // Mock the storage isReadonly method to prevent UninitializedWalletError
  wallet.storage = {
    isReadonly: jest.fn().mockResolvedValue(false),
  } as Partial<typeof wallet.storage>;

  // Send transaction
  await wallet.sendTransaction('WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT', 10, { pinCode: '1234' });

  // Assertions
  expect(SendTransactionWalletService).toHaveBeenCalledWith(expect.any(HathorWalletServiceWallet), {
    changeAddress: undefined,
    inputs: [],
    outputs: [
      { address: 'WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT', token: '00', type: 'p2pkh', value: 10 },
    ],
    pin: '1234',
  });
});

test('createTokens', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      WR1i8USJWQuaU423fwuFQbezfevmT4vFWX: true,
    },
  });

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
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

  const getUtxosMock = async () => {
    return {
      utxos: [
        {
          txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5d',
          index: 0,
          tokenId: '00',
          address: addresses[0],
          value: 1n,
          authorities: 0n,
          timelock: null,
          heightlock: null,
          locked: false,
          addressPath,
        },
      ],
      changeAmount: 0n,
    };
  };
  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);

  const getCurrentAddressDataMock = () => {
    return {
      address: addresses[0],
    };
  };

  const spy1 = jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(getUtxosMock);
  const spy2 = jest
    .spyOn(wallet.storage, 'getMainXPrivKey')
    .mockReturnValue(Promise.resolve(xpriv.xprivkey));
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);
  const spy4 = jest
    .spyOn(wallet, 'getCurrentAddress')
    .mockImplementation(getCurrentAddressDataMock);

  // error because of wrong authority output address
  await expect(
    wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMint: true,
      mintAuthorityAddress: 'abc',
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // error because of wrong authority output address
  await expect(
    wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMelt: true,
      meltAuthorityAddress: 'abc',
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // error because of invalid external authority output address
  await expect(
    wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMint: true,
      mintAuthorityAddress: 'abc',
      allowExternalMintAuthorityAddress: true,
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // error because of invalid external authority output address
  await expect(
    wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMelt: true,
      meltAuthorityAddress: 'abc',
      allowExternalMeltAuthorityAddress: true,
      pinCode: '123456',
    })
  ).rejects.toThrow(SendTxError);

  // create token without sign the transaction
  const tokenDataNotSigned = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
    address: addresses[1],
    mintAuthorityAddress: addresses[2],
    pinCode: '123456',
    signTx: false,
  });
  expect(tokenDataNotSigned.inputs).toEqual([
    expect.objectContaining({
      data: null,
    }),
  ]);

  // create token with correct address for authority output
  const tokenData = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
    address: addresses[1],
    createMint: true,
    mintAuthorityAddress: addresses[2],
    pinCode: '123456',
  });

  expect(tokenData.inputs).toEqual([
    expect.objectContaining({
      data: expect.any(Object),
    }),
  ]);
  expect(tokenData.outputs).toHaveLength(3);

  const authorityOutputs = tokenData.outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );

  const mintAuthority = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);

  expect(authorityOutputs).toHaveLength(2);
  expect(mintAuthority[0].value).toEqual(TOKEN_MINT_MASK);
  const p2pkh = mintAuthority[0].parseScript(network);
  // Validate that the authority output was sent to the correct address
  expect(p2pkh.address.base58).toEqual(addresses[2]);

  // create token with correct address for authority output
  const tokenData2 = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
    address: addresses[1],
    createMint: false,
    createMelt: true,
    meltAuthorityAddress: addresses[2],
    pinCode: '123456',
  });

  expect(tokenData2.outputs).toHaveLength(2);

  const authorityOutputs2 = tokenData2.outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );

  expect(authorityOutputs2).toHaveLength(1);
  const authorityOutput = authorityOutputs2[0];
  expect(authorityOutput.value).toEqual(TOKEN_MELT_MASK);
  const p2pkh2 = authorityOutput.parseScript(network);
  // Validate that the authority output was sent to the correct address
  expect(p2pkh2.address.base58).toEqual(addresses[2]);

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
  spy4.mockRestore();
});

test('createNFTs', async () => {
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      WR1i8USJWQuaU423fwuFQbezfevmT4vFWX: true,
    },
  });

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
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

  const getUtxosMock = async () => {
    return {
      utxos: [
        {
          txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5d',
          index: 0,
          tokenId: '00',
          address: addresses[0],
          value: 1n,
          authorities: 0n,
          timelock: null,
          heightlock: null,
          locked: false,
          addressPath,
        },
      ],
      changeAmount: 0n,
    };
  };
  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);

  const getCurrentAddressDataMock = async () => ({
    address: addresses[0],
  });

  const spy1 = jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(getUtxosMock);
  const spy2 = jest
    .spyOn(wallet.storage, 'getMainXPrivKey')
    .mockReturnValue(Promise.resolve(xpriv.xprivkey));
  const spy3 = jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);
  const spy4 = jest
    .spyOn(wallet, 'getCurrentAddress')
    .mockImplementation(getCurrentAddressDataMock);

  // error because of wrong authority output address
  await expect(
    wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMint: true,
      mintAuthorityAddress: 'abc',
      pinCode: '123456',
      data: ['data'],
      isCreateNFT: true,
    })
  ).rejects.toThrow(SendTxError);

  // error because of wrong authority output address
  await expect(
    wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMint: true,
      mintAuthorityAddress: 'abc',
      pinCode: '123456',
      data: ['data'],
      isCreateNFT: true,
    })
  ).rejects.toThrow(SendTxError);

  // create token with correct address for authority output
  const tokenData = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
    address: addresses[1],
    createMint: true,
    mintAuthorityAddress: addresses[2],
    createMelt: false,
    pinCode: '123456',
    data: ['data'],
    isCreateNFT: true,
  });

  // Token minted, mint authority, and data output
  expect(tokenData.outputs).toHaveLength(3);

  const authorityOutputs = tokenData.outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );

  const authorityOutput = authorityOutputs[0];

  expect(authorityOutputs).toHaveLength(1);
  expect(authorityOutput.value).toEqual(TOKEN_MINT_MASK);
  const p2pkh = authorityOutput.parseScript(network);
  // Validate that the authority output was sent to the correct address
  expect(p2pkh.address.base58).toEqual(addresses[2]);

  // create token with correct address for authority output
  const tokenData2 = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
    address: addresses[1],
    createMint: false,
    createMelt: true,
    meltAuthorityAddress: addresses[2],
    pinCode: '123456',
    data: ['data'],
    isCreateNFT: true,
  });

  // Token minted, melt authority, and data output
  expect(tokenData2.outputs).toHaveLength(3);

  const authorityOutputs2 = tokenData2.outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );

  expect(authorityOutputs2).toHaveLength(1);
  const authorityOutput2 = authorityOutputs2[0];
  expect(authorityOutput2.value).toEqual(TOKEN_MELT_MASK);
  const p2pkh2 = authorityOutput2.parseScript(network);
  // Validate that the authority output was sent to the correct address
  expect(p2pkh2.address.base58).toEqual(addresses[2]);

  // Clear mocks
  spy1.mockRestore();
  spy2.mockRestore();
  spy3.mockRestore();
  spy4.mockRestore();
});

test('start', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  let store = new MemoryStore();
  let storage = new Storage(store);
  const accessData = walletUtils.generateAccessDataFromSeed(seed, {
    networkName: 'testnet',
    password: '1234',
    pin: '1234',
  });

  jest
    .spyOn(HathorWalletServiceWallet.prototype, 'pollForWalletStatus')
    .mockImplementation(() => Promise.resolve());
  jest.spyOn(HathorWalletServiceWallet.prototype, 'setupConnection').mockImplementation(jest.fn());
  jest
    .spyOn(walletApi, 'getNewAddresses')
    .mockImplementation(() => Promise.resolve({ success: true, addresses: [] }));
  jest.spyOn(walletApi, 'createWallet').mockImplementation(() =>
    Promise.resolve({
      success: true,
      status: {
        walletId: 'id',
        xpubkey: 'xpub',
        status: 'creating',
        maxGap: 20,
        createdAt: 0,
        readyAt: 0,
      },
    })
  );

  let wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    storage,
  });
  await wallet.start({ pinCode: '1234', password: '1234' });
  // it should generate the same accessData
  // we test with the xpubkey since the encrypted keys use different salts so they will not match
  await expect(wallet.storage.getAccessData()).resolves.toMatchObject({
    xpubkey: accessData.xpubkey,
  });
  await wallet.stop();

  await storage.cleanStorage(true, true, true);
  await storage.saveAccessData(accessData);
  wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    storage,
  });
  await wallet.start({ pinCode: '1234', password: '1234' });
  // If the accessData was generated the words would not match
  // This is because it would be encrypted with a different salt
  await expect(wallet.storage.getAccessData()).resolves.toMatchObject({
    words: accessData.words,
  });
  await wallet.stop();

  // Starting with xpriv
  const code = new Mnemonic(seed);
  const xpriv = code.toHDPrivateKey('', new Network('testnet'));
  const authxpriv = xpriv.deriveChild(WALLET_SERVICE_AUTH_DERIVATION_PATH).xprivkey;
  const acctKey = decryptData(accessData.acctPathKey!, '1234');
  store = new MemoryStore();
  storage = new Storage(store);
  wallet = new HathorWalletServiceWallet({
    requestPassword,
    xpriv: acctKey,
    authxpriv,
    network,
    passphrase: '',
    storage,
  });
  await wallet.start({ pinCode: '1234', password: '1234' });
  await expect(wallet.storage.getAccessData()).resolves.toMatchObject({
    xpubkey: accessData.xpubkey,
    authKey: expect.anything(),
  });
  await wallet.stop();

  // Check we throw an error when giving an invalid authxpriv
  expect(() => {
    return new HathorWalletServiceWallet({
      requestPassword,
      xpriv: acctKey,
      authxpriv: 'invalid-xprivkey',
      network,
      passphrase: '',
      storage,
    });
  }).toThrow('authxpriv parameter is an invalid hd privatekey');

  expect(wallet.getServerUrl()).toBe(config.getServerUrl());
});

test('getAddressPrivKey', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const store = new MemoryStore();
  const storage = new Storage(store);

  jest
    .spyOn(HathorWalletServiceWallet.prototype, 'pollForWalletStatus')
    .mockImplementation(() => Promise.resolve());
  jest.spyOn(HathorWalletServiceWallet.prototype, 'setupConnection').mockImplementation(jest.fn());
  jest
    .spyOn(walletApi, 'getNewAddresses')
    .mockImplementation(() => Promise.resolve({ success: true, addresses: [] }));
  jest.spyOn(walletApi, 'createWallet').mockImplementation(() =>
    Promise.resolve({
      success: true,
      status: {
        walletId: 'id',
        xpubkey: 'xpub',
        status: 'creating',
        maxGap: 20,
        createdAt: 0,
        readyAt: 0,
      },
    })
  );

  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    storage,
  });
  await wallet.start({ pinCode: '1234', password: '1234' });

  expect(
    [
      await wallet.getAddressPrivKey('1234', 1),
      await wallet.getAddressPrivKey('1234', 2),
      await wallet.getAddressPrivKey('1234', 3),
      await wallet.getAddressPrivKey('1234', 4),
      // We need to pass the network because bitcore-lib forces bitcoin network
    ].map(hdPrivKey => hdPrivKey.privateKey.toAddress(network.getNetwork()).toString())
  ).toStrictEqual([
    'WgSpcCwYAbtt31S2cqU7hHJkUHdac2EPWG',
    'WPfG7P4YQDJ4MpwTS6qrfGW4fvYvAhPpV7',
    'WUgjC47cFz5z9Uag92MKdnL8XgHdCfscNx',
    'WPRp9yj7Tjj9praWMy1whXuUc5zi1TdQtm',
  ]);
});

test('signMessageWithAddress', async () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  const store = new MemoryStore();
  const storage = new Storage(store);

  jest
    .spyOn(HathorWalletServiceWallet.prototype, 'pollForWalletStatus')
    .mockImplementation(() => Promise.resolve());
  jest.spyOn(HathorWalletServiceWallet.prototype, 'setupConnection').mockImplementation(jest.fn());
  jest
    .spyOn(walletApi, 'getNewAddresses')
    .mockImplementation(() => Promise.resolve({ success: true, addresses: [] }));
  jest.spyOn(walletApi, 'createWallet').mockImplementation(() =>
    Promise.resolve({
      success: true,
      status: {
        walletId: 'id',
        xpubkey: 'xpub',
        status: 'creating',
        maxGap: 20,
        createdAt: 0,
        readyAt: 0,
      },
    })
  );

  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    storage,
  });

  await wallet.start({ pinCode: '1234', password: '1234' });

  const message = 'sign-me-please';
  const addressIndex = 2;
  const address = 'WPfG7P4YQDJ4MpwTS6qrfGW4fvYvAhPpV7';
  const signedMessage = await wallet.signMessageWithAddress(message, addressIndex, '1234');

  expect(verifyMessage(message, signedMessage, address)).toBeTruthy();
});

describe('getUtxos', () => {
  let wallet: HathorWalletServiceWallet;
  const seed = defaultWalletSeed;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => 'test-pin',
      seed,
      network: new Network('testnet'),
    });

    // Mock wallet methods
    wallet.failIfWalletNotReady = jest.fn();

    jest.clearAllMocks();
  });

  it('should return UTXOs when token parameter is provided', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 100n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: '00', // NATIVE_TOKEN_UID
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      token: '00',
      max_utxos: 10,
    });

    expect(result).toEqual({
      total_amount_available: 100n,
      total_utxos_available: 1n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
          amount: 100n,
          tx_id: 'tx1',
          locked: false,
          index: 0,
        },
      ],
    });
    expect(walletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: '00',
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      smallerThan: undefined,
      biggerThan: undefined,
      maxOutputs: 10,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should handle custom token requests', async () => {
    const customTokenId =
      '01a7a04b2c3b7b1b9b8a8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f';
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 50n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: customTokenId,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      token: customTokenId,
      max_utxos: 1,
    });

    expect(result).toEqual({
      total_amount_available: 50n,
      total_utxos_available: 1n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
          amount: 50n,
          tx_id: 'tx1',
          locked: false,
          index: 0,
        },
      ],
    });
    expect(walletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: customTokenId,
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      smallerThan: undefined,
      biggerThan: undefined,
      maxOutputs: 1,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should apply amount filters using api filtering', async () => {
    const mockUtxosSmallerThan200 = [
      {
        txId: 'tx1',
        index: 0,
        value: 50n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: '00',
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
      {
        txId: 'tx2',
        index: 1,
        value: 150n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: '00',
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/1",
      },
    ];

    const mockUtxosBiggerThan100 = [
      {
        txId: 'tx2',
        index: 1,
        value: 150n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: '00',
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/1",
      },
      {
        txId: 'tx3',
        index: 2,
        value: 250n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: '00',
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/2",
      },
    ];

    const getTxOutputsSpy = jest.spyOn(walletApi, 'getTxOutputs');

    // Mock the first call (amount_smaller_than: 200)
    getTxOutputsSpy.mockResolvedValueOnce({
      txOutputs: mockUtxosSmallerThan200,
    });

    // Test amount_smaller_than filter
    const result1 = await wallet.getUtxos({
      token: '00',
      amount_smaller_than: 200,
      max_utxos: 10,
    });

    expect(result1.utxos).toHaveLength(2);
    expect(result1).toEqual({
      total_amount_available: 200n,
      total_utxos_available: 2n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
          amount: 50n,
          tx_id: 'tx1',
          locked: false,
          index: 0,
        },
        {
          address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
          amount: 150n,
          tx_id: 'tx2',
          locked: false,
          index: 1,
        },
      ],
    });

    expect(getTxOutputsSpy).toHaveBeenCalledWith(wallet, {
      tokenId: '00',
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      smallerThan: 200,
      biggerThan: undefined,
      maxOutputs: 10,
      ignoreLocked: true,
      skipSpent: true,
    });

    // Mock the second call (amount_bigger_than: 100)
    getTxOutputsSpy.mockResolvedValueOnce({
      txOutputs: mockUtxosBiggerThan100,
    });

    // Test amount_bigger_than filter
    const result2 = await wallet.getUtxos({
      token: '00',
      amount_bigger_than: 100,
      max_utxos: 10,
    });

    expect(result2.utxos).toHaveLength(2);
    expect(result2).toEqual({
      total_amount_available: 400n,
      total_utxos_available: 2n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
          amount: 150n,
          tx_id: 'tx2',
          locked: false,
          index: 1,
        },
        {
          address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
          amount: 250n,
          tx_id: 'tx3',
          locked: false,
          index: 2,
        },
      ],
    });

    expect(getTxOutputsSpy).toHaveBeenCalledWith(wallet, {
      tokenId: '00',
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      smallerThan: undefined,
      biggerThan: 100,
      maxOutputs: 10,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should return empty UtxoDetails when no UTXOs are found', async () => {
    jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue({
      txOutputs: [],
    });

    const result = await wallet.getUtxos({
      token: '00',
      max_utxos: 10,
    });

    expect(result).toEqual({
      total_amount_available: 0n,
      total_utxos_available: 0n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [],
    });
  });

  it('should handle getUtxosForAmount for backward compatibility', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 200n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: '00',
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue({
      txOutputs: mockUtxos,
    });

    // Test totalAmount that doesn't exceed available UTXOs
    const result = await wallet.getUtxosForAmount(150n, {
      tokenId: '00',
    });

    expect(result).toEqual({
      utxos: mockUtxos,
      changeAmount: 50n,
    });
  });
});

describe('getAddressDetails', () => {
  let wallet: HathorWalletServiceWallet;
  const seed = defaultWalletSeed;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => 'test-pin',
      seed,
      network: new Network('testnet'),
    });

    wallet.failIfWalletNotReady = jest.fn();
    jest.clearAllMocks();
  });

  it('should return address details successfully', async () => {
    const address = 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx';
    const mockResponse = {
      success: true,
      data: {
        address,
        index: 1,
        transactions: 5,
        seqnum: 10,
      },
    };

    jest.spyOn(walletApi, 'getAddressDetails').mockResolvedValue(mockResponse);

    const result = await wallet.getAddressDetails(address);

    expect(result).toEqual(mockResponse.data);
    expect(walletApi.getAddressDetails).toHaveBeenCalledWith(wallet, address);
  });

  it('should handle API errors gracefully', async () => {
    const address = 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx';

    jest.spyOn(walletApi, 'getAddressDetails').mockRejectedValue(new Error('API Error'));

    await expect(wallet.getAddressDetails(address)).rejects.toThrow('API Error');
  });
});

describe('HathorWalletServiceWallet constructor validation', () => {
  const network = new Network('testnet');

  it('should throw error if no seed, xpriv or xpub is provided', () => {
    expect(() => {
      new HathorWalletServiceWallet({
        requestPassword: jest.fn(),
        network,
      });
    }).toThrow('You must explicitly provide the seed, xpriv or the xpub.');
  });

  it('should throw error if both seed and xpriv are provided', () => {
    expect(() => {
      new HathorWalletServiceWallet({
        requestPassword: jest.fn(),
        seed: 'test seed',
        xpriv: 'test-xpriv',
        network,
      });
    }).toThrow('You cannot provide both a seed and an xpriv.');
  });

  it('should throw error if xpriv is used with passphrase', () => {
    expect(() => {
      new HathorWalletServiceWallet({
        requestPassword: jest.fn(),
        xpriv: 'test-xpriv',
        passphrase: 'test-passphrase',
        network,
      });
    }).toThrow("You can't use xpriv with passphrase.");
  });

  it('should throw error if xpriv is provided without authxpriv', () => {
    expect(() => {
      new HathorWalletServiceWallet({
        requestPassword: jest.fn(),
        xpriv: 'test-xpriv',
        network,
      });
    }).toThrow('You must provide both the account path xpriv and auth path xpriv.');
  });
});

describe('HathorWalletServiceWallet server configuration', () => {
  let wallet: HathorWalletServiceWallet;
  const network = new Network('testnet');
  const seed = defaultWalletSeed;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      seed,
      network,
      storage: new Storage(new MemoryStore()),
    });
  });

  it('should change server URL', async () => {
    const newServer = 'https://new-wallet-service.test.com';
    const storeSpy = jest.spyOn(wallet.storage.store, 'setItem');
    const configSpy = jest.spyOn(config, 'setWalletServiceBaseUrl');

    await wallet.changeServer(newServer);

    expect(storeSpy).toHaveBeenCalledWith('wallet:wallet_service:base_server', newServer);
    expect(configSpy).toHaveBeenCalledWith(newServer);
  });

  it('should change WebSocket server URL', async () => {
    const newServer = 'wss://new-ws-wallet-service.test.com';
    const storeSpy = jest.spyOn(wallet.storage.store, 'setItem');
    const configSpy = jest.spyOn(config, 'setWalletServiceBaseWsUrl');

    await wallet.changeWsServer(newServer);

    expect(storeSpy).toHaveBeenCalledWith('wallet:wallet_service:ws_server', newServer);
    expect(configSpy).toHaveBeenCalledWith(newServer);
  });

  it('should get stored server URLs from storage', async () => {
    const baseUrl = 'https://stored-wallet-service.test.com';
    const wsUrl = 'wss://stored-ws-wallet-service.test.com';

    jest
      .spyOn(wallet.storage.store, 'getItem')
      .mockResolvedValueOnce(baseUrl)
      .mockResolvedValueOnce(wsUrl);

    const result = await wallet.getServerUrlsFromStorage();

    expect(result).toEqual({
      walletServiceBaseUrl: baseUrl,
      walletServiceWsUrl: wsUrl,
    });
  });
});

describe('HathorWalletServiceWallet start method error conditions', () => {
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  let wallet: HathorWalletServiceWallet;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      seed,
      network,
      storage: new Storage(new MemoryStore()),
    });
  });

  it('should throw error if pinCode is not provided', async () => {
    await expect(wallet.start({})).rejects.toThrow(
      'Pin code is required when starting the wallet.'
    );
  });

  it('should handle UninitializedWalletError during access data loading', async () => {
    jest.spyOn(wallet.storage, 'getAccessData').mockRejectedValue(new UninitializedWalletError());

    await expect(wallet.start({ pinCode: '123' })).rejects.toThrow(
      'Password is required when starting the wallet from the seed.'
    );
  });

  it('should throw error if seed/xprivkey is missing during wallet creation', async () => {
    const walletWithoutSeed = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      xpub: 'test-xpub',
      network,
      storage: new Storage(new MemoryStore()),
    });

    jest
      .spyOn(walletWithoutSeed.storage, 'getAccessData')
      .mockRejectedValue(new UninitializedWalletError());
    jest.spyOn(walletApi, 'createWallet').mockRejectedValue(new Error('Test error'));

    await expect(walletWithoutSeed.start({ pinCode: '123', password: '123' })).rejects.toThrow(
      'WalletService facade initialized without seed or xprivkey'
    );
  });

  it('should throw error if wallet status is not ready after creation', async () => {
    jest.spyOn(wallet.storage, 'getAccessData').mockRejectedValue(new UninitializedWalletError());
    jest.spyOn(walletApi, 'createWallet').mockResolvedValue({
      success: true,
      status: {
        walletId: 'test-id',
        xpubkey: 'test-xpub',
        status: 'error',
        maxGap: 20,
        createdAt: Date.now(),
        readyAt: Date.now(),
      },
    });

    await expect(wallet.start({ pinCode: '123', password: '123' })).rejects.toThrow(
      WalletRequestError
    );
  });
});

describe('HathorWalletServiceWallet additional methods', () => {
  let wallet: HathorWalletServiceWallet;
  const network = new Network('testnet');
  const seed = defaultWalletSeed;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      seed,
      network,
    });
    wallet.setState('Ready');
  });

  it('should get auth token', () => {
    wallet.authToken = 'test-auth-token';
    expect(wallet.getAuthToken()).toBe('test-auth-token');
  });

  it('should return null when no auth token is set', () => {
    wallet.authToken = null;
    expect(wallet.getAuthToken()).toBeNull();
  });

  it('should get version data', async () => {
    const mockVersionData = {
      version: '1.0.0',
      network: 'testnet',
      minWeight: 14,
      minTxWeight: 14,
      maxTxWeight: 100,
      maxOutputsPerTx: 255,
    };

    jest.spyOn(walletApi, 'getVersionData').mockResolvedValue(mockVersionData);

    const result = await wallet.getVersionData();

    expect(result).toEqual(mockVersionData);
    expect(walletApi.getVersionData).toHaveBeenCalledWith(wallet);
  });

  it('should get balance for all tokens', async () => {
    const mockBalance = [
      { token_id: 'token1', balance: { available: 100n, locked: 0n } },
      { token_id: 'token2', balance: { available: 200n, locked: 10n } },
    ];

    jest.spyOn(walletApi, 'getBalances').mockResolvedValue({
      success: true,
      balances: mockBalance,
    });

    const result = await wallet.getBalance();
    expect(walletApi.getBalances).toHaveBeenCalledWith(wallet, null);
    expect(result).toEqual(mockBalance);
  });

  it('should get balance for specific token', async () => {
    const mockBalance = [{ token_id: 'token1', balance: { available: 100n, locked: 0n } }];

    jest.spyOn(walletApi, 'getBalances').mockResolvedValue({
      success: true,
      balances: mockBalance,
    });

    const result = await wallet.getBalance('token1');
    expect(walletApi.getBalances).toHaveBeenCalledWith(wallet, 'token1');
    expect(result).toEqual(mockBalance);
  });

  it('should get tokens list', async () => {
    const mockTokens = ['token1', 'token2', 'token3'];

    jest.spyOn(walletApi, 'getTokens').mockResolvedValue({
      success: true,
      tokens: mockTokens,
    });

    const result = await wallet.getTokens();
    expect(walletApi.getTokens).toHaveBeenCalledWith(wallet);
    expect(result).toEqual(mockTokens);
  });

  it('should get transaction history with default options', async () => {
    const mockHistory = [
      { tx_id: 'tx1', timestamp: Date.now(), balance: 100n },
      { tx_id: 'tx2', timestamp: Date.now(), balance: 200n },
    ];

    jest.spyOn(walletApi, 'getHistory').mockResolvedValue({
      success: true,
      history: mockHistory,
    });

    const result = await wallet.getTxHistory();
    expect(walletApi.getHistory).toHaveBeenCalledWith(wallet, {});
    expect(result).toEqual(mockHistory);
  });

  it('should get transaction history with specific options', async () => {
    const mockHistory = [{ tx_id: 'tx1', timestamp: Date.now(), balance: 100n }];
    const options = { token_id: 'token1', count: 10, skip: 5 };

    jest.spyOn(walletApi, 'getHistory').mockResolvedValue({
      success: true,
      history: mockHistory,
    });

    const result = await wallet.getTxHistory(options);
    expect(walletApi.getHistory).toHaveBeenCalledWith(wallet, options);
    expect(result).toEqual(mockHistory);
  });
});

describe('HathorWalletServiceWallet address methods', () => {
  let wallet: HathorWalletServiceWallet;
  const network = new Network('testnet');
  const seed = defaultWalletSeed;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      seed,
      network,
    });
    wallet.setState('Ready');
    wallet.newAddresses = [
      { address: 'address1', index: 0, info: '' },
      { address: 'address2', index: 1, info: '' },
      { address: 'address3', index: 2, info: '' },
    ];
    wallet.indexToUse = 0;
  });

  it('should get current address without marking as used', () => {
    const result = wallet.getCurrentAddress();

    expect(result.address).toBe('address1');
    expect(result.index).toBe(0);
    expect(wallet.indexToUse).toBe(0);
  });

  it('should get current address and mark as used', () => {
    const result = wallet.getCurrentAddress({ markAsUsed: true });

    expect(result.address).toBe('address1');
    expect(result.index).toBe(0);
    expect(wallet.indexToUse).toBe(1);
  });

  it('should return GAP_LIMIT_REACHED when index exceeds available addresses', () => {
    wallet.indexToUse = 5; // Beyond the 3 addresses available

    const result = wallet.getCurrentAddress();

    expect(result.address).toBe('address3');
    expect(result.info).toBe('GAP_LIMIT_REACHED');
  });

  it('should get next address by marking current as used', () => {
    const result = wallet.getNextAddress();

    expect(result.address).toBe('address2');
    expect(result.index).toBe(1);
    expect(wallet.indexToUse).toBe(1);
  });

  it('should get address index for existing address', async () => {
    jest.spyOn(wallet, 'getAddressDetails').mockResolvedValue({
      success: true,
      index: 5,
      transactions: 3,
    });

    const result = await wallet.getAddressIndex('test-address');

    expect(result).toBe(5);
    expect(wallet.getAddressDetails).toHaveBeenCalledWith('test-address');
  });

  it('should return null for non-existent address', async () => {
    jest.spyOn(wallet, 'getAddressDetails').mockRejectedValue(new Error('Address not found'));

    const result = await wallet.getAddressIndex('non-existent-address');

    expect(result).toBeNull();
  });

  it('should check if address is mine', async () => {
    jest.spyOn(wallet, 'checkAddressesMine').mockResolvedValue({
      'test-address': true,
    });

    const result = await wallet.isAddressMine('test-address');

    expect(result).toBe(true);
    expect(wallet.checkAddressesMine).toHaveBeenCalledWith(['test-address']);
  });

  it('should return false if address is not mine', async () => {
    jest.spyOn(wallet, 'checkAddressesMine').mockResolvedValue({
      'test-address': false,
    });

    const result = await wallet.isAddressMine('test-address');

    expect(result).toBe(false);
  });
});
