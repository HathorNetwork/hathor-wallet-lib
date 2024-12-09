/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import buffer from 'buffer';
import Output from '../../src/models/output';
import Address from '../../src/models/address';
import P2PKH from '../../src/models/p2pkh';
import Network from '../../src/models/network';
import { OutputValueError, ParseScriptError } from '../../src/errors';
import { parseP2PKH } from '../../src/utils/scripts';
import {
  AUTHORITY_TOKEN_DATA,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
  MAX_OUTPUT_VALUE,
  MAX_OUTPUT_VALUE_32,
} from '../../src/constants';

const address = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
const p2pkh = new P2PKH(address);
const p2pkhScript = p2pkh.createScript();

test('Validate value', () => {
  // Negative value is invalid
  const o1 = new Output(-1000n, p2pkhScript);
  expect(() => {
    o1.valueToBytes();
  }).toThrow(OutputValueError);

  // 0 value is invalid
  expect(() => {
    const o2 = new Output(0n, p2pkhScript);
    o2.valueToBytes();
  }).toThrow(OutputValueError);

  // Value smaller than 32 bytes max
  const o3 = new Output(MAX_OUTPUT_VALUE_32 - 1n, p2pkhScript);
  expect(o3.valueToBytes()).toStrictEqual(buffer.Buffer.from([0x7f, 0xff, 0xff, 0xfe]));

  // Value equal to 32 bytes max
  const o4 = new Output(MAX_OUTPUT_VALUE_32, p2pkhScript);
  expect(o4.valueToBytes()).toStrictEqual(buffer.Buffer.from([0x7f, 0xff, 0xff, 0xff]));

  // Value greater than 32 bytes max
  const o5 = new Output(MAX_OUTPUT_VALUE_32 + 1n, p2pkhScript);
  expect(o5.valueToBytes()).toStrictEqual(
    buffer.Buffer.from([0xff, 0xff, 0xff, 0xff, 0x80, 0x0, 0x0, 0x0])
  );

  // Value smaller than max
  const o6 = new Output(MAX_OUTPUT_VALUE - 1n, p2pkhScript);
  expect(o6.valueToBytes()).toStrictEqual(
    buffer.Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])
  );

  // Value equal to max
  const o7 = new Output(MAX_OUTPUT_VALUE, p2pkhScript);
  expect(o7.valueToBytes()).toStrictEqual(
    buffer.Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  );

  // Value bigger than the max is invalid
  const o9 = new Output(MAX_OUTPUT_VALUE + 1n, p2pkhScript);
  expect(() => {
    o9.valueToBytes();
  }).toThrow(OutputValueError);
});

test('Authorities', () => {
  const o1 = new Output(1000n, p2pkhScript);
  // By default is not authority because tokenData is 0
  expect(o1.tokenData).toBe(0);
  expect(o1.isAuthority()).toBe(false);

  const o2 = new Output(1000n, p2pkhScript, { tokenData: AUTHORITY_TOKEN_DATA });
  expect(o2.isAuthority()).toBe(true);
  expect(o2.getTokenIndex()).toBe(0);
  expect(o2.isMint()).toBe(false);
  expect(o2.isMelt()).toBe(false);

  // Mint authority output
  const o3 = new Output(TOKEN_MINT_MASK, p2pkhScript, { tokenData: AUTHORITY_TOKEN_DATA + 1 });
  expect(o3.isAuthority()).toBe(true);
  expect(o3.getTokenIndex()).toBe(1);
  expect(o3.isMint()).toBe(true);
  expect(o3.isMelt()).toBe(false);

  // Melt authority output
  const o4 = new Output(TOKEN_MELT_MASK, p2pkhScript, { tokenData: AUTHORITY_TOKEN_DATA + 2 });
  expect(o4.isAuthority()).toBe(true);
  expect(o4.getTokenIndex()).toBe(2);
  expect(o4.isMint()).toBe(false);
  expect(o4.isMelt()).toBe(true);
});

test('Script', () => {
  const network = new Network('testnet');
  const o1 = new Output(1000n, p2pkhScript);
  expect(o1.script).toBeInstanceOf(buffer.Buffer);
  expect(o1.script.length).toBe(25);

  const parsedScript = o1.parseScript(network);
  expect(parsedScript.timelock).toBeNull();
  expect(parsedScript.address.base58).toBe(address.base58);

  // With timelock we have 6 more bytes
  const timelock = 1601421717;
  const p2pkhWithTimelock = new P2PKH(address, { timelock });
  const p2pkhWithTimelockScript = p2pkhWithTimelock.createScript();
  const o2 = new Output(1000n, p2pkhWithTimelockScript);
  expect(o2.script).toBeInstanceOf(buffer.Buffer);
  expect(o2.script.length).toBe(31);

  const parsedScript2 = o2.parseScript(network);
  expect(parsedScript2.timelock).toBe(timelock);
  expect(parsedScript2.address.base58).toBe(address.base58);

  expect(() => {
    parseP2PKH(o1.script.slice(1), network);
  }).toThrow(ParseScriptError);

  expect(() => {
    parseP2PKH(o1.script.slice(10), network);
  }).toThrow(ParseScriptError);
});
