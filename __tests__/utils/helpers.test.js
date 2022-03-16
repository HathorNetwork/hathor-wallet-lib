/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import helpers from '../../src/utils/helpers';
import Network from '../../src/models/network';
import dateFormatter from '../../src/date';
import { unpackToInt, unpackToFloat, hexToBuffer, bufferToHex } from '../../src/utils/buffer';
import Transaction from '../../src/models/transaction';
import Output from '../../src/models/output';
import Input from '../../src/models/input';
import Address from '../../src/models/address';
import P2PKH from '../../src/models/p2pkh';
import P2SH from '../../src/models/p2sh';
import ScriptData from '../../src/models/script_data';
import buffer from 'buffer';
import { OP_PUSHDATA1 } from '../../src/opcodes';
import { DEFAULT_TX_VERSION, CREATE_TOKEN_TX_VERSION } from '../../src/constants';

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
  expect(unpackToInt(1, false, buf1)[0]).toBe(number1);

  let number2 = 300;
  let buf2 = helpers.intToBytes(number2, 2);
  expect(unpackToInt(2, false, buf2)[0]).toBe(number2);

  let number3 = 70000;
  let buf3 = helpers.intToBytes(number3, 4);
  expect(unpackToInt(4, false, buf3)[0]).toBe(number3);
});

test('Signed int to bytes', () => {
  let number1 = 10;
  let buf1 = helpers.signedIntToBytes(number1, 1);
  expect(unpackToInt(1, true, buf1)[0]).toBe(number1);

  let number2 = 300;
  let buf2 = helpers.signedIntToBytes(number2, 2);
  expect(unpackToInt(2, true, buf2)[0]).toBe(number2);

  let number3 = 70000;
  let buf3 = helpers.signedIntToBytes(number3, 4);
  expect(unpackToInt(4, true, buf3)[0]).toBe(number3);

  let number4 = 2**33;
  let buf4 = helpers.signedIntToBytes(number4, 8);
  expect(unpackToInt(8, true, buf4)[0]).toBe(number4);
});

test('Float to bytes', () => {
  let number = 10.5;
  let buffer = helpers.floatToBytes(number, 8);
  expect(unpackToFloat(buffer)[0]).toBe(number);
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

test('Push integer', () => {
  let stack = [];
  for (let i = 0; i < 17; i++) {
    helpers.pushIntToStack(stack, i);
    // Only added 1 item to stack
    expect(stack.length).toBe(i+1);
    // Pushed int is the OP_N
    expect(stack[i].readUInt8(0)).toBe(i+80);
  }

  // Calling the method does not change any other part of the stack
  for (let i = 0; i < 17; i++) {
    expect(stack[i].readUInt8(0)).toBe(i+80);
  }

  expect(() => helpers.pushIntToStack(stack, -1)).toThrow();
  expect(() => helpers.pushIntToStack(stack, 17)).toThrow();
});

test('Checksum', () => {
  const data = Buffer.from([0x28, 0xab, 0xca, 0x4e, 0xad, 0xc0, 0x59, 0xd3, 0x24, 0xce, 0x46, 0x99, 0x5c, 0x41, 0x06, 0x5d, 0x71, 0x86, 0x0a, 0xd7, 0xb0]);
  expect(helpers.getChecksum(data)).toEqual(Buffer.from([0x6b, 0x13, 0xb9, 0x78]));
});

test('Buffer to hex', () => {
  const hexString = '044f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1';
  const buff = hexToBuffer(hexString);
  expect(bufferToHex(buff)).toBe(hexString);
});

test('createTxFromData', () => {
  const testnet = new Network('testnet');
  // create token transaction
  const createTokenTx = {
      'name': 'test token',
      'symbol': 'TST',
      'tokens': ['01'],
      'timestamp': dateFormatter.dateToTimestamp(new Date()),
      'weight': 22.719884359974895,
      'version': CREATE_TOKEN_TX_VERSION,
      'inputs': [
        {
          'tx_id': '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e',
          'index': 0,
          'data': Buffer.alloc(70),
        }
      ],
      'outputs': [
        {
          'type': 'p2pkh',
          'address': 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
          'value': 100,
          'tokenData': 1,
        }
      ],
  };
  const createTx = helpers.createTxFromData(createTokenTx, testnet);
  expect(createTx.getType()).toBe('Create Token Transaction');

  // default tx
  const defaultTxData = {
      'tokens': [],
      'timestamp': dateFormatter.dateToTimestamp(new Date()),
      'weight': 22.719884359974895,
      'version': DEFAULT_TX_VERSION,
      'inputs': [
        {
          'tx_id': '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e',
          'index': 0,
          'data': Buffer.alloc(70),
        }
      ],
      'outputs': [
        {
          'address': 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
          'value': 100,
          'tokenData': 0,
        }
      ],
  };
  const p2pkh = new P2PKH(new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'));
  const defaultTx = helpers.createTxFromData(defaultTxData, testnet);
  expect(defaultTx.getType()).toBe('Transaction');
  defaultTx.outputs[0].parseScript(testnet);
  expect(defaultTx.outputs[0].decodedScript.getType()).toBe('p2pkh');
  expect(defaultTx.outputs[0].script.toString('hex')).toBe(p2pkh.createScript().toString('hex'))
  // XXX: we should have a way to test that an output is P2PKH, P2SH or data

  // data and multisig outputs
  const extraTxData = {
      'tokens': [],
      'timestamp': dateFormatter.dateToTimestamp(new Date()),
      'weight': 22.719884359974895,
      'version': DEFAULT_TX_VERSION,
      'inputs': [
        {
          'tx_id': '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e',
          'index': 0,
          'data': Buffer.alloc(70),
        }
      ],
      'outputs': [
        {
          'type': 'data',
          'data': '123',
        },
        {
          'type': 'p2sh',
          'address': 'wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ',
          'value': 100,
          'tokenData': 0,
        }
      ],
  };
  const p2sh = new P2SH(new Address('wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ'));
  const scriptData = new ScriptData('123');
  const extraTx = helpers.createTxFromData(extraTxData, testnet);
  expect(extraTx.getType()).toBe('Transaction');
  extraTx.outputs[0].parseScript(testnet);
  extraTx.outputs[1].parseScript(testnet);
  expect(extraTx.outputs[0].decodedScript.getType()).toBe('data');
  expect(extraTx.outputs[0].script.toString('hex')).toBe(scriptData.createScript().toString('hex'));
  expect(extraTx.outputs[1].decodedScript.getType()).toBe('p2sh');
  expect(extraTx.outputs[1].script.toString('hex')).toBe(p2sh.createScript().toString('hex'));
});
