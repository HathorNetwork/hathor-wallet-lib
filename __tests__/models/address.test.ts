/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Address from '../../src/models/address';
import Network from '../../src/models/network';
import P2PKH from '../../src/models/p2pkh';
import P2SH from '../../src/models/p2sh';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';

test('Validate address', () => {
  // Invalid address
  const addr1 = new Address('abc');
  expect(addr1.isValid()).toBe(false);

  // Mainnet address
  const addr2 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb');
  // It will be invalid because the default network is testnet
  expect(addr2.isValid()).toBe(false);

  // Testnet address
  const addr3 = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  expect(addr3.isValid()).toBe(true);

  // Mainnet address with mainnet network
  const mainnetNetwork = new Network('mainnet');
  const addr4 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb', { network: mainnetNetwork });
  expect(addr4.isValid()).toBe(true);

  // Invalid checksum
  const addr5 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSc', { network: mainnetNetwork });
  expect(addr5.isValid()).toBe(false);
});

test('Address getType', () => {
  // Testnet p2pkh
  const addr1 = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  expect(addr1.getType()).toBe('p2pkh');

  // Testnet p2sh
  const addr2 = new Address('wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ');
  expect(addr2.getType()).toBe('p2sh');

  const mainnetNetwork = new Network('mainnet');

  // Mainnet p2pkh
  const addr3 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb', { network: mainnetNetwork });
  expect(addr3.getType()).toBe('p2pkh');

  // Mainnet p2sh
  const addr4 = new Address('hXRpjKbgVVGF1ioYtscCRavnzvGbsditXn', { network: mainnetNetwork });
  expect(addr4.getType()).toBe('p2sh');
});

test('Shielded address validation and type detection', () => {
  const testnetNetwork = new Network('testnet');
  // Create a valid shielded address with known pubkeys
  const scanPubkey = Buffer.alloc(33, 0x02); // Fake compressed pubkey
  scanPubkey[0] = 0x02; // Valid compressed prefix
  const spendPubkey = Buffer.alloc(33, 0x03);
  spendPubkey[0] = 0x03; // Valid compressed prefix

  const shieldedAddr = encodeShieldedAddress(scanPubkey, spendPubkey, testnetNetwork);
  const addr = new Address(shieldedAddr, { network: testnetNetwork });

  // Should be valid
  expect(addr.isValid()).toBe(true);
  // Should be recognized as shielded
  expect(addr.getType()).toBe('shielded');
  expect(addr.isShielded()).toBe(true);
});

test('Shielded address getScanPubkey and getSpendPubkey', () => {
  const testnetNetwork = new Network('testnet');
  const scanPubkey = Buffer.alloc(33, 0xaa);
  const spendPubkey = Buffer.alloc(33, 0xbb);

  const shieldedAddr = encodeShieldedAddress(scanPubkey, spendPubkey, testnetNetwork);
  const addr = new Address(shieldedAddr, { network: testnetNetwork });

  expect(addr.getScanPubkey()).toEqual(scanPubkey);
  expect(addr.getSpendPubkey()).toEqual(spendPubkey);
});

test('Non-shielded address getScanPubkey throws', () => {
  const addr = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  expect(() => addr.getScanPubkey()).toThrow('Not a shielded address');
  expect(() => addr.getSpendPubkey()).toThrow('Not a shielded address');
  expect(addr.isShielded()).toBe(false);
});

test('Address script', () => {
  const addr = new Address('wcFwC82mLoUudtgakZGMPyTL2aHcgSJgDZ');
  const p2sh = new P2SH(addr);
  expect(addr.getScript()).toStrictEqual(p2sh.createScript());

  const mainnetNetwork = new Network('mainnet');
  const addr2 = new Address('HNBUHhzkVuSFUNW21HrajUFNUiX8JrznSb', { network: mainnetNetwork });
  const p2pkh = new P2PKH(addr2);
  expect(addr2.getScript()).toStrictEqual(p2pkh.createScript());
});
