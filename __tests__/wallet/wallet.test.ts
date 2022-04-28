/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import {
  GetAddressesObject,
  WsTransaction,
  CreateWalletAuthData,
} from '../../src/wallet/types';
import walletUtils from '../../src/utils/wallet';
import { HDPublicKey, HDPrivateKey, Message } from 'bitcore-lib';

const MOCK_TX = {
  'tx_id': '0009bc9bf8eab19c41a2aa9b9369d3b6a90ff12072729976634890d35788d5d7',
  'nonce': 194,
  'timestamp': 1640451232,
  'version': 1,
  'weight': 8.000001,
  'parents': [
    '00000e0dada0a1512c61778cad7075e8a2c7109eb35d63199f3c986ead092684',
    '0000000090a41f17769a5acae74f98c96b0c3041c5149a9e6bbfb2d32d85997c'
  ],
  'inputs': [],
  'outputs': [],
};

afterEach(() => {
  jest.clearAllMocks();
});

test('getTxBalance', async () => {
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

    for (let address of addresses) {
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

test('generateCreateWalletAuthData should return correct auth data', async () => {
  const requestPassword = jest.fn();

  jest.spyOn(Date, 'now').mockImplementation(() => 10000);

  const network = new Network('testnet');
  const seed = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const pin = '123456';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });

  const authData: CreateWalletAuthData = wallet.generateCreateWalletAuthData(pin);
  const timestampNow = Math.floor(Date.now() / 1000); // in seconds

  // these are deterministic, so we can avoid using the lib's methods to generate them
  const xpub = 'xpub6D2LLyX98BCEkbTHsE14kgP6atagb9TR3ZBvHYQrT9yEUDYeHVBmrnnyWo3u2cADp4upagFyuu5msxtosceN1FykN22oa41o3fMEJmFG766';
  const xprivAccountPath = 'tnpr4ugT6rZcxFWFVXBpx3YX4eS5LnUwEzGAvfbzQ9tGst2MTBjijC783X5g2LMfxPrbLJxTPHJ99nB6qDbcqehfXDVTtA33cpn49ZuA6s6WQWP';
  const walletId = '83f704d8b24d4f9cc252b080b008280bf4b3342065f7b4baee43fd0ec7186db7';
  const authXpub = 'xpub6AyEt1FdSvP2mXsZfJ4SLHbMugNMQVNdtkhzWoF6nQSSXcstiqEZDXd4Jg7XBscM2K9YMt2ubWXChYXMTAPS99E8Wot1tcMtyfJhhKLZLok';
  const authXprivKey = 'tnpr4sdMdtJ7Gzh3WTc6k7bteFeLfaGc4LBPms84dQiXD8VZWb4yAY9uQFukpEaJLMpqBds8UUiamnmJWYQt97a3qGqZ5dv7yy3fWERia6CAXNh';
  const firstAddress = 'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX';
  const xpubAddress = 'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu';
  const authXpubAddress = 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM';

  const privKeyAccountPath: HDPrivateKey = new HDPrivateKey(xprivAccountPath);
  const authDerivedPrivKey: HDPrivateKey = new HDPrivateKey(authXprivKey);

  const xpubMessage = new Message(String(timestampNow).concat(walletId).concat(xpubAddress));
  const authXpubMessage = new Message(String(timestampNow).concat(walletId).concat(authXpubAddress));

  expect(authData.xpub).toBe(xpub);
  expect(authData.authXpub).toBe(authXpub);
  expect(authData.timestampNow).toBe(timestampNow);
  expect(authData.firstAddress).toBe(firstAddress);
  expect(xpubMessage.verify(xpubAddress, authData.xpubkeySignature)).toBe(true);
  expect(authXpubMessage.verify(authXpubAddress, authData.authXpubkeySignature)).toBe(true);
});
