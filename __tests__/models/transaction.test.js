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
import P2PKH from '../../src/models/p2pkh';
import Address from '../../src/models/address';
import Network from '../../src/models/network';
import { hexToBuffer, bufferToHex } from '../../src/utils/buffer';
import helpers from '../../src/utils/helpers';
import { DEFAULT_TX_VERSION, MAX_OUTPUTS, DEFAULT_SIGNAL_BITS } from '../../src/constants';
import { MaximumNumberInputsError, MaximumNumberOutputsError, ParseError } from '../../src/errors';
import { nftCreationTx } from '../__fixtures__/sample_txs';
import lodash from 'lodash';

const compareTxs = (tx, tx2) => {
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
    expect(bufferToHex(tx2.outputs[i].script)).toBe(bufferToHex(tx.outputs[i].script));
    if (tx2.outputs[i].decodedScript) {
      expect(tx2.outputs[i].decodedScript.address.base58).toBe(tx.outputs[i].decodedScript.address.base58);
      expect(tx2.outputs[i].decodedScript.address.network.name).toBe(tx.outputs[i].decodedScript.address.network.name);
    }
  }

  expect(tx2.parents.length).toBe(tx.parents.length);
  for (let i=0; i<tx.parents.length; i++) {
    expect(tx2.parents[i]).toBe(tx.parents[i]);
  }

  expect(tx2.weight).toBe(tx.weight);
  expect(tx2.nonce).toBe(tx.nonce);
  expect(tx2.timestamp).toBe(tx.timestamp);

  expect(tx.hash).toBe(tx2.hash);
}


