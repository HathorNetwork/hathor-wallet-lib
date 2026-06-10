/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey, PublicKey } from 'bitcore-lib';
import {
  encodeShieldedAddress,
  deriveShieldedAddress,
  assertValidCompressedPubkey,
} from '../../src/utils/shieldedAddress';
import Address from '../../src/models/address';
import Network from '../../src/models/network';

const testnetNetwork = new Network('testnet');

// Deterministic key material: fixed seed -> stable xpubs/pubkeys across runs.
const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x42), 'testnet');
const scanAcct = root.deriveChild("m/44'/280'/1'").deriveChild(0);
const spendAcct = root.deriveChild("m/44'/280'/2'").deriveChild(0);
const SCAN_XPUB: string = scanAcct.hdPublicKey.xpubkey;
const SPEND_XPUB: string = spendAcct.hdPublicKey.xpubkey;

const SCAN_PUBKEY: Buffer = scanAcct.deriveChild(0).publicKey.toBuffer();
const SPEND_PUBKEY: Buffer = spendAcct.deriveChild(0).publicKey.toBuffer();

// Deterministic off-curve 33-byte buffer (~50% of x values have no curve
// point; fixed curve params make the scan stable across runs).
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

describe('assertValidCompressedPubkey', () => {
  it('accepts a genuine compressed pubkey', () => {
    expect(() => assertValidCompressedPubkey(SCAN_PUBKEY, 'scan pubkey')).not.toThrow();
  });

  it('rejects wrong length', () => {
    expect(() => assertValidCompressedPubkey(Buffer.alloc(32, 0x02), 'scan pubkey')).toThrow(
      /expected 33-byte compressed EC point.*got 32 bytes/
    );
  });

  it('rejects an uncompressed prefix (0x04)', () => {
    const bad = Buffer.concat([Buffer.from([0x04]), SCAN_PUBKEY.subarray(1)]);
    expect(() => assertValidCompressedPubkey(bad, 'scan pubkey')).toThrow(/02\/03 prefix/);
  });

  it('rejects a well-shaped buffer whose x is not on the curve', () => {
    expect(() => assertValidCompressedPubkey(findOffCurvePubkey(), 'scan pubkey')).toThrow(
      /not a point on the secp256k1 curve/
    );
  });
});

describe('encodeShieldedAddress', () => {
  it('round-trips through Address extraction', () => {
    const base58 = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork);
    const addr = new Address(base58, { network: testnetNetwork });
    expect(addr.isValid()).toBe(true);
    expect(addr.getType()).toBe('shielded');
    expect(addr.getScanPubkey()).toEqual(SCAN_PUBKEY);
    expect(addr.getSpendPubkey()).toEqual(SPEND_PUBKEY);
  });

  it('rejects invalid scan or spend keys', () => {
    const offCurve = findOffCurvePubkey();
    expect(() => encodeShieldedAddress(offCurve, SPEND_PUBKEY, testnetNetwork)).toThrow(
      /Invalid scan pubkey/
    );
    expect(() => encodeShieldedAddress(SCAN_PUBKEY, offCurve, testnetNetwork)).toThrow(
      /Invalid spend pubkey/
    );
    expect(() =>
      encodeShieldedAddress(Buffer.alloc(20, 0x02), SPEND_PUBKEY, testnetNetwork)
    ).toThrow(/got 20 bytes/);
  });

  it('uses the network-specific version byte', () => {
    const testnetAddr = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, testnetNetwork);
    const mainnetAddr = encodeShieldedAddress(SCAN_PUBKEY, SPEND_PUBKEY, new Network('mainnet'));
    expect(testnetAddr).not.toBe(mainnetAddr);
    // Cross-network validation fails on the version byte
    const wrongNet = new Address(testnetAddr, { network: new Network('mainnet') });
    expect(wrongNet.isValid()).toBe(false);
  });
});

describe('deriveShieldedAddress', () => {
  it('is deterministic and index-sensitive', () => {
    const a = deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, 0, 'testnet');
    const b = deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, 0, 'testnet');
    const c = deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, 1, 'testnet');
    expect(a.base58).toBe(b.base58);
    expect(a.base58).not.toBe(c.base58);
    expect(a.bip32AddressIndex).toBe(0);
    expect(c.bip32AddressIndex).toBe(1);
  });

  it('derives the same child pubkeys as direct xpub derivation', () => {
    const info = deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, 0, 'testnet');
    expect(info.scanPubkey).toBe(SCAN_PUBKEY.toString('hex'));
    expect(info.spendPubkey).toBe(SPEND_PUBKEY.toString('hex'));
  });

  it('rejects out-of-bounds indexes with a deterministic error', () => {
    const cases = [-1, 1.5, NaN, 0x80000000];
    for (const bad of cases) {
      expect(() => deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, bad, 'testnet')).toThrow(
        /Invalid BIP32 address index/
      );
    }
    // Boundary: the largest non-hardened index is accepted
    expect(() => deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, 0x7fffffff, 'testnet')).not.toThrow();
  });

  it('spendAddress is consistent with Address.getSpendAddress()', () => {
    const info = deriveShieldedAddress(SCAN_XPUB, SPEND_XPUB, 3, 'testnet');
    const addr = new Address(info.base58, { network: testnetNetwork });
    expect(addr.getSpendAddress().base58).toBe(info.spendAddress);
    // And the spendAddress is a valid network P2PKH
    const spend = new Address(info.spendAddress, { network: testnetNetwork });
    expect(spend.getType()).toBe('p2pkh');
  });
});
