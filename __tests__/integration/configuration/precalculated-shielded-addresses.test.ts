/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Drift check for the committed shielded address fixtures.
 *
 * The fixtures spare every fixed-seed wallet (genesis, multisig, ocb, miner)
 * the per-index EC derivation at start, which jest's vm sandbox slows down
 * ~40-58x. This suite re-derives them live from the same seeds and asserts
 * equality, so the fixtures can never silently rot: if the derivation logic
 * or a seed in test-constants changes, this fails and the fixtures must be
 * regenerated (see the fixture file header for instructions).
 *
 * No network access is needed — this is pure derivation.
 */

import walletUtils from '../../../src/utils/wallet';
import { deriveShieldedAddress } from '../../../src/utils/shieldedAddress';
import { PRECALCULATED_SHIELDED_ADDRESSES } from './precalculated-shielded-addresses';
import { NETWORK_NAME, WALLET_CONSTANTS } from './test-constants';
import { multisigWalletsData } from '../helpers/wallet-precalculation.helper';

const EXPECTED_WINDOW = 22; // mirrors the legacy precalculated address window

// Access-data generation is expensive under jest (hardened derivations +
// PBKDF2) — do it once per seed, not once per compared index.
const accessDataCache = new Map<string, { scanXpubkey: string; spendXpubkey: string }>();
function getShieldedXpubs(words: string) {
  let cached = accessDataCache.get(words);
  if (!cached) {
    const accessData = walletUtils.generateAccessDataFromSeed(words, {
      pin: '123',
      password: '123',
      networkName: NETWORK_NAME,
    });
    cached = { scanXpubkey: accessData.scanXpubkey!, spendXpubkey: accessData.spendXpubkey! };
    accessDataCache.set(words, cached);
  }
  return cached;
}

/** Derive the fixture entry shape live, straight from the wallet's own code paths. */
function deriveLiveEntry(words: string, index: number) {
  const { scanXpubkey, spendXpubkey } = getShieldedXpubs(words);
  const info = deriveShieldedAddress(scanXpubkey, spendXpubkey, index, NETWORK_NAME);
  return {
    bip32AddressIndex: index,
    shieldedBase58: info.base58,
    spendBase58: info.spendAddress,
    scanPubkey: info.scanPubkey,
    spendPubkey: info.spendPubkey,
  };
}

describe('pre-calculated shielded address fixtures', () => {
  it('covers every fixed seed with a full window of well-formed entries', () => {
    const expectedSeeds = [
      WALLET_CONSTANTS.genesis.words,
      WALLET_CONSTANTS.miner.words,
      WALLET_CONSTANTS.ocb.seed,
      ...multisigWalletsData.words,
    ];
    for (const seedWords of expectedSeeds) {
      const entries = PRECALCULATED_SHIELDED_ADDRESSES[seedWords];
      expect(entries).toBeDefined();
      expect(entries).toHaveLength(EXPECTED_WINDOW);
      entries.forEach((entry, i) => {
        expect(entry.bip32AddressIndex).toBe(i);
        // 1B version + 33B scan + 33B spend + 4B checksum base58-encoded ≈ 97 chars.
        expect(entry.shieldedBase58.length).toBeGreaterThan(90);
        expect(entry.spendBase58).toMatch(/^W/); // testnet P2PKH
        expect(entry.scanPubkey).toMatch(/^0[23][0-9a-f]{64}$/);
        expect(entry.spendPubkey).toMatch(/^0[23][0-9a-f]{64}$/);
      });
    }
  });

  it('genesis fixtures equal live derivation at every index', () => {
    // Full re-derivation for one wallet pins the derivation LOGIC (paths,
    // encoding, network version byte); the per-seed spot checks below pin the
    // SEEDS. Full × all wallets would burn ~1min of jest-slowed EC per run for
    // no extra coverage.
    const { words } = WALLET_CONSTANTS.genesis;
    const entries = PRECALCULATED_SHIELDED_ADDRESSES[words];
    for (let i = 0; i < EXPECTED_WINDOW; i++) {
      expect(entries[i]).toEqual(deriveLiveEntry(words, i));
    }
  }, 120000);

  it('every other fixed seed matches live derivation at index 0', () => {
    const otherSeeds = [
      WALLET_CONSTANTS.miner.words,
      WALLET_CONSTANTS.ocb.seed,
      ...multisigWalletsData.words,
    ];
    for (const seedWords of otherSeeds) {
      expect(PRECALCULATED_SHIELDED_ADDRESSES[seedWords][0]).toEqual(deriveLiveEntry(seedWords, 0));
    }
  }, 120000);
});
