/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { encoding, HDPrivateKey, PublicKey } from 'bitcore-lib';
import Address from '../../src/models/address';
import Network from '../../src/models/network';
import P2PKH from '../../src/models/p2pkh';
import P2SH from '../../src/models/p2sh';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import helpers from '../../src/utils/helpers';

// Deterministic GENUINE curve points for shielded-address tests:
// encodeShieldedAddress and the pubkey extractors validate on-curve
// membership, so fake `Buffer.alloc(33, ..)` keys are rejected.
const testHdRoot = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x01), 'testnet');
const SCAN_PUBKEY: Buffer = testHdRoot.deriveChild("m/0'/0").publicKey.toBuffer();
const SPEND_PUBKEY: Buffer = testHdRoot.deriveChild("m/1'/0").publicKey.toBuffer();

// Deterministic OFF-CURVE 33-byte buffer: scan fill bytes until we find an
// x-coordinate with no point on secp256k1 (~50% of x values). Fixed curve
// params make the result stable across runs.
function findOffCurvePubkey(): Buffer {
  for (let b = 0; b < 256; b++) {
    const candidate = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, b)]);
    try {
      PublicKey.fromBuffer(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('unreachable: no off-curve byte fill found');
}

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
  const shieldedAddr = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork);
  const addr = new Address(shieldedAddr, { network: testnetNetwork });

  // Should be valid
  expect(addr.isValid()).toBe(true);
  // Should be recognized as shielded
  expect(addr.getType()).toBe('shielded');
  expect(addr.isShielded()).toBe(true);
});

test('Shielded address getScanPubkey and getSpendPubkey', () => {
  const testnetNetwork = new Network('testnet');
  const shieldedAddr = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork);
  const addr = new Address(shieldedAddr, { network: testnetNetwork });

  expect(addr.getScanPubkey()).toEqual(SCAN_PUBKEY);
  expect(addr.getSpendPubkey()).toEqual(SPEND_PUBKEY);
});

test('Shielded address getSpendAddress and getScript derive the on-chain P2PKH', () => {
  const testnetNetwork = new Network('testnet');
  const shieldedAddr = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork);
  const addr = new Address(shieldedAddr, { network: testnetNetwork });

  // getSpendAddress: a valid P2PKH on the same network, derived from the spend pubkey
  const spendAddress = addr.getSpendAddress();
  expect(spendAddress.isValid()).toBe(true);
  expect(spendAddress.getType()).toBe('p2pkh');

  // getScript: identical bytes to building a P2PKH script from the spend address —
  // the shielded address has no script form of its own.
  const expectedScript = new P2PKH(spendAddress).createScript();
  expect(addr.getScript()).toStrictEqual(expectedScript);

  // Non-shielded addresses reject getSpendAddress
  const legacy = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', { network: testnetNetwork });
  expect(() => legacy.getSpendAddress()).toThrow('Not a shielded address');
});

test('Shielded address from another network is rejected', () => {
  const testnetNetwork = new Network('testnet');
  const mainnetNetwork = new Network('mainnet');
  // Encode for testnet (version byte 0x5d), validate against mainnet (expects 0x3c)
  const testnetAddr = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork);
  const addr = new Address(testnetAddr, { network: mainnetNetwork });
  expect(addr.isValid()).toBe(false);
  expect(() => addr.validateAddress()).toThrow(/Invalid network byte/);
});

test('Shielded address with off-curve pubkey is rejected at extraction', () => {
  const testnetNetwork = new Network('testnet');
  const offCurve = findOffCurvePubkey();

  // Craft the address manually (encodeShieldedAddress would reject the key):
  // valid version byte, valid checksum — only the curve check can catch it.
  const payload = Buffer.concat([
    Buffer.from([testnetNetwork.versionBytes.shielded]),
    offCurve,
    SPEND_PUBKEY,
  ]);
  const crafted = encoding.Base58.encode(Buffer.concat([payload, helpers.getChecksum(payload)]));
  const addr = new Address(crafted, { network: testnetNetwork });

  // Structure (length/checksum/version byte) is fine…
  expect(addr.isValid()).toBe(true);
  // …but extracting the scan pubkey fails the on-curve check.
  expect(() => addr.getScanPubkey()).toThrow(/not a point on the secp256k1 curve/);
  // The spend key is genuine, so its extraction still works.
  expect(addr.getSpendPubkey()).toEqual(SPEND_PUBKEY);
});

test('Non-shielded address getScanPubkey throws', () => {
  const addr = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  expect(() => addr.getScanPubkey()).toThrow('Not a shielded address');
  expect(() => addr.getSpendPubkey()).toThrow('Not a shielded address');
  expect(addr.isShielded()).toBe(false);
});

test('Rejects length/version-byte mismatches (crafted addresses with valid checksums)', () => {
  const testnetNetwork = new Network('testnet');

  // Helper: build a base58 address of arbitrary payload with a VALID checksum,
  // so only the new length↔version-byte cross-check can reject it.
  function craft(payload: Buffer): string {
    const checksum = helpers.getChecksum(payload);
    return encoding.Base58.encode(Buffer.concat([payload, checksum]));
  }

  // 25-byte (legacy-length) address carrying the SHIELDED version byte.
  // Without the cross-check this validated and getType() returned 'shielded',
  // making getScanPubkey() silently clamp its subarray reads.
  const shortShielded = craft(
    Buffer.concat([Buffer.from([testnetNetwork.versionBytes.shielded]), Buffer.alloc(20, 0xaa)])
  );
  const addr1 = new Address(shortShielded, { network: testnetNetwork });
  expect(addr1.isValid()).toBe(false);
  expect(() => addr1.validateAddress()).toThrow(/requires 71 bytes, got 25/);
  expect(addr1.isShielded()).toBe(false);

  // 71-byte (shielded-length) address carrying the legacy P2PKH version byte.
  const longLegacy = craft(
    Buffer.concat([Buffer.from([testnetNetwork.versionBytes.p2pkh]), Buffer.alloc(66, 0xbb)])
  );
  const addr2 = new Address(longLegacy, { network: testnetNetwork });
  expect(addr2.isValid()).toBe(false);
  expect(() => addr2.validateAddress()).toThrow(/requires 25 bytes, got 71/);

  // Sanity: correctly-shaped addresses of both families still validate.
  const goodShielded = new Address(
    encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork),
    { network: testnetNetwork }
  );
  expect(goodShielded.isValid()).toBe(true);
  const goodLegacy = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', {
    network: testnetNetwork,
  });
  expect(goodLegacy.isValid()).toBe(true);
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
