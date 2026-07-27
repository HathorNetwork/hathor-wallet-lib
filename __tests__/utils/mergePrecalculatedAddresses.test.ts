/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mergePrecalculatedAddresses } from '../integration/helpers/wallet-precalculation.helper';
import { IPrecalculatedShieldedAddress } from '../../src/types';

/**
 * This helper is the single funnel every integration wallet start routes its
 * pre-calculated addresses through, so a pair it drops is a pair the wallet
 * silently re-derives — the 40-58x jest-sandbox EC cost the shielded fixture
 * file exists to eliminate, reintroduced with a green suite.
 */
describe('mergePrecalculatedAddresses', () => {
  function shieldedAt(bip32AddressIndex: number): IPrecalculatedShieldedAddress {
    return {
      bip32AddressIndex,
      shieldedBase58: `shielded-${bip32AddressIndex}`,
      spendBase58: `spend-${bip32AddressIndex}`,
      scanPubkey: `02${bip32AddressIndex}`,
      spendPubkey: `03${bip32AddressIndex}`,
    };
  }

  it('pairs each legacy address with the shielded entry at its index', () => {
    const merged = mergePrecalculatedAddresses(['a', 'b'], [shieldedAt(0), shieldedAt(1)]);

    expect(merged).toHaveLength(2);
    expect(merged[0].base58).toBe('a');
    expect(merged[0].shielded!.shieldedBase58).toBe('shielded-0');
    expect(merged[1].base58).toBe('b');
    expect(merged[1].shielded!.shieldedBase58).toBe('shielded-1');
  });

  it('keeps a legacy address that has no shielded counterpart', () => {
    const merged = mergePrecalculatedAddresses(['a', 'b'], [shieldedAt(0)]);

    expect(merged).toHaveLength(2);
    expect(merged[1].base58).toBe('b');
    expect(merged[1].shielded).toBeUndefined();
  });

  /**
   * Regression: the merge used to walk the legacy array and look shielded pairs
   * up from that walk, with no reverse pass. A wallet whose fixture set is
   * shielded-only — WALLET_CONSTANTS.ocb, used by the nano-contract suite, has a
   * seed and 22 committed shielded pairs but no legacy list — had all 22 pairs
   * discarded and re-derived them live.
   */
  it('keeps shielded pairs when there is no legacy list at all', () => {
    const shielded = [shieldedAt(0), shieldedAt(1), shieldedAt(2)];

    for (const legacy of [undefined, null, []] as (string[] | undefined | null)[]) {
      const merged = mergePrecalculatedAddresses(legacy, shielded);
      expect(merged).toHaveLength(3);
      expect(merged.map(e => e.bip32AddressIndex)).toEqual([0, 1, 2]);
      expect(merged.every(e => e.shielded !== undefined)).toBe(true);
      expect(merged.every(e => e.base58 === undefined)).toBe(true);
    }
  });

  it('keeps shielded pairs at indexes past the end of a shorter legacy list', () => {
    const merged = mergePrecalculatedAddresses(
      ['a'],
      [shieldedAt(0), shieldedAt(1), shieldedAt(5)]
    );

    expect(merged.map(e => e.bip32AddressIndex)).toEqual([0, 1, 5]);
    expect(merged[0].base58).toBe('a');
    expect(merged[1].base58).toBeUndefined();
    expect(merged[1].shielded!.shieldedBase58).toBe('shielded-1');
    expect(merged[5 - 3].shielded!.shieldedBase58).toBe('shielded-5');
  });

  it('returns entries in ascending index order', () => {
    const merged = mergePrecalculatedAddresses(['a', 'b'], [shieldedAt(9), shieldedAt(3)]);
    expect(merged.map(e => e.bip32AddressIndex)).toEqual([0, 1, 3, 9]);
  });

  it('returns an empty list when neither chain is supplied', () => {
    expect(mergePrecalculatedAddresses(undefined, undefined)).toEqual([]);
    expect(mergePrecalculatedAddresses(null, null)).toEqual([]);
  });

  it('copies only the four shielded fields, dropping the nested index', () => {
    const merged = mergePrecalculatedAddresses(['a'], [shieldedAt(0)]);
    expect(Object.keys(merged[0].shielded!).sort()).toEqual([
      'scanPubkey',
      'shieldedBase58',
      'spendBase58',
      'spendPubkey',
    ]);
  });
});
