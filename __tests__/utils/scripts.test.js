/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {createP2SHRedeemScript, parseP2PKH, parseP2SH, parseScriptData} from '../../src/utils/scripts';
import Network from '../../src/models/network';

test('parseP2PKH', () => {
  const testnet = new Network('testnet');
  const mainnet = new Network('mainnet');
  const timestamp = 775796400;

  // Testnet p2pkh
  const addr1 = 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo';
  const scriptTestnet = '76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';
  const scriptTestnetTimelocked = '042e3db6b06f76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';

  const p2pkhTestnet = parseP2PKH(Buffer.from(scriptTestnet, 'hex'), testnet);
  expect(p2pkhTestnet.address.base58).toBe(addr1);
  expect(p2pkhTestnet.timelock).toBe(null);

  const p2pkhTestnetTimelocked = parseP2PKH(Buffer.from(scriptTestnetTimelocked, 'hex'), testnet);
  expect(p2pkhTestnetTimelocked.address.base58).toBe(addr1);
  expect(p2pkhTestnetTimelocked.timelock).toBe(timestamp);

  // Mainnet p2pkh
  const addr2 = 'HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb';
  const scriptMainnet = '76a914abca4eadc059d324ce46995c41065d71860ad7b088ac';
  const scriptMainnetTimelocked = '042e3db6b06f76a914abca4eadc059d324ce46995c41065d71860ad7b088ac';

  const p2pkhMainnet = parseP2PKH(Buffer.from(scriptMainnet, 'hex'), mainnet);
  expect(p2pkhMainnet.address.base58).toBe(addr2);
  expect(p2pkhMainnet.timelock).toBe(null);

  const p2pkhMainnetTimelocked = parseP2PKH(Buffer.from(scriptMainnetTimelocked, 'hex'), mainnet);
  expect(p2pkhMainnetTimelocked.address.base58).toBe(addr2);
  expect(p2pkhMainnetTimelocked.timelock).toBe(timestamp);
});

test('parseP2SH', () => {
  const testnet = new Network('testnet');
  const mainnet = new Network('mainnet');

  const script = 'a914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';
  const scriptTimelocked = '042e3db6b06fa914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';
  const timestamp = 775796400;

  // Testnet p2sh
  const addr1 = 'wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ';

  const p2shTestnet = parseP2SH(Buffer.from(script, 'hex'), testnet);
  expect(p2shTestnet.address.base58).toBe(addr1);
  expect(p2shTestnet.timelock).toBe(null);

  const p2shTestnetTimelocked = parseP2SH(Buffer.from(scriptTimelocked, 'hex'), testnet);
  expect(p2shTestnetTimelocked.address.base58).toBe(addr1);
  expect(p2shTestnetTimelocked.timelock).toBe(timestamp);

  // Mainnet p2sh
  const addr2 = 'hXRpjKbgVVGF1ioYtscCRavnzvGbsditXn';

  const p2shMainnetTimelocked = parseP2SH(Buffer.from(scriptTimelocked, 'hex'), mainnet);
  expect(p2shMainnetTimelocked.address.base58).toBe(addr2);
  expect(p2shMainnetTimelocked.timelock).toBe(timestamp);
});

test('parseScriptData', () => {
  const data = 'hathor://test';
  const script = '0d686174686f723a2f2f74657374ac';
  expect(parseScriptData(Buffer.from(script, 'hex')).data).toBe(data);
});

test('createP2SHRedeemScript', () => {
  const multisig =  {
    data: {
      numSignatures: 3,
      pubkeys: [
        'xpub6CvvCBtHqFfErbcW2Rv28TmZ3MqcFuWQVKGg8xDzLeAwEAHRz9LBTgSFSj7B99scSvZGbq6TxAyyATA9b6cnwsgduNs9NGKQJnEQr3PYtwK',
        'xpub6CA16g2qPwukWAWBMdJKU3p2fQEEi831W3WAs2nesuCzPhbrG29aJsoRDSEDT4Ac3smqSk51uuv6oujU3MAAL3d1Nm87q9GDwE3HRGQLjdP',
        'xpub6BwNT613Vzy7ARVHDEpoX23SMBEZQMJXdqTWYjQKvJZJVDBjEemU38exJEhc6qbFVc4MmarN68gUKHkyZ3NEgXXCbWtoXXGouHpwMEcXJLf',
        'xpub6DCyPHg4AwXsdiMh7QSTHR7afmNVwZKHBBMFUiy5aCYQNaWp68ceQXYXCGQr5fZyLAe5hiJDdXrq6w3AXzvVmjFX9F7EdM87repxJEhsmjL',
        'xpub6CgPUcCCJ9pAK7Rj52hwkxTutSRv91Fq74Hx1SjN62eg6Mp3S3YCJFPChPaDjpp9jCbCZHibBgdKnfNdq6hE9umyjyZKUCySBNF7wkoG4uK',
      ],
    },
  };
  const scriptHex = '532102a847d31a64c190d2ec082c46eb23aff9c591c59f3be86e90404d45aa42841ac22103ee726ee90b034eb4dcfc4ee9cd7d0b743f41eb93de0c21d750e6110e46cf5986210339f5fa440e0f2754226e04ca5b1c3510416fc54739ba3101d03b3b99d8366e4121025e7c288c0e988f02c8c2b64bd4656743e279fa50c0b287c0985b3635fd85b8b9210383689a51fc5285188b19194ef2e3cf1ee752854f73ca186c9b1b99e0698805ef55ae';
  expect(createP2SHRedeemScript(multisig.data.pubkeys, multisig.data.numSignatures, 0)).toMatchBuffer(Buffer.from(scriptHex, 'hex'));
});