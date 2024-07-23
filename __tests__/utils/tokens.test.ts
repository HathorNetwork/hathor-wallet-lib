/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import tokens from '../../src/utils/tokens';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import walletApi from '../../src/api/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import { TokenValidationError } from '../../src/errors';

test('Validate configuration string', async () => {
  const uid = '0000360f5e95c492352a6f1cab81b33d56694299f1da2b437107b2b1edde9687';
  const uid2 = '0000cafe5e95c492352a6f1cab81b33d56694299f1da2b437107b2b1edde9687';
  const name = 'Test Token';
  const symbol = 'TST';
  const configString = `[${name}:${symbol}:${uid}:8d977dec]`;

  const apiSpy = jest.spyOn(walletApi, 'getGeneralTokenInfo');
  const store = new MemoryStore();
  const storage = new Storage(store);

  // Invalid config string should throw
  await expect(tokens.validateTokenToAddByConfigurationString('invalid-string')).rejects.toThrow(
    'Invalid configuration string'
  );
  await expect(tokens.validateTokenToAddByConfigurationString('invalid-string')).rejects.toThrow(
    TokenValidationError
  );
  await expect(
    tokens.validateTokenToAddByConfigurationString('invalid-string', storage)
  ).rejects.toThrow(TokenValidationError);

  // Should throw if uid does not match the expected uid
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, null, 'expected-uid')
  ).rejects.toThrow('Configuration string uid does not match');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, null, 'expected-uid')
  ).rejects.toThrow(TokenValidationError);
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage, 'expected-uid')
  ).rejects.toThrow(TokenValidationError);

  // should throw if token is already registered
  await store.registerToken({ uid, name, symbol });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow('You already have this token');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow(TokenValidationError);
  await store.unregisterToken(uid);

  // Should throw if we have a similarly named token
  await store.registerToken({ uid: uid2, name: 'Test  Token', symbol: 'TST2' });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow('You already have a token with this name');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow(TokenValidationError);
  await store.unregisterToken(uid2);

  await store.registerToken({ uid: uid2, name: 'Another test name', symbol: 'TST' });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow('You already have a token with this symbol');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow(TokenValidationError);
  await store.unregisterToken(uid2);

  // Should throw if we cannot verify the existence of the token with the api
  apiSpy.mockImplementation((_, cb) => {
    cb({ success: false, message: 'boom!' });
  });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow('boom!');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow(TokenValidationError);

  apiSpy.mockImplementation((_, cb) => {
    cb({ success: true, name: 'Another name', symbol });
  });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow('Token name does not match');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow(TokenValidationError);

  apiSpy.mockImplementation((_, cb) => {
    cb({ success: true, name, symbol: 'Another symbol' });
  });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow('Token symbol does not match');
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).rejects.toThrow(TokenValidationError);

  // With no conflicts in storage and the api confirming the token is valid
  // we expect the token data to be returned
  apiSpy.mockImplementation((_, cb) => {
    cb({ success: true, name, symbol });
  });
  await expect(
    tokens.validateTokenToAddByConfigurationString(configString, storage)
  ).resolves.toEqual({ uid, name, symbol });

  apiSpy.mockRestore();
});

test('Configuration String', () => {
  const uid = '0000360f5e95c492352a6f1cab81b33d56694299f1da2b437107b2b1edde9687';
  const name = 'Test Token';
  const symbol = 'TST';
  const configString = `[${name}:${symbol}:${uid}:8d977dec]`;

  expect(tokens.isConfigurationStringValid('')).toBe(false);
  expect(tokens.isConfigurationStringValid('abc')).toBe(false);
  expect(tokens.isConfigurationStringValid(configString)).toBe(true);

  const tokenObj = tokens.getTokenFromConfigurationString(configString);
  expect(tokenObj.uid).toBe(uid);
  expect(tokenObj.name).toBe(name);
  expect(tokenObj.symbol).toBe(symbol);

  expect(tokens.getConfigurationString(uid, name, symbol)).toBe(configString);
});

test('Token index', () => {
  const configs = [
    { uid: 'a', name: 'b', symbol: 'c' },
    { uid: 'd', name: 'e', symbol: 'f' },
  ];
  expect(tokens.getTokenIndex(configs, NATIVE_TOKEN_UID)).toBe(0);
  expect(tokens.getTokenIndex(configs, 'a')).toBe(1);
  expect(tokens.getTokenIndex(configs, 'd')).toBe(2);

  expect(tokens.isHathorToken('a')).toBe(false);
  expect(tokens.isHathorToken(NATIVE_TOKEN_UID)).toBe(true);
});

test('Token deposit', () => {
  // considering HTR deposit is 1%
  expect(tokens.getDepositAmount(100n)).toBe(1);
  expect(tokens.getDepositAmount(1n)).toBe(1);
  expect(tokens.getDepositAmount(500n)).toBe(5);
  expect(tokens.getDepositAmount(550n)).toBe(6);
});

test('Fee for data script output', () => {
  expect(tokens.getDataScriptOutputFee()).toBe(1);
});

test('Token withdraw', () => {
  // considering HTR deposit is 1%
  expect(tokens.getWithdrawAmount(100n)).toBe(1);
  expect(tokens.getWithdrawAmount(99n)).toBe(0);
  expect(tokens.getWithdrawAmount(500n)).toBe(5);
  expect(tokens.getWithdrawAmount(550n)).toBe(5);
});
