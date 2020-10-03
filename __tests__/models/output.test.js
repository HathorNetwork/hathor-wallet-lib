/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Output from '../../src/models/output';
import Address from '../../src/models/address';
import { OutputValueError } from '../../src/errors';
import buffer from 'buffer';
import { AUTHORITY_TOKEN_DATA, TOKEN_MINT_MASK, TOKEN_MELT_MASK, MAX_OUTPUT_VALUE } from '../../src/constants';


test('Validate value', () => {
  const o1 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  expect(o1.valueToBytes()).toBeInstanceOf(buffer.Buffer);

  // Negative value is invalid
  const o2 = new Output(-1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  expect(() => {
    o2.valueToBytes();
  }).toThrowError(OutputValueError);

  // Value bigger than the max is invalid
  const o3 = new Output(MAX_OUTPUT_VALUE + 1, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  expect(() => {
    o3.valueToBytes();
  }).toThrowError(OutputValueError);
})

test('Authorities', () => {
  const o1 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  // By default is not authority because tokenData is 0
  expect(o1.tokenData).toBe(0);
  expect(o1.isAuthority()).toBe(false);

  const o2 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {tokenData: AUTHORITY_TOKEN_DATA});
  expect(o2.isAuthority()).toBe(true);
  expect(o2.getTokenIndex()).toBe(1);
  expect(o2.isMint()).toBe(false);
  expect(o2.isMelt()).toBe(false);

  // Mint authority output
  const o3 = new Output(TOKEN_MINT_MASK, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {tokenData: AUTHORITY_TOKEN_DATA + 1});
  expect(o3.isAuthority()).toBe(true);
  expect(o3.getTokenIndex()).toBe(2);
  expect(o3.isMint()).toBe(true);
  expect(o3.isMelt()).toBe(false);

  // Melt authority output
  const o4 = new Output(TOKEN_MELT_MASK, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {tokenData: AUTHORITY_TOKEN_DATA + 2});
  expect(o4.isAuthority()).toBe(true);
  expect(o4.getTokenIndex()).toBe(3);
  expect(o4.isMint()).toBe(false);
  expect(o4.isMelt()).toBe(true);
});

test('Script', () => {
  const o1 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  const script1 = o1.createScript();
  expect(script1).toBeInstanceOf(buffer.Buffer);
  expect(script1.length).toBe(25);

  // With timelock we have 6 more bytes
  const o2 = new Output(1000, new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), {timelock: 1601421717});
  const script2 = o2.createScript();
  expect(script2).toBeInstanceOf(buffer.Buffer);
  expect(script2.length).toBe(31);
});