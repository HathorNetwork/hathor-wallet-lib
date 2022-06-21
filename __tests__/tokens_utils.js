/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import tokens from '../src/tokens';
import { DEFAULT_TX_VERSION, GAP_LIMIT, HATHOR_TOKEN_CONFIG } from '../src/constants';
import { HDPrivateKey } from 'bitcore-lib';
import wallet from '../src/wallet';
import version from '../src/version';
import { util } from 'bitcore-lib';
import WebSocketHandler from '../src/WebSocketHandler';
import { TokenValidationError } from '../src/errors';
import storage from '../src/storage';
import lodash from 'lodash';


const createdTxHashBeforeMining = '5ecac1124aada88c750acdccede58d0308b593923c3034f373403b63ba4edbac';
const createdToken = util.buffer.bufferToHex(tokens.getTokenUID(createdTxHashBeforeMining, 0));
const pin = '123456';
const token1 = {'name': '1234', 'uid': '1234', 'symbol': '1234'};

beforeEach(() => {
  WebSocketHandler.started = true;
  wallet.setConnection(WebSocketHandler);
  wallet.resetAllData();
  // Because we call resetAllData we must set the localhost as server again here
  storage.setItem('wallet:server', 'http://localhost:8080/');
});

// Mock any POST request to push_tx
// arguments for reply are (status, data, headers)
mock.onPost('push_tx').reply((config) => {
  const ret = {
    'success': true,
    'tx': {
      'hash': createdTxHashBeforeMining,
      'tokens': [createdToken],
    }
  }
  return [200, ret];
});

mock.onPost('submit-job').reply((config) => {
  const data = {
    success: true,
    job_id: '123',
    expected_total_time: 1,
    status: 'mining',
  };
  return [200, data];
});

mock.onGet('job-status').reply((config) => {
  const data = {
    success: true,
    expected_total_time: 0,
    job_id: '123',
    status: 'done',
    tx: {
      parents: [
        '00000257054251161adff5899a451ae974ac62ca44a7a31179eec5750b0ea406',
        '00000b8792cb13e8adb51cc7d866541fc29b532e8dec95ae4661cf3da4d42cb4'
      ],
      nonce: '0x4D2',
      timestamp: 123456,
    }
  };
  return [200, data];
});

