/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import helpers from '../../src/utils/helpers';
import Network from '../../src/models/network';
import dateFormatter from '../../src/utils/date';
import Address from '../../src/models/address';
import P2PKH from '../../src/models/p2pkh';
import P2SH from '../../src/models/p2sh';
import ScriptData from '../../src/models/script_data';
import buffer from 'buffer';
import { OP_PUSHDATA1 } from '../../src/opcodes';
import { DEFAULT_TX_VERSION, CREATE_TOKEN_TX_VERSION } from '../../src/constants';
import Transaction from '../../src/models/transaction';
import CreateTokenTransaction from '../../src/models/create_token_transaction';
import config from '../../src/config';
import { AddressError, OutputValueError, ConstantNotSet, CreateTokenTxInvalid, MaximumNumberInputsError, MaximumNumberOutputsError } from '../../src/errors';

test('Round float', () => {
  expect(helpers.roundFloat(1.23)).toBe(1.23);
  expect(helpers.roundFloat(1.2345)).toBe(1.23);
  expect(helpers.roundFloat(1.2355)).toBe(1.24);
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

test('Encode Address P2PKH', () => {
  const addressHashHex = 'b2613dcec864801e7ca62043ec44d45747bf3609';
  const address = 'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN';
  const addressHash = Buffer.from(addressHashHex, 'hex');
  const testnet = new Network('testnet');
  expect(helpers.encodeAddress(addressHash, testnet).base58).toEqual(address);
});

test('Encode Address P2SH', () => {
  const scriptHashHex = 'ea254266cc498136f864983b99e09c5c321e7f8a';
  const address = 'wgyUgNjqZ18uYr4YfE2ALW6tP5hd8MumH5';
  const scriptHash = Buffer.from(scriptHashHex, 'hex');
  const testnet = new Network('testnet');
  expect(helpers.encodeAddressP2SH(scriptHash, testnet).base58).toEqual(address);
});

test('createTxFromBytes and Hex', () => {
  const defaulttxbytes = Buffer.from('0001cafe', 'hex');
  const createTokentxbytes = Buffer.from('0002cafe', 'hex');
  const errorTxBytes = Buffer.from('0000cafe', 'hex'); // Block
  const testnet = new Network('testnet');
  const spyTx = jest.spyOn(Transaction, 'createFromBytes').mockReturnValue('default-transaction');
  const spyCreateTokenTx = jest.spyOn(CreateTokenTransaction, 'createFromBytes').mockReturnValue('create-token-transaction');

  // Testing fromBytes
  expect(helpers.createTxFromBytes(defaulttxbytes, testnet)).toEqual('default-transaction');
  expect(helpers.createTxFromBytes(createTokentxbytes, testnet)).toEqual('create-token-transaction');
  expect(() => {helpers.createTxFromBytes(errorTxBytes, testnet)}).toThrow();

  // Testing fromHex
  expect(helpers.createTxFromHex(defaulttxbytes.toString('hex'), testnet)).toEqual('default-transaction');
  expect(helpers.createTxFromHex(createTokentxbytes.toString('hex'), testnet)).toEqual('create-token-transaction');
  expect(() => {helpers.createTxFromHex(errorTxBytes.toString('hex'), testnet)}).toThrow();

  spyTx.mockRestore();
  spyCreateTokenTx.mockRestore();
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

test('getOutputTypeFromAddress', () => {
  const mainnetNetwork = new Network('mainnet')
  const testnetNetwork = new Network('testnet')

  // Testnet p2pkh
  const addr1 = 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo';
  expect(helpers.getOutputTypeFromAddress(addr1, testnetNetwork)).toBe('p2pkh');

  // Testnet p2sh
  const addr2 = 'wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ';
  expect(helpers.getOutputTypeFromAddress(addr2, testnetNetwork)).toBe('p2sh');

  // Mainnet p2pkh
  const addr3 = 'HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb';
  expect(helpers.getOutputTypeFromAddress(addr3, mainnetNetwork)).toBe('p2pkh');

  // Mainnet p2sh
  const addr4 = 'hXRpjKbgVVGF1ioYtscCRavnzvGbsditXn';
  expect(helpers.getOutputTypeFromAddress(addr4, mainnetNetwork)).toBe('p2sh');
});

test('getWSServerURL', () => {
  config.SERVER_URL = undefined;
  const serverHTTP = 'http://fullnode.com/api/path/';
  const serverHTTPS = 'https://fullnode.com/api/path/';
  const serverWS = 'ws://fullnode.com/api/path/ws/';
  const serverWSS = 'wss://fullnode.com/api/path/ws/';
  expect(helpers.getWSServerURL(serverHTTP)).toEqual(serverWS);
  expect(helpers.getWSServerURL(serverHTTPS)).toEqual(serverWSS);
  // When no argument is given, use config server
  config.SERVER_URL = serverHTTPS;
  expect(helpers.getWSServerURL()).toEqual(serverWSS);
});

test('handlePrepareDataError', () => {
  const err1 = new AddressError('err1');
  const err2 = new OutputValueError('err2');
  const err3 = new ConstantNotSet('err3');
  const err4 = new CreateTokenTxInvalid('err4');
  const err5 = new MaximumNumberInputsError('err5');
  const err6 = new MaximumNumberOutputsError('err6');
  const err = new Error('err');
  expect(helpers.handlePrepareDataError(err1)).toEqual('err1');
  expect(helpers.handlePrepareDataError(err2)).toEqual('err2');
  expect(helpers.handlePrepareDataError(err3)).toEqual('err3');
  expect(helpers.handlePrepareDataError(err4)).toEqual('err4');
  expect(helpers.handlePrepareDataError(err5)).toEqual('err5');
  expect(helpers.handlePrepareDataError(err6)).toEqual('err6');

  expect(() => { helpers.handlePrepareDataError(err) }).toThrow(err);
});

test('cleanupString', () => {
  expect(helpers.cleanupString('str 1')).toEqual('str 1');
  expect(helpers.cleanupString('str  2')).toEqual('str 2');
  expect(helpers.cleanupString('str\t 3')).toEqual('str 3');
  expect(helpers.cleanupString('  Str\t 4   \t')).toEqual(' str 4 ');
  expect(helpers.cleanupString('STR 5')).toEqual('str 5');
});
