/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import tokens from '../src/tokens';
import { GAP_LIMIT, HATHOR_TOKEN_CONFIG } from '../src/constants';
import { HDPrivateKey } from 'bitcore-lib';
import wallet from '../src/wallet';
import { util } from 'bitcore-lib';
import WebSocketHandler from '../src/WebSocketHandler';
import { InsufficientTokensError } from '../src/errors';

const storage = require('../src/storage').default;

const createdTxHash = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
const createdToken = util.buffer.bufferToHex(tokens.getTokenUID(createdTxHash, 0));
const pin = '123456';

beforeEach(() => {
  WebSocketHandler.started = true;
  wallet.resetAllData();
});

// Mock any POST request to /thin_wallet/send_tokens
// arguments for reply are (status, data, headers)
mock.onPost('thin_wallet/send_tokens').reply((config) => {
  const ret = {
    'success': true,
    'tx': {
      'hash': createdTxHash,
      'tokens': [createdToken],
    }
  }
  return [200, ret];
});

test('Token UID', () => {
  const txID = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
  const txID2 = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295c';
  const uid1 = util.buffer.bufferToHex(tokens.getTokenUID(txID, 0));
  const uid2 = util.buffer.bufferToHex(tokens.getTokenUID(txID, 1));
  const uid3 = util.buffer.bufferToHex(tokens.getTokenUID(txID2, 0));

  expect(uid1.length).toBe(64);
  expect(uid1).not.toBe(uid2);
  expect(uid1).not.toBe(uid3);
});

const loadWallet = async () => {
  const words = 'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray';
  // Generate new wallet and save data in storage
  await wallet.executeGenerateWallet(words, '', pin, 'password', true);
  // Adding funds to wallet
  const address = storage.getItem('wallet:address');
  const savedData = storage.getItem('wallet:data');
  savedData['historyTransactions'] = {
    '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e': {
      'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e',
      'outputs': [
        {
          'decoded': {
            'address': address,
            'token_data': 0
          },
          'value': 100,
          'spent_by': null,
          'token': '00',
        },
      ]
    }
  };
  storage.setItem('wallet:data', savedData);
}

test('New token', async (done) => {
  await loadWallet();
  const address = storage.getItem('wallet:address');
  const tokenName = 'TestCoin';
  const tokenSymbol = 'TTC';
  const promise2 = tokens.createToken(address, tokenName, tokenSymbol, 200, pin);
  promise2.then(() => {
    const savedTokens = tokens.getTokens();
    expect(savedTokens.length).toBe(2);
    expect(savedTokens[1].uid).toBe(createdToken);
    expect(savedTokens[1].name).toBe(tokenName);
    expect(savedTokens[1].symbol).toBe(tokenSymbol);
    expect(tokens.tokenExists(createdToken)).toEqual({'uid': createdToken, 'name': tokenName, 'symbol': tokenSymbol});
    expect(tokens.tokenExists(createdTxHash)).toBe(null);
    const config = tokens.getConfigurationString(createdToken, tokenName, tokenSymbol);
    const receivedToken = tokens.getTokenFromConfigurationString(config);
    expect(receivedToken.uid).toBe(createdToken);
    expect(receivedToken.name).toBe(tokenName);
    expect(receivedToken.symbol).toBe(tokenSymbol);
    done();
  }, (e) => {
    console.log(e)
    done.fail('Error creating token');
  });
}, 15000);

test('Insufficient funds', async (done) => {
  await loadWallet();
  const tokenName = 'TestCoin';
  const tokenSymbol = 'TTC';
  try {
    // we only have 100 tokens on wallet, so minting 2000000 should fail (deposit = 20000)
    tokens.createToken(address, tokenName, tokenSymbol, 2000000, pin);
    done.fail('Should have rejected');
  } catch (e) {
    // this is the successful case
    done();
  }
});

test('Tokens handling', () => {
  const token1 = {'name': '1234', 'uid': '1234', 'symbol': '1234'};
  const token2 = {'name': 'abcd', 'uid': 'abcd', 'symbol': 'abcd'};
  const token3 = {'name': HATHOR_TOKEN_CONFIG.name, 'uid': HATHOR_TOKEN_CONFIG.uid};
  const myTokens = [token1, token2, token3];
  const filteredTokens = tokens.filterTokens(myTokens, HATHOR_TOKEN_CONFIG);

  expect(filteredTokens.length).toBe(2);
  expect(filteredTokens[0].uid).toBe('1234');
  expect(filteredTokens[1].uid).toBe('abcd');

  expect(tokens.getTokenIndex(myTokens, HATHOR_TOKEN_CONFIG.uid)).toBe(0);
  expect(tokens.getTokenIndex(myTokens, '1234')).toBe(1);
  expect(tokens.getTokenIndex(myTokens, 'abcd')).toBe(2);

  // So far we don't have any token added (only hathor)
  const tokens1 = tokens.getTokens();
  const filteredTokens1 = tokens.filterTokens(tokens1, HATHOR_TOKEN_CONFIG);
  expect(filteredTokens1.length).toBe(0);

  // Adding a new one
  tokens.addToken(token1.uid, token1.name, token1.symbol)
  const tokens2 = tokens.getTokens();
  const filteredTokens2 = tokens.filterTokens(tokens2, HATHOR_TOKEN_CONFIG);
  expect(filteredTokens2.length).toBe(1);
  expect(filteredTokens2[0].uid).toBe(token1.uid);
  expect(filteredTokens2[0].name).toBe(token1.name);
  expect(filteredTokens2[0].symbol).toBe(token1.symbol);

  // Editting added token
  tokens.editToken(token1.uid, token1.name, token2.symbol)
  const tokens3 = tokens.getTokens();
  const filteredTokens3 = tokens.filterTokens(tokens3, HATHOR_TOKEN_CONFIG);
  expect(filteredTokens3.length).toBe(1);
  expect(filteredTokens3[0].uid).toBe(token1.uid);
  expect(filteredTokens3[0].name).toBe(token1.name);
  expect(filteredTokens3[0].symbol).toBe(token2.symbol);

  // Unregister the added token
  tokens.unregisterToken(token1.uid);
  const tokens4 = tokens.getTokens();
  const filteredTokens4 = tokens.filterTokens(tokens4, HATHOR_TOKEN_CONFIG);
  expect(filteredTokens4.length).toBe(0);

  // Validates configuration string before add
  const config = tokens.getConfigurationString(token1.uid, token1.name, token1.symbol);
  expect(tokens.validateTokenToAddByConfigurationString(config).success).toBe(true);
  expect(tokens.validateTokenToAddByConfigurationString(config, token2.uid).success).toBe(false);
  expect(tokens.validateTokenToAddByConfigurationString(config+'a').success).toBe(false);
  expect(tokens.validateTokenToAddByConfigurationString('').success).toBe(false);

  // Cant add the same token twice
  tokens.addToken(token1.uid, token1.name, token1.symbol)
  expect(tokens.validateTokenToAddByConfigurationString(config).success).toBe(false);
});
