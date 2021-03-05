/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import helpers from '../../src/utils/helpers';
import Transaction from '../../src/models/transaction';
import Output from '../../src/models/output';
import Input from '../../src/models/input';
import Address from '../../src/models/address';
import buffer from 'buffer';
import { OP_PUSHDATA1 } from '../../src/opcodes';

const nodeMajorVersion = process.versions.node.split('.')[0];


test('Round float', () => {
  expect(helpers.roundFloat(1.23)).toBe(1.23);
  expect(helpers.roundFloat(1.2345)).toBe(1.23);
  expect(helpers.roundFloat(1.2355)).toBe(1.24);
});

test('Pretty value', () => {
  expect(helpers.prettyValue(1000)).toBe('10.00');
  expect(helpers.prettyValue(100000)).toBe('1,000.00');
  expect(helpers.prettyValue(100000000)).toBe('1,000,000.00');
});

test('Version check', () => {
  expect(helpers.isVersionAllowed('2.0.1-beta', '0.1.1')).toBe(false);
  expect(helpers.isVersionAllowed('2.0.1-beta', '0.1.1-beta')).toBe(true);

  expect(helpers.isVersionAllowed('2.0.1', '3.1.1')).toBe(false);
  expect(helpers.isVersionAllowed('2.1.1', '2.1.1')).toBe(true);
  expect(helpers.isVersionAllowed('3.1.1', '2.1.1')).toBe(true);
  expect(helpers.isVersionAllowed('0.1.1', '0.2.1')).toBe(false);
  expect(helpers.isVersionAllowed('0.3.1', '0.2.1')).toBe(true);
  expect(helpers.isVersionAllowed('0.3.1', '0.3.0')).toBe(true);
  expect(helpers.isVersionAllowed('0.3.1', '0.3.2')).toBe(false);

  expect(helpers.getCleanVersionArray('0.3.1')).toEqual(["0", "3", "1"]);
  expect(helpers.getCleanVersionArray('0.3.2-beta')).toEqual(["0", "3", "2"]);
});

test('Unsigned int to bytes', () => {
  let number1 = 10;
  let buf1 = helpers.intToBytes(number1, 1);
  expect(buf1.readUInt8(0)).toBe(number1);

  let number2 = 300;
  let buf2 = helpers.intToBytes(number2, 2);
  expect(buf2.readUInt16BE(0)).toBe(number2);

  let number3 = 70000;
  let buf3 = helpers.intToBytes(number3, 4);
  expect(buf3.readUInt32BE(0)).toBe(number3);
});

test('Signed int to bytes', () => {
  let number1 = 10;
  let buf1 = helpers.signedIntToBytes(number1, 1);
  expect(buf1.readInt8(0)).toBe(number1);

  let number2 = 300;
  let buf2 = helpers.signedIntToBytes(number2, 2);
  expect(buf2.readInt16BE(0)).toBe(number2);

  let number3 = 70000;
  let buf3 = helpers.signedIntToBytes(number3, 4);
  expect(buf3.readInt32BE(0)).toBe(number3);

  let number4 = 2**33;
  let buf4 = helpers.signedIntToBytes(number4, 8);
  if (nodeMajorVersion > 8) {
    expect(buf4.readBigInt64BE(0)).toBe(BigInt(number4));
  } else {
    expect(buf4.readIntBE(0, 8)).toBe(number4);
  }
});

test('Float to bytes', () => {
  let number = 10.5;
  let buffer = helpers.floatToBytes(number, 8);
  expect(buffer.readDoubleBE(0)).toBe(number);
});

test('Push data', () => {
  let stack = [];
  let buf = buffer.Buffer.alloc(5);
  helpers.pushDataToStack(stack, buf);
  expect(stack.length).toBe(2);
  expect(stack[0].readUInt8(0)).toBe(5);
  expect(stack[1]).toBe(buf);

  let newStack = [];
  let newBuf = buffer.Buffer.alloc(100);
  helpers.pushDataToStack(newStack, newBuf);
  expect(newStack.length).toBe(3);
  expect(newStack[0]).toBe(OP_PUSHDATA1);
  expect(newStack[1].readUInt8(0)).toBe(100);
  expect(newStack[2]).toBe(newBuf);
});

test('Checksum', () => {
  const data = Buffer.from([0x28, 0xab, 0xca, 0x4e, 0xad, 0xc0, 0x59, 0xd3, 0x24, 0xce, 0x46, 0x99, 0x5c, 0x41, 0x06, 0x5d, 0x71, 0x86, 0x0a, 0xd7, 0xb0]);
  expect(helpers.getChecksum(data)).toEqual(Buffer.from([0x6b, 0x13, 0xb9, 0x78]));
});