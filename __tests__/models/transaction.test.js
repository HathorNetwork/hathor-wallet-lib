/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Transaction from '../../src/models/transaction';
import CreateTokenTransaction from '../../src/models/create_token_transaction';
import Output from '../../src/models/output';
import Input from '../../src/models/input';
import Address from '../../src/models/address';
import Network from '../../src/models/network';
import { hexToBuffer } from '../../src/utils/buffer';
import helpers from '../../src/utils/helpers';
import { DEFAULT_TX_VERSION } from '../../src/constants';
import { MaximumNumberInputsError, MaximumNumberOutputsError } from '../../src/errors';

const validateTxs = (tx, tx2) => {
  expect(tx2.version).toBe(tx.version);
  expect(tx2.tokens.length).toBe(tx.tokens.length);
  expect(tx2.inputs.length).toBe(tx.inputs.length);
  expect(tx2.outputs.length).toBe(tx.outputs.length);

  for (let i=0; i<tx.tokens.length; i++) {
    expect(tx2.tokens[i]).toBe(tx.tokens[i]);
  }

  for (let i=0; i<tx.inputs.length; i++) {
    expect(tx2.inputs[i].hash).toBe(tx.inputs[i].hash);
    expect(tx2.inputs[i].index).toBe(tx.inputs[i].index);
    expect(tx2.inputs[i].data).toEqual(tx.inputs[i].data);
  }

  for (let i=0; i<tx.outputs.length; i++) {
    expect(tx2.outputs[i].value).toBe(tx.outputs[i].value);
    expect(tx2.outputs[i].tokenData).toBe(tx.outputs[i].tokenData);
    expect(tx2.outputs[i].timelock).toBe(tx.outputs[i].timelock);
    expect(tx2.outputs[i].address.base58).toBe(tx.outputs[i].address.base58);
    expect(tx2.outputs[i].address.network.name).toBe(tx.outputs[i].address.network.name);
  }

  expect(tx2.parents.length).toBe(tx.parents.length);
  for (let i=0; i<tx.parents.length; i++) {
    expect(tx2.parents[i]).toBe(tx.parents[i]);
  }

  expect(tx2.weight).toBe(tx.weight);
  expect(tx2.nonce).toBe(tx.nonce);
  expect(tx2.timestamp).toBe(tx.timestamp);
}


test('New tx', () => {
  
  const address1 = new Address('WR1i8USJWQuaU423fwuFQbezfevmT4vFWX');
  const address2 = new Address('WgSpcCwYAbtt31S2cqU7hHJkUHdac2EPWG');
  const output1 = new Output(1000, address1);
  const output2 = new Output(1000, address2, {timelock: 1550249803});
  const inputDataHex = '4630440220317cd233801c1986c2de900bf8d344c6335d3c385e69d19d65e1fae7a0afd0af02207acddb824debf855798d79c45701cbe3a19aea00baad94bff5290c6f0b0acf8e210346cddff43dffab8e13398633ab7a7caf0d634551e89ae6fd563e282f6744b983';
  const input1 = new Input('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 0, {data: hexToBuffer(inputDataHex)})
  const tokenUid = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d';
  const tx = new Transaction([input1], [output1, output2], {tokens: [tokenUid]});
  const expectedDataToSignHex = '000101010200034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e000000000003e800001976a91419a8eb751eab5a13027e8cae215f6a5dafc1a8dd88ac000003e800001f045c66ef4b6f76a914c2f29cfdb73822200a07ab51d261b425af811fed88ac';
  const dataToSign = tx.getDataToSign();
  expect(dataToSign.toString('hex')).toBe(expectedDataToSignHex);


  // Fixing timestamp to compare the serialization
  tx.timestamp = 1550249810;
  tx.weight = tx.calculateWeight();
  const expectedTxHex = '000101010200034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e0000694630440220317cd233801c1986c2de900bf8d344c6335d3c385e69d19d65e1fae7a0afd0af02207acddb824debf855798d79c45701cbe3a19aea00baad94bff5290c6f0b0acf8e210346cddff43dffab8e13398633ab7a7caf0d634551e89ae6fd563e282f6744b983000003e800001976a91419a8eb751eab5a13027e8cae215f6a5dafc1a8dd88ac000003e800001f045c66ef4b6f76a914c2f29cfdb73822200a07ab51d261b425af811fed88ac403209eb93c8c29e5c66ef520000000000';
  expect(tx.toHex()).toBe(expectedTxHex);

  expect(tx.nonce).toBe(0);
  expect(tx.version).toBe(DEFAULT_TX_VERSION);
  expect(tx.weight).toBe(18.0387508740556);

  expect(tx.getOutputsSum()).toBe(2000);

  tx.hash = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
  expect(tx.getShortHash()).toBe('00034a159731...3cd6686b295e');

  const network = new Network('testnet');
  const tx2 = helpers.createTxFromHex(tx.toHex(), network);

  validateTxs(tx, tx2);
})

test('Token tx', () => {
  const tx = new CreateTokenTransaction('Test', 'TST', [], []);
  const info = tx.serializeTokenInfo();
  expect(info.length).toBe(5);
  expect(info[2].toString('hex')).toBe('54657374');
  expect(info[4].toString('hex')).toBe('545354');

  const address1 = new Address('WR1i8USJWQuaU423fwuFQbezfevmT4vFWX');
  const output1 = new Output(1000, address1);
  const inputDataHex = '4630440220317cd233801c1986c2de900bf8d344c6335d3c385e69d19d65e1fae7a0afd0af02207acddb824debf855798d79c45701cbe3a19aea00baad94bff5290c6f0b0acf8e210346cddff43dffab8e13398633ab7a7caf0d634551e89ae6fd563e282f6744b983';
  const input1 = new Input('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 0, {data: hexToBuffer(inputDataHex)})
  tx.inputs = [input1];
  tx.outputs = [output1];
  tx.timestamp = 1550249810;
  tx.weight = tx.calculateWeight();
  tx.nonce = 12345;
  tx.parents = ['00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295c'];

  const network = new Network('testnet');
  const tx2 = helpers.createTxFromHex(tx.toHex(), network);
  validateTxs(tx, tx2);

  expect(tx2.name).toBe('Test');
  expect(tx2.symbol).toBe('TST');
  expect(tx2.name).toBe(tx.name);
  expect(tx2.symbol).toBe(tx.symbol);

});

test('Tx validation', () => {
  const tx = new Transaction([], []);
  tx.validate();

  const address1 = new Address('WR1i8USJWQuaU423fwuFQbezfevmT4vFWX');
  const output1 = new Output(1000, address1);
  const outputs = [];
  for (let i=0; i<255; i++) {
    outputs.push(output1);
  }

  // 255 outputs
  tx.outputs = outputs;
  tx.validate();

  // 256 outputs
  tx.outputs.push(output1);

  expect(() => {
    tx.validate();
  }).toThrowError(MaximumNumberOutputsError);

  tx.outputs = [];

  const inputs = [];
  const input1 = new Input('abc', 0);
  for (let i=0; i<255; i++) {
    inputs.push(input1);
  }

  tx.inputs = inputs;
  tx.validate();

  // 256 inputs
  tx.inputs.push(input1);

  expect(() => {
    tx.validate();
  }).toThrowError(MaximumNumberInputsError);
});

test('Transaction type', () => {
  const outputs1 = [
    new Output(100, new Address('1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q')),
    new Output(300, new Address('1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q'))
  ];
  const tx1 = new Transaction([], outputs1, {version: 1, hash: '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e'});

  const outputs2 = [
    new Output(100, new Address('1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q')),
    new Output(300, new Address('1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q'))
  ];
  const inputs2 = [
    new Input('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 0)
  ];
  const tx2 = new Transaction(inputs2, outputs2, {version: 1, hash: '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d'});

  const outputs3 = [
    new Output(2000, new Address('1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q'))
  ];
  const tx3 = new Transaction([], outputs3, {version: 0, hash: '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b'});

  expect(tx1.getType().toLowerCase()).toBe('transaction');
  expect(tx2.getType().toLowerCase()).toBe('transaction');
  expect(tx3.getType().toLowerCase()).toBe('block');

  expect(tx1.isBlock()).toBe(false);
  expect(tx2.isBlock()).toBe(false);
  expect(tx3.isBlock()).toBe(true);
});