test('New tx', () => {

  const network = new Network('testnet');
  const address1 = new Address('WR1i8USJWQuaU423fwuFQbezfevmT4vFWX');
  const p2pkh1 = new P2PKH(address1);
  const p2pkhScript1 = p2pkh1.createScript();
  const address2 = new Address('WgSpcCwYAbtt31S2cqU7hHJkUHdac2EPWG');
  const p2pkh2 = new P2PKH(address2, {timelock: 1550249803});
  const p2pkhScript2 = p2pkh2.createScript();
  const output1 = new Output(1000, p2pkhScript1);
  output1.parseScript(network);
  const output2 = new Output(1000, p2pkhScript2);
  output2.parseScript(network);
  const inputDataHex = '4630440220317cd233801c1986c2de900bf8d344c6335d3c385e69d19d65e1fae7a0afd0af02207acddb824debf855798d79c45701cbe3a19aea00baad94bff5290c6f0b0acf8e210346cddff43dffab8e13398633ab7a7caf0d634551e89ae6fd563e282f6744b983';
  const input1 = new Input('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 0, {data: hexToBuffer(inputDataHex)})
  const tokenUid = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d';
  const tx = new Transaction([input1], [output1, output2], {tokens: [tokenUid]});
  const expectedDataToSignHex = '000101010200034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e000000000003e800001976a91419a8eb751eab5a13027e8cae215f6a5dafc1a8dd88ac000003e800001f045c66ef4b6f76a914c2f29cfdb73822200a07ab51d261b425af811fed88ac';
  const dataToSign = tx.getDataToSign();
  expect(dataToSign.toString('hex')).toBe(expectedDataToSignHex);

  const expectedDataToSignHashHex = '7f64ee571280f1168173a8c27248bc3da51c6a20c27f2c8350476bfa72551adf';
  const dataToSignHash = tx.getDataToSignHash();
  expect(dataToSignHash.toString('hex')).toBe(expectedDataToSignHashHex);


  // Fixing timestamp to compare the serialization
  tx.timestamp = 1550249810;
  tx.weight = tx.calculateWeight();
  const expectedTxHex = '000101010200034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e0000694630440220317cd233801c1986c2de900bf8d344c6335d3c385e69d19d65e1fae7a0afd0af02207acddb824debf855798d79c45701cbe3a19aea00baad94bff5290c6f0b0acf8e210346cddff43dffab8e13398633ab7a7caf0d634551e89ae6fd563e282f6744b983000003e800001976a91419a8eb751eab5a13027e8cae215f6a5dafc1a8dd88ac000003e800001f045c66ef4b6f76a914c2f29cfdb73822200a07ab51d261b425af811fed88ac403209eb93c8c29e5c66ef520000000000';
  expect(tx.toHex()).toBe(expectedTxHex);

  expect(tx.nonce).toBe(0);
  expect(tx.version).toBe(DEFAULT_TX_VERSION);
  expect(tx.signalBits).toBe(DEFAULT_SIGNAL_BITS);
  expect(tx.weight).toBe(18.0387508740556);

  expect(tx.getOutputsSum()).toBe(2000);

  tx.hash = '4a46671dd6e638023335c6a2d35b8cc65a84db43566066dbaa1f329df3e56f0c';
  expect(tx.getShortHash()).toBe('4a46671dd6e6...329df3e56f0c');

  const tx2 = helpers.createTxFromHex(tx.toHex(), network);

  expect(tx.tokens.length).toBe(1);
  expect(tx2.tokens.length).toBe(1);

  compareTxs(tx, tx2);

  // Test invalid hex

  // Invalid version
  expect(() => {
    helpers.createTxFromHex(tx.toHex().slice(20), network);
  }).toThrowError(ParseError);

  // Invalid end part
  expect(() => {
    helpers.createTxFromHex(tx.toHex().slice(0, -20), network);
  }).toThrowError(ParseError);
})

test('Token tx', () => {
  const network = new Network('testnet');
  const tx = new CreateTokenTransaction('Test', 'TST', [], []);
  const info = [];
  tx.serializeTokenInfo(info);
  expect(info.length).toBe(5);
  expect(info[2].toString('hex')).toBe('54657374');
  expect(info[4].toString('hex')).toBe('545354');

  const address1 = new Address('WR1i8USJWQuaU423fwuFQbezfevmT4vFWX');
  const p2pkh1 = new P2PKH(address1);
  const p2pkhScript1 = p2pkh1.createScript();
  const output1 = new Output(1000, p2pkhScript1);
  output1.parseScript(network);
  const inputDataHex = '4630440220317cd233801c1986c2de900bf8d344c6335d3c385e69d19d65e1fae7a0afd0af02207acddb824debf855798d79c45701cbe3a19aea00baad94bff5290c6f0b0acf8e210346cddff43dffab8e13398633ab7a7caf0d634551e89ae6fd563e282f6744b983';
  const input1 = new Input('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 0, {data: hexToBuffer(inputDataHex)})
  tx.inputs = [input1];
  tx.outputs = [output1];
  tx.timestamp = 1550249810;
  tx.weight = tx.calculateWeight();
  tx.nonce = 12345;
  tx.parents = ['00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295c'];
  tx.hash = '723ca83484495bcbb4cf849a835800a28cfac5440a8f517fffb095c52c461858';

  const tx2 = helpers.createTxFromHex(tx.toHex(), network);
  compareTxs(tx, tx2);

  expect(tx2.name).toBe('Test');
  expect(tx2.symbol).toBe('TST');
  expect(tx2.name).toBe(tx.name);
  expect(tx2.symbol).toBe(tx.symbol);

});

test('Tx validation', () => {
  const tx = new Transaction([], []);
  tx.validate();

  const address1 = new Address('WR1i8USJWQuaU423fwuFQbezfevmT4vFWX');
  const p2pkh1 = new P2PKH(address1);
  const p2pkhScript1 = p2pkh1.createScript();
  const output1 = new Output(1000, p2pkhScript1);
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
  const address1 = new Address('1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q')
  const p2pkh1 = new P2PKH(address1);
  const p2pkhScript1 = p2pkh1.createScript();
  const outputs1 = [
    new Output(100, p2pkhScript1),
    new Output(300, p2pkhScript1)
  ];
  const tx1 = new Transaction([], outputs1, {version: 1, hash: '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e'});

  const outputs2 = [
    new Output(100, p2pkhScript1),
    new Output(300, p2pkhScript1)
  ];
  const inputs2 = [
    new Input('00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 0)
  ];
  const tx2 = new Transaction(inputs2, outputs2, {version: 1, hash: '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d'});

  const outputs3 = [
    new Output(2000, p2pkhScript1)
  ];
  const tx3 = new Transaction([], outputs3, {version: 0, hash: '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b'});

  expect(tx1.getType().toLowerCase()).toBe('transaction');
  expect(tx2.getType().toLowerCase()).toBe('transaction');
  expect(tx3.getType().toLowerCase()).toBe('block');

  expect(tx1.isBlock()).toBe(false);
  expect(tx2.isBlock()).toBe(false);
  expect(tx3.isBlock()).toBe(true);
});

test('Known transactions hash', () => {
  // Token creation tx from explorer
  // https://explorer.testnet.hathor.network/transaction/00b584c970b3597d59f3d3b8bf52c4928c6ce25604fe3488467d3f2c0f4dd6e2
  const rawTx = '00010001020082c7dd1f0ceb8867219dcca68540abe77222d11bb2dc67a7af1f04640ea1f701006a473045022100e41968f863dc3372c96a944641f2361ed86849249822b5988804adba1683b3ec02201877dd97d0c85d3754f3378828a4484de407ed2985fcf87782d90cce8f72ec9c2103168e0d873a5bbd75c90c24a68071ea05b9c10996d0cadb543ca650aa76607a260000006400001976a9143f207b6b6fdc624f6c4aff52daf5b80f7f15caf988ac0000001700001976a9143f207b6b6fdc624f6c4aff52daf5b80f7f15caf988ac40200000218def4160dcc22702006f1ebedd590bb5db5c71adbdeaa9b15f7f75c6257c26b11781dc1a5b20f83300b96fdd7a445e063326bbba979919be3b76add5b9cac9ff3330aa2bb804fb0e000000f4';

  const network = new Network('testnet');
  const tx = helpers.createTxFromHex(rawTx, network);

  expect(tx.version).toBe(1);
  expect(tx.signalBits).toBe(DEFAULT_SIGNAL_BITS);
  expect(tx.tokens.length).toBe(0);
  expect(tx.inputs.length).toBe(1);
  expect(tx.outputs.length).toBe(2);
  expect(tx.inputs[0].hash).toBe('0082c7dd1f0ceb8867219dcca68540abe77222d11bb2dc67a7af1f04640ea1f7');
  expect(tx.inputs[0].index).toBe(1);
  expect(tx.outputs[0].value).toBe(100);
  expect(tx.outputs[0].decodedScript.timelock).toBeNull();
  expect(tx.outputs[0].tokenData).toBe(0);
  expect(tx.outputs[0].decodedScript.address.base58).toBe('WURpMuhenPHPC7yLWk2LX9Hsuwr5r5JvdR');
  expect(tx.outputs[1].value).toBe(23);
  expect(tx.outputs[1].decodedScript.timelock).toBeNull();
  expect(tx.outputs[1].tokenData).toBe(0);
  expect(tx.outputs[1].decodedScript.address.base58).toBe('WURpMuhenPHPC7yLWk2LX9Hsuwr5r5JvdR');
  expect(tx.weight).toBe(8.000001);
  expect(tx.timestamp).toBe(1625080359);
  expect(tx.parents.length).toBe(2);
  expect(tx.parents[0]).toBe('006f1ebedd590bb5db5c71adbdeaa9b15f7f75c6257c26b11781dc1a5b20f833');
  expect(tx.parents[1]).toBe('00b96fdd7a445e063326bbba979919be3b76add5b9cac9ff3330aa2bb804fb0e');
  expect(tx.nonce).toBe(244);
  expect(tx.hash).toBe('00b584c970b3597d59f3d3b8bf52c4928c6ce25604fe3488467d3f2c0f4dd6e2');

  // Token creation tx from explorer
  // https://explorer.testnet.hathor.network/transaction/0095835ce7b784301dbfaec88e4faf16872a0ad72f596f8a61c2d8c9caaf4ce5
  const rawTxCreation = '000201040026c04e94574161e0d01e883507fe7615982a70fe07fd484371878738f4fc310100694630440220598f51e6ba1d3ae47c0702f6ed5c27b2fa9bd102d24ad0e4b7079ca17e00b33802201aaba60b46d96dcbea2420885e06fbdbee77d0e8b227f349c53c27f4cca7ca9021021fbb66741977bd12987d6bfe1599fcdebd5620a4e3884b98cab4fa2f8f656bbe000003e000001976a914f057aac531d3b197c62ab187f60ce16ad3474caf88ac0000032001001976a9146b6f1af9950364c48a26bc471a8c24e99e9e0bd788ac0000000181001976a91428424d584c561afb351df28af7b3294eb976272c88ac0000000281001976a9149aec9c0e2fb850887964d2d8c1efb2c88965ba8388ac0108576174436f696e39045741543940200000218def41606278e5020026c04e94574161e0d01e883507fe7615982a70fe07fd484371878738f4fc3100edf5d5b03011d1d4d26b2612296227de2c84033950eb0ed0cbe0201efcd6f900000050'

  const tx2 = helpers.createTxFromHex(rawTxCreation, network);
  expect(tx2.version).toBe(2);
  expect(tx2.signalBits).toBe(DEFAULT_SIGNAL_BITS);
  expect(tx2.name).toBe('WatCoin9');
  expect(tx2.symbol).toBe('WAT9');
  expect(tx2.tokens.length).toBe(0);
  expect(tx2.inputs.length).toBe(1);
  expect(tx2.outputs.length).toBe(4);
  expect(tx2.inputs[0].hash).toBe('0026c04e94574161e0d01e883507fe7615982a70fe07fd484371878738f4fc31');
  expect(tx2.inputs[0].index).toBe(1);
  expect(tx2.outputs[0].value).toBe(992);
  expect(tx2.outputs[0].decodedScript.timelock).toBeNull();
  expect(tx2.outputs[0].tokenData).toBe(0);
  expect(tx2.outputs[0].decodedScript.address.base58).toBe('Wkar5BWCWbi4KsNm2HHgN64wdEPbKQccG5');
  expect(tx2.outputs[1].value).toBe(800);
  expect(tx2.outputs[1].decodedScript.timelock).toBeNull();
  expect(tx2.outputs[1].tokenData).toBe(1);
  expect(tx2.outputs[1].decodedScript.address.base58).toBe('WYU6HBybYwmjA82CEsL8WRmpQXTtPsVegU');
  expect(tx2.outputs[2].value).toBe(1);
  expect(tx2.outputs[2].decodedScript.timelock).toBeNull();
  expect(tx2.outputs[2].tokenData).toBe(129);
  expect(tx2.outputs[2].decodedScript.address.base58).toBe('WSLuLMTfYT59YrS7VnGjkAYEpC4Kj8D29N');
  expect(tx2.outputs[3].value).toBe(2);
  expect(tx2.outputs[3].decodedScript.timelock).toBeNull();
  expect(tx2.outputs[3].tokenData).toBe(129);
  expect(tx2.outputs[3].decodedScript.address.base58).toBe('WcoCPPheVqDeehqnp6o4eCxEdRaYiKCMrw');
  expect(tx2.weight).toBe(8.000001);
  expect(tx2.timestamp).toBe(1617066213);
  expect(tx2.parents.length).toBe(2);
  expect(tx2.parents[0]).toBe('0026c04e94574161e0d01e883507fe7615982a70fe07fd484371878738f4fc31');
  expect(tx2.parents[1]).toBe('00edf5d5b03011d1d4d26b2612296227de2c84033950eb0ed0cbe0201efcd6f9');
  expect(tx2.nonce).toBe(80);
  expect(tx2.hash).toBe('0095835ce7b784301dbfaec88e4faf16872a0ad72f596f8a61c2d8c9caaf4ce5');

  // Tx with 3 tokens (one is HTR) and one output is locked
  // https://explorer.testnet.hathor.network/transaction/0000e39fa77e4146b4487a9b7352a05aa07a0da8e8f793280640cae5a7c6e8e3

  const rawBigTx = '00010203040028660612661c0592bb9b6cb8e77124caefbb0d68a119ea558c4947a68f9eef00efbc2e64ea93768c29823882185b633bf6380a15f7b621c68dc777558f06ae0044185239e750d0d7befd7758b377d8f682194fca1614b4ef6e31acbbca563600006a4730450221008b263d587b2fcd596c4c5ba9ffc488b8faa65f35b4820e150b45285f8831e6e0022061b4ce657190bb507da11a5bfcc8135333e857d87dc28662c246e8c9b1460fba2103e740109dca8142f9c3efcff130fb180deb563d7de2dde2af5c6e8dc3e5934cb00028660612661c0592bb9b6cb8e77124caefbb0d68a119ea558c4947a68f9eef01006946304402200487b46e1c48eb71eee0d780579b2e21acd8a28292081ddfc000eb0e2663de9f022061f0c12847326b9dfd3b85b60adcce799738e2b973b1e41ec67c7cf5ea010c64210360eedfa3b9e2bdb6a19954528f06ca9a970f4c07490c016bdb6a170061dda84500efbc2e64ea93768c29823882185b633bf6380a15f7b621c68dc777558f06ae01006a47304502210083e7ab1e6a82c43a5126dde9530d1e1534fc8d75e7319d66916f8e75f19de318022027c99fd9342a0c4838c928cf2f862c6237ba8c12394b0ff04301675e55c24fa321037e2975f85bb6a9bbedfd9d16850cf5d838c3751b7903aeb128a3a4ea45feed5a0000004d00001976a91427943c5862d743e1989f9191ec1fd3d48e92e70888ac0000007b00001976a91427943c5862d743e1989f9191ec1fd3d48e92e70888ac0000006401001f0461cfb59f6f76a914679e2c0291a8f7a7a05b82c98ca284526c23f68588ac000000c802001976a9149c3218e4f0f2266783a62f7f4233a44d9549c2b388ac40200000218def4160df2a4302004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e5000e585e04ad770cfcc06c0976fe9089b4bf57570c96981e3ecd992ccafd2f2df00000016'

  const tx3 = helpers.createTxFromHex(rawBigTx, network);
  expect(tx3.version).toBe(1);
  expect(tx3.signalBits).toBe(DEFAULT_SIGNAL_BITS);
  expect(tx3.tokens.length).toBe(2);
  expect(tx3.tokens[0]).toBe('0028660612661c0592bb9b6cb8e77124caefbb0d68a119ea558c4947a68f9eef');
  expect(tx3.tokens[1]).toBe('00efbc2e64ea93768c29823882185b633bf6380a15f7b621c68dc777558f06ae');
  expect(tx3.inputs.length).toBe(3);
  expect(tx3.outputs.length).toBe(4);
  expect(tx3.inputs[0].hash).toBe('0044185239e750d0d7befd7758b377d8f682194fca1614b4ef6e31acbbca5636');
  expect(tx3.inputs[0].index).toBe(0);
  expect(tx3.inputs[1].hash).toBe('0028660612661c0592bb9b6cb8e77124caefbb0d68a119ea558c4947a68f9eef');
  expect(tx3.inputs[1].index).toBe(1);
  expect(tx3.inputs[2].hash).toBe('00efbc2e64ea93768c29823882185b633bf6380a15f7b621c68dc777558f06ae');
  expect(tx3.inputs[2].index).toBe(1);
  expect(tx3.outputs[0].value).toBe(77);
  expect(tx3.outputs[0].decodedScript.timelock).toBeNull();
  expect(tx3.outputs[0].tokenData).toBe(0);
  expect(tx3.outputs[0].decodedScript.address.base58).toBe('WSHJp1QFnA8gBntU7Rjn3zSEzxX8hYu5wE');
  expect(tx3.outputs[1].value).toBe(123);
  expect(tx3.outputs[1].decodedScript.timelock).toBeNull();
  expect(tx3.outputs[1].tokenData).toBe(0);
  expect(tx3.outputs[1].decodedScript.address.base58).toBe('WSHJp1QFnA8gBntU7Rjn3zSEzxX8hYu5wE');
  expect(tx3.outputs[2].value).toBe(100);
  expect(tx3.outputs[2].decodedScript.timelock).toBe(1641002399);
  expect(tx3.outputs[2].tokenData).toBe(1);
  expect(tx3.outputs[2].decodedScript.address.base58).toBe('WY7uxfSG4DhMVR3NVoX7rXwNr6FHJ7FWgX');
  expect(tx3.outputs[3].value).toBe(200);
  expect(tx3.outputs[3].decodedScript.timelock).toBeNull();
  expect(tx3.outputs[3].tokenData).toBe(2);
  expect(tx3.outputs[3].decodedScript.address.base58).toBe('WcuvJfrcL3LqCsYnBnZLLcTyvsSM3HnBed');
  expect(tx3.weight).toBe(8.000001);
  expect(tx3.timestamp).toBe(1625238083);
  expect(tx3.parents.length).toBe(2);
  expect(tx3.parents[0]).toBe('004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50');
  expect(tx3.parents[1]).toBe('00e585e04ad770cfcc06c0976fe9089b4bf57570c96981e3ecd992ccafd2f2df');
  expect(tx3.nonce).toBe(22);
  expect(tx3.hash).toBe('0000e39fa77e4146b4487a9b7352a05aa07a0da8e8f793280640cae5a7c6e8e3');

});

describe('NFT Validation', () => {
  const cloneNftSample = () => lodash.cloneDeep(nftCreationTx);
  const network = new Network('testnet');

  it('should validate a NFT creation tx', () => {
    expect.assertions(1);
    const historyTx = cloneNftSample();

    const txInstance = helpers.createTxFromHistoryObject(historyTx);

    expect(() => txInstance.validateNft(network)).not.toThrow();
  })

  it('should throw for a token-creating tx with less than 2 outputs', () => {
    expect.assertions(1);
    const historyTx = cloneNftSample();

    // Removing all outputs from index 1 onwards
    historyTx.outputs.length = 1;
    const txInstance = helpers.createTxFromHistoryObject(historyTx);

    expect(() => txInstance.validateNft(network)).toThrow('minimum');
  });

  it('should validate maximum outputs of a transaction', () => {
    expect.assertions(2);
    const historyTx = cloneNftSample();
    const txInstance = helpers.createTxFromHistoryObject(historyTx);

    // Adding outputs within allowed limit
    for (let i = 1; i < MAX_OUTPUTS; ++i) {
      txInstance.outputs[i] = helpers.createOutputFromHistoryObject(historyTx.outputs[1]);
    }
    expect(() => txInstance.validateNft(network)).not.toThrow();

    // Adding an output beyond the allowed limit
    txInstance.outputs.push(helpers.createOutputFromHistoryObject(historyTx.outputs[1]));
    expect(() => txInstance.validateNft(network)).toThrow('can have at most');
  });

  it('should return false for a fee output with wrong data', () => {
    expect.assertions(3);
    const historyTx = cloneNftSample();
    const txInstance = helpers.createTxFromHistoryObject(historyTx);

    // Wrong Value
    txInstance.outputs[0].value = 2;
    expect(() => txInstance.validateNft(network)).toThrow('valid NFT data');

    // Wrong Token Data
    txInstance.outputs[0].value = 1;
    txInstance.outputs[0].tokenData = 1;
    expect(() => txInstance.validateNft(network)).toThrow('valid NFT data');

    // Wrong Token Script
    txInstance.outputs[0].tokenData = 0;
    txInstance.outputs[0].script = Buffer
      .from(historyTx.outputs[0].script,'base64')
      .toString('hex');
    expect(() => txInstance.validateNft(network)).toThrow('not a DataScript');
  });

  it('should return false for having an invalid output script', () => {
    expect.assertions(2);
    const historyTx = cloneNftSample();
    const txInstance = helpers.createTxFromHistoryObject(historyTx);

    // Script too large
    txInstance.outputs[1].script = Buffer.from('a'.repeat(257));
    expect(() => txInstance.validateNft(network)).toThrow('script is too long');

    // Incorrect output type
    txInstance.outputs[1].script = Buffer.from(historyTx.outputs[0].script, 'base64');
    expect(() => txInstance.validateNft(network)).toThrow('not of a valid type');
  });

  it('should return true for a NFT without change', () => {
    expect.assertions(1);
    const historyTx = cloneNftSample();

    historyTx.outputs = [
      nftCreationTx.outputs[0], // Fee
      nftCreationTx.outputs[2], // Token
      nftCreationTx.outputs[3], // Mint
      nftCreationTx.outputs[4], // Melt
    ];

    const txInstance = helpers.createTxFromHistoryObject(historyTx);
    expect(() => txInstance.validateNft(network)).not.toThrow();
  });

  it('should return true for a NFT without mint and/or melt', () => {
    expect.assertions(3);
    const historyTx = cloneNftSample();
    let txInstance;

    historyTx.outputs = [
      nftCreationTx.outputs[0], // Fee
      nftCreationTx.outputs[2], // Token
      nftCreationTx.outputs[3], // Mint
    ];
    txInstance = helpers.createTxFromHistoryObject(historyTx);
    expect(() => txInstance.validateNft(network)).not.toThrow();

    historyTx.outputs = [
      nftCreationTx.outputs[0], // Fee
      nftCreationTx.outputs[2], // Token
      nftCreationTx.outputs[4], // Melt
    ];
    txInstance = helpers.createTxFromHistoryObject(historyTx);
    expect(() => txInstance.validateNft(network)).not.toThrow();

    historyTx.outputs = [
      nftCreationTx.outputs[0], // Fee
      nftCreationTx.outputs[2], // Token
    ];
    txInstance = helpers.createTxFromHistoryObject(historyTx);
    expect(() => txInstance.validateNft(network)).not.toThrow();
  });

  it('should return false for a NFT with 2+ mint and/or melt outputs', () => {
    expect.assertions(2);
    const historyTx = cloneNftSample();
    let txInstance;

    historyTx.outputs = [
      nftCreationTx.outputs[0], // Fee
      nftCreationTx.outputs[2], // Token
      nftCreationTx.outputs[3], // Mint
      nftCreationTx.outputs[3], // Mint
    ];
    txInstance = helpers.createTxFromHistoryObject(historyTx);
    expect(() => txInstance.validateNft(network)).toThrow('mint and melt is allowed');

    historyTx.outputs = [
      nftCreationTx.outputs[0], // Fee
      nftCreationTx.outputs[2], // Token
      nftCreationTx.outputs[4], // Melt
      nftCreationTx.outputs[4], // Melt
    ];
    txInstance = helpers.createTxFromHistoryObject(historyTx);
    expect(() => txInstance.validateNft(network)).toThrow('mint and melt is allowed');
  });
})
