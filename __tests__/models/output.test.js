/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Output from '../../src/models/output';
import Address from '../../src/models/address';
import Network from '../../src/models/network';
import { OutputValueError, ParseScriptError } from '../../src/errors';
import buffer from 'buffer';
import { parseOutputScript } from '../../src/utils/scripts';
import { AUTHORITY_TOKEN_DATA, TOKEN_MINT_MASK, TOKEN_MELT_MASK, MAX_OUTPUT_VALUE } from '../../src/constants';


test('Validate value', () => {
  const o1 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  expect(o1.valueToBytes()).toBeInstanceOf(buffer.Buffer);

  // Negative value is invalid
  const o2 = new Output(-1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  expect(() => {
    o2.valueToBytes();
  }).toThrowError(OutputValueError);

  // 0 value is invalid
  expect(() => {
    const o3 = new Output(0, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
    o3.valueToBytes();
  }).toThrowError(OutputValueError);

  // Value bigger than the max is invalid
  const o4 = new Output(MAX_OUTPUT_VALUE + 1, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  expect(() => {
    o4.valueToBytes();
  }).toThrowError(OutputValueError);
})

test('Authorities', () => {
  const o1 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  // By default is not authority because tokenData is 0
  expect(o1.tokenData).toBe(0);
  expect(o1.isAuthority()).toBe(false);

  const o2 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {tokenData: AUTHORITY_TOKEN_DATA});
  expect(o2.isAuthority()).toBe(true);
  expect(o2.getTokenIndex()).toBe(0);
  expect(o2.isMint()).toBe(false);
  expect(o2.isMelt()).toBe(false);

  // Mint authority output
  const o3 = new Output(TOKEN_MINT_MASK, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {tokenData: AUTHORITY_TOKEN_DATA + 1});
  expect(o3.isAuthority()).toBe(true);
  expect(o3.getTokenIndex()).toBe(1);
  expect(o3.isMint()).toBe(true);
  expect(o3.isMelt()).toBe(false);

  // Melt authority output
  const o4 = new Output(TOKEN_MELT_MASK, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {tokenData: AUTHORITY_TOKEN_DATA + 2});
  expect(o4.isAuthority()).toBe(true);
  expect(o4.getTokenIndex()).toBe(2);
  expect(o4.isMint()).toBe(false);
  expect(o4.isMelt()).toBe(true);
});

test('Script', () => {
  const network = new Network('testnet');
  const addr = 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo';
  const o1 = new Output(1000, new Address(addr, {network}));
  const script1 = o1.createScript();
  expect(script1).toBeInstanceOf(buffer.Buffer);
  expect(script1.length).toBe(25);

  const parsedScript = parseOutputScript(script1, network);
  expect(parsedScript.timelock).toBeNull();
  expect(parsedScript.address.base58).toBe(addr);

  // With timelock we have 6 more bytes
  const timelock = 1601421717;
  const o2 = new Output(1000, new Address(addr, {network}), {timelock});
  const script2 = o2.createScript();
  expect(script2).toBeInstanceOf(buffer.Buffer);
  expect(script2.length).toBe(31);

  const parsedScript2 = parseOutputScript(script2, network);
  expect(parsedScript2.timelock).toBe(timelock);
  expect(parsedScript2.address.base58).toBe(addr);

  expect(() => {
    parseOutputScript(script1.slice(1), network);
  }).toThrowError(ParseScriptError);

  expect(() => {
    parseOutputScript(script1.slice(10), network);
  }).toThrowError(ParseScriptError);
});