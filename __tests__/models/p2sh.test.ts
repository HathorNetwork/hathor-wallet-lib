/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import P2SH from '../../src/models/p2sh';
import Address from '../../src/models/address';
import Network from '../../src/models/network';

test('createScript', () => {
  const testnet = new Network('testnet');
  const mainnet = new Network('mainnet');

  // Testnet p2sh
  const addr1 = new Address('wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ', { network: testnet });
  // Mainnet p2sh
  const addr2 = new Address('hXRpjKbgVVGF1ioYtscCRavnzvGbsditXn', { network: mainnet });

  const script = 'a914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';
  const scriptTimelocked = '042e3db6b06fa914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';

  // TESTNET
  const st1 = new P2SH(addr1);
  const st2 = new P2SH(addr1, { timelock: 775796400 });
  expect(st1.createScript().toString('hex')).toBe(script);
  expect(st2.createScript().toString('hex')).toBe(scriptTimelocked);

  // MAINNET
  const sm1 = new P2SH(addr2);
  const sm2 = new P2SH(addr2, { timelock: 775796400 });
  expect(sm1.createScript().toString('hex')).toBe(script);
  expect(sm2.createScript().toString('hex')).toBe(scriptTimelocked);
});

test('identify p2sh', () => {
  const script = 'a914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';
  const scriptTimelocked = '042e3db6b06fa914b6696aed0a1ef8fe7d604f5436ec6617e6ad92d387';

  const p2pkhScript = '76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';
  const p2pkhScriptTimelocked = '042e3db6b06f76a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac';

  expect(P2SH.identify(Buffer.from(script, 'hex'))).toBe(true);
  expect(P2SH.identify(Buffer.from(scriptTimelocked, 'hex'))).toBe(true);
  expect(P2SH.identify(Buffer.from(p2pkhScript, 'hex'))).toBe(false);
  expect(P2SH.identify(Buffer.from(p2pkhScriptTimelocked, 'hex'))).toBe(false);
});
