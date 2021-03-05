/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import tokens from '../../src/utils/tokens';
import { HATHOR_TOKEN_CONFIG } from '../../src/constants';


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
    {uid: 'a', name: 'b', symbol: 'c'},
    {uid: 'd', name: 'e', symbol: 'f'},
  ];
  expect(tokens.getTokenIndex(configs, HATHOR_TOKEN_CONFIG.uid)).toBe(0);
  expect(tokens.getTokenIndex(configs, 'a')).toBe(1);
  expect(tokens.getTokenIndex(configs, 'd')).toBe(2);

  expect(tokens.isHathorToken('a')).toBe(false);
  expect(tokens.isHathorToken(HATHOR_TOKEN_CONFIG.uid)).toBe(true);
});

test('Token deposit', () => {
  // considering HTR deposit is 1%
  expect(tokens.getDepositAmount(100)).toBe(1);
  expect(tokens.getDepositAmount(1)).toBe(1);
  expect(tokens.getDepositAmount(0.1)).toBe(1);
  expect(tokens.getDepositAmount(500)).toBe(5);
  expect(tokens.getDepositAmount(550)).toBe(6);
});

test('Token withdraw', () => {
  // considering HTR deposit is 1%
  expect(tokens.getWithdrawAmount(100)).toBe(1);
  expect(tokens.getWithdrawAmount(99)).toBe(0);
  expect(tokens.getWithdrawAmount(500)).toBe(5);
  expect(tokens.getWithdrawAmount(550)).toBe(5);
});