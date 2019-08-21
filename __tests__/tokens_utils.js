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
import version from '../src/version';
import { util } from 'bitcore-lib';
import WebSocketHandler from '../src/WebSocketHandler';

const storage = require('../src/storage').default;

const createdTxHash = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
const createdToken = util.buffer.bufferToHex(tokens.getTokenUID(createdTxHash, 0));

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

const readyLoadHistory = (pin) => {
  const encrypted = storage.getItem('wallet:accessData').mainKey;
  const privKeyStr = wallet.decryptData(encrypted, pin);
  const privKey = HDPrivateKey(privKeyStr)
  return wallet.loadAddressHistory(0, GAP_LIMIT, privKey, pin);
}

test('New token', (done) => {
  const words = 'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray';
  const pin = '123456';
  // Generate new wallet and save data in storage
  wallet.executeGenerateWallet(words, '', pin, 'password', false);
  const promise = readyLoadHistory(pin);
  const address = storage.getItem('wallet:address');
  version.checkApiVersion().then(() => {
    promise.then(() => {
      // Adding data to storage to be used in the signing process
      const savedData = storage.getItem('wallet:data');
      const createdKey = `${createdTxHash},0`;
      savedData['historyTransactions'] = {
        '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e': {
          'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e',
          'outputs': [
            {
              'decoded': {
                'address': address
              },
              'value': 1000,
            },
          ]
        }
      };
      storage.setItem('wallet:data', savedData);
      const input = {'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 'index': '0', 'token': '00', 'address': address};
      const output = {'address': address, 'value': 100, 'tokenData': 0};
      const tokenName = 'TestCoin';
      const tokenSymbol = 'TTC';
      const promise2 = tokens.createToken(input, output, address, tokenName, tokenSymbol, 200, pin, null, null);
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
        done.fail('Error creating token');
      });
    }, (e) => {
      done.fail('Error creating token');
    })
  }, (e) => {
    done.fail('Error creating token');
  });
}, 15000);

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