mock.onGet('thin_wallet/token').reply((config) => {
  let ret = {};
  if (config.params.id === token1.uid) {
    ret = {
      'mint': [],
      'melt': [],
      'name': token1.name,
      'symbol': token1.symbol,
      'total': 100,
      'success': true,
    }
  } else {
    ret = {
      'success': false,
      'message': 'Unknown token',
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
  await version.checkApiVersion();
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
  const ret = tokens.createToken(address, tokenName, tokenSymbol, 200, pin);
  const sendTransaction = ret.sendTransaction;
  sendTransaction.start();
  // We must do this, otherwise the setTimeout method will be called with a null localStorage
  sendTransaction.updateOutputSelected(false);
  ret.promise.then(() => {
    const savedTokens = tokens.getTokens();
    expect(savedTokens.length).toBe(2);
    expect(savedTokens[1].uid).toBe(createdTxHashBeforeMining);
    expect(savedTokens[1].name).toBe(tokenName);
    expect(savedTokens[1].symbol).toBe(tokenSymbol);
    expect(tokens.tokenExists(createdTxHashBeforeMining)).toEqual({'uid': createdTxHashBeforeMining, 'name': tokenName, 'symbol': tokenSymbol});
    const config = tokens.getConfigurationString(createdTxHashBeforeMining, tokenName, tokenSymbol);
    const receivedToken = tokens.getTokenFromConfigurationString(config);
    expect(receivedToken.uid).toBe(createdTxHashBeforeMining);
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
  const address = storage.getItem('wallet:address');

  // we only have 100 tokens on wallet, so minting 2000000 should fail (deposit = 20000)
  const ret = tokens.createToken(address, tokenName, tokenSymbol, 2000000, pin);
  if (ret.success) {
    done.fail('Should be success false');
  } else {
    done();
  }
});

test('Tokens handling', async () => {
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
  await expect(tokens.validateTokenToAddByConfigurationString(config)).resolves.toBeInstanceOf(Object);
  await expect(tokens.validateTokenToAddByConfigurationString(config, token2.uid)).rejects.toThrow(TokenValidationError);
  await expect(tokens.validateTokenToAddByConfigurationString(config+'a')).rejects.toThrow(TokenValidationError);
  await expect(tokens.validateTokenToAddByConfigurationString('')).rejects.toThrow(TokenValidationError);

  // Cant add the same token twice
  tokens.addToken(token1.uid, token1.name, token1.symbol)
  await expect(tokens.validateTokenToAddByConfigurationString(config)).rejects.toThrow(TokenValidationError);

  // New config string that will return false because the token is unknown
  const unknownConfig = tokens.getConfigurationString('1', 'Unknown Token', 'UTK');
  await expect(tokens.validateTokenToAddByConfigurationString(unknownConfig)).rejects.toThrow(TokenValidationError);
});

test('Token deposit', () => {
  tokens.updateDepositPercentage(0.01);
  // considering HTR deposit is 1%
  expect(tokens.getDepositAmount(100)).toBe(1);
  expect(tokens.getDepositAmount(1)).toBe(1);
  expect(tokens.getDepositAmount(0.1)).toBe(1);
  expect(tokens.getDepositAmount(500)).toBe(5);
  expect(tokens.getDepositAmount(550)).toBe(6);
});

test('Token withdraw', () => {
  tokens.updateDepositPercentage(0.01);
  // considering HTR deposit is 1%
  expect(tokens.getWithdrawAmount(100)).toBe(1);
  expect(tokens.getWithdrawAmount(99)).toBe(0);
  expect(tokens.getWithdrawAmount(500)).toBe(5);
  expect(tokens.getWithdrawAmount(550)).toBe(5);
});

describe('isNFTToken', () => {
  const sampleNftTx = {
    tx_id: '006b972eb0d560b168f1d544c7d772e27860a9bc2f21ab7a2a992ea5ad3a99d8',
    version: 2,
    weight: 8.000001,
    timestamp: 1655305812,
    is_voided: false,
    nonce: 123,
    inputs: [
      {
        value: 100,
        token_data: 0,
        script: 'dqkUaf+xVJ8uAPML/AzwuSB+2W9/M7qIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT',
          timelock: null,
        },
        token: '00',
        tx_id: '00d11791843e284ce6ad833ee3ee2f3b88cacb6d3888be0eae400abc8d643b8c',
        index: 1,
      },
    ],
    outputs: [
      {
        value: 1,
        token_data: 0,
        script: 'TIdpcGZzOi8vYmFmeWJlaWNjZmNsa2R0dWN1Nnk0eWM1Y3ByNnkzeXVpbnI2N3N2bWlpNDZ2NWNmY3JrcDQ3aWhlaHkvYWxidW1zL1FYQnZiR3h2SURFd0lFMWhaMkY2YVc1bElESTNMMDQ9LzIxNzE2Njk1NzQ4XzczOTA4MTUyMThfby5qcGes',
        decoded: {},
        token: '00',
        spent_by: null,
        selected_as_input: false,
      },
      {
        value: 98,
        token_data: 0,
        script: 'dqkUQcQx/3rV1s5VZXqZPc1dkQbPo6eIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'WUfmqHWQZWn7aodAFadwmSDfh2QaUUgCRJ',
          timelock: null,
        },
        token: '00',
        spent_by: null,
        selected_as_input: false,
      },
      {
        value: 1,
        token_data: 1,
        script: 'dqkUQcQx/3rV1s5VZXqZPc1dkQbPo6eIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'WUfmqHWQZWn7aodAFadwmSDfh2QaUUgCRJ',
          timelock: null,
        },
        token: '006b972eb0d560b168f1d544c7d772e27860a9bc2f21ab7a2a992ea5ad3a99d8',
        spent_by: null,
        selected_as_input: false,
      },
      {
        value: 1,
        token_data: 129,
        script: 'dqkU1YP+t130UoYD+3ys9MYt1zkWeY6IrA==',
        decoded: {
          type: 'P2PKH',
          address: 'Wi8zvxdXHjaUVAoCJf52t3WovTZYcU9aX6',
          timelock: null,
        },
        token: '006b972eb0d560b168f1d544c7d772e27860a9bc2f21ab7a2a992ea5ad3a99d8',
        spent_by: null,
        selected_as_input: false,
      },
      {
        value: 2,
        token_data: 129,
        script: 'dqkULlcsARvA+pQS8qytBr6Ryjc/SLeIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'WSu4PZVu6cvi3aejtG8w7bomVmg77DtqYt',
          timelock: null,
        },
        token: '006b972eb0d560b168f1d544c7d772e27860a9bc2f21ab7a2a992ea5ad3a99d8',
        spent_by: null,
        selected_as_input: false,
      },
    ],
    parents: [
      '00d11791843e284ce6ad833ee3ee2f3b88cacb6d3888be0eae400abc8d643b8c',
      '54165cef1fd4cf2240d702b8383c307c822c16ca407f78014bdefa189a7571c2',
    ],
    token_name: 'New NFT',
    token_symbol: 'NNFT',
    tokens: [],
  };
  const cloneNftSample = () => lodash.cloneDeep(sampleNftTx);

  it('should return false for an empty transaction object', () => {
    expect.assertions(1);
    expect(tokens.isNFTToken(null)).toBe(false);
  });

  it('should return false for a default transaction version', () => {
    expect.assertions(1);
    const tx = cloneNftSample();
    tx.version = DEFAULT_TX_VERSION;
    expect(tokens.isNFTToken(tx)).toBe(false);
  });

  it('should return false for a token-creating tx with less than 2 outputs', () => {
    expect.assertions(1);
    const tx = cloneNftSample();
    tx.outputs.length = 1;
    expect(tokens.isNFTToken(tx)).toBe(false);
  });

  it('should return false for a fee output with wrong data', () => {
    expect.assertions(2);
    const tx = cloneNftSample();

    // Wrong Value
    tx.outputs[0].value = 2;
    expect(tokens.isNFTToken(tx)).toBe(false);

    // Wrong Token Data
    tx.outputs[0].value = 1;
    tx.outputs[0].token_data = 1;
    expect(tokens.isNFTToken(tx)).toBe(false);
  });

  it('should return false for having a non-standard output script', () => {
    expect.assertions(2);
    const tx = cloneNftSample();

    // Script too large
    tx.outputs[1].script = 'a'.repeat(257);
    expect(tokens.isNFTToken(tx)).toBe(false);

    // Non-standard output type
    tx.outputs[1].script = sampleNftTx.outputs[1].script;
    tx.outputs[1].decoded.type = 'data';
    expect(tokens.isNFTToken(tx)).toBe(false);
  });

  it('should return false for having a non-standard token on outputs', () => {
    expect.assertions(1);
    const tx = cloneNftSample();

    // Changing one of the outputs to be of another token
    tx.outputs[1].token = '54165cef1fd4cf2240d702b8383c307c822c16ca407f78014bdefa189a7571c2';
    expect(tokens.isNFTToken(tx)).toBe(false);
  });

  it('should return false for having a non-standard token on inputs', () => {
    expect.assertions(1);
    const tx = cloneNftSample();

    // Changing one of the outputs to be of another token
    tx.inputs[0].token = '54165cef1fd4cf2240d702b8383c307c822c16ca407f78014bdefa189a7571c2';
    expect(tokens.isNFTToken(tx)).toBe(false);
  });

  it('should return true for a valid NFT creation transaction', () => {
    expect.assertions(1);
    expect(tokens.isNFTToken(sampleNftTx)).toBe(true);
  });

  it('should return true for a NFT without change', () => {
    expect.assertions(1);
    const tx = cloneNftSample();

    tx.outputs = [
      sampleNftTx.outputs[0], // Fee
      sampleNftTx.outputs[2], // Token
      sampleNftTx.outputs[3], // Mint
      sampleNftTx.outputs[4], // Melt
    ];
    expect(tokens.isNFTToken(tx)).toBe(true);
  });

  it('should return true for a NFT without mint and/or melt', () => {
    expect.assertions(3);
    const tx = cloneNftSample();

    tx.outputs = [
      sampleNftTx.outputs[0], // Fee
      sampleNftTx.outputs[2], // Token
      sampleNftTx.outputs[3], // Mint
    ];
    expect(tokens.isNFTToken(tx)).toBe(true);

    tx.outputs = [
      sampleNftTx.outputs[0], // Fee
      sampleNftTx.outputs[2], // Token
      sampleNftTx.outputs[4], // Melt
    ];
    expect(tokens.isNFTToken(tx)).toBe(true);

    tx.outputs = [
      sampleNftTx.outputs[0], // Fee
      sampleNftTx.outputs[2], // Token
    ];
    expect(tokens.isNFTToken(tx)).toBe(true);
  });

  it('should return false for a NFT with 2+ mint and/or melt outputs', () => {
    expect.assertions(2);
    const tx = cloneNftSample();

    tx.outputs = [
      sampleNftTx.outputs[0], // Fee
      sampleNftTx.outputs[2], // Token
      sampleNftTx.outputs[3], // Mint
      sampleNftTx.outputs[3], // Mint
    ];
    expect(tokens.isNFTToken(tx)).toBe(false);

    tx.outputs = [
      sampleNftTx.outputs[0], // Fee
      sampleNftTx.outputs[2], // Token
      sampleNftTx.outputs[4], // Melt
      sampleNftTx.outputs[4], // Melt
    ];
    expect(tokens.isNFTToken(tx)).toBe(false);
  });
});
