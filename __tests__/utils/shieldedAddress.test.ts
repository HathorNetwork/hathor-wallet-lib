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

describe('shielded derivation — private key ↔ address pubkey agreement', () => {
  // `deriveChild` (compliant) and `deriveNonCompliantChild` (the legacy bitcore
  // bug) are identical for non-hardened children and for ~255/256 seeds, so most
  // seeds could NOT tell a revert to the non-compliant method apart. This seed is
  // chosen because its HARDENED shielded account paths (m/44'/280'/1' and /2')
  // DO diverge between the two methods — which makes "use the compliant method"
  // load-bearing here, so a revert is caught instead of sneaking through green.
  const divRoot = HDPrivateKey.fromSeed(Buffer.alloc(32, 0xa4), 'testnet');
  const scanAcctPriv = divRoot.deriveChild("m/44'/280'/1'").deriveChild(0);
  const spendAcctPriv = divRoot.deriveChild("m/44'/280'/2'").deriveChild(0);
  const scanXpub: string = scanAcctPriv.hdPublicKey.xpubkey;
  const spendXpub: string = spendAcctPriv.hdPublicKey.xpubkey;

  it('the private scan/spend child pubkey equals the on-chain address pubkey at every index', () => {
    // The key processing.ts derives to DETECT owned outputs (scan) and the key
    // transaction.ts derives to SIGN a shielded-spend input (spend) must equal the
    // pubkey deriveShieldedAddress bakes into the on-chain address — otherwise owned
    // outputs are undetectable and unspendable at the divergent indices.
    for (let i = 0; i < 8; i++) {
      const info = deriveShieldedAddress(scanXpub, spendXpub, i, 'testnet');
      expect(scanAcctPriv.deriveChild(i).publicKey.toString()).toBe(info.scanPubkey);
      expect(spendAcctPriv.deriveChild(i).publicKey.toString()).toBe(info.spendPubkey);
    }
  });

  it('the non-compliant account derivation produces different keys (the fix is load-bearing)', () => {
    // Reverting the account derivation in src/utils/wallet.ts to deriveNonCompliantChild
    // changes the entire scan/spend xpub for this seed, which would break the agreement
    // above. Pin the divergence so that revert cannot land green.
    expect(
      divRoot.deriveNonCompliantChild("m/44'/280'/1'").deriveNonCompliantChild(0).hdPublicKey
        .xpubkey
    ).not.toBe(scanXpub);
    expect(
      divRoot.deriveNonCompliantChild("m/44'/280'/2'").deriveNonCompliantChild(0).hdPublicKey
        .xpubkey
    ).not.toBe(spendXpub);
  });
});
