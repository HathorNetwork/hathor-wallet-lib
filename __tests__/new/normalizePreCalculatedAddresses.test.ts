import { normalizePreCalculatedAddresses } from '../../src/new/wallet';
import { IPrecalculatedAddress } from '../../src/types';

describe('normalizePreCalculatedAddresses', () => {
  it('returns an empty array for null or empty input', () => {
    expect(normalizePreCalculatedAddresses(null)).toEqual([]);
    expect(normalizePreCalculatedAddresses([])).toEqual([]);
  });

  it('maps a legacy string[] to legacy-only entries, index = array position (back-compat)', () => {
    expect(normalizePreCalculatedAddresses(['addrA', 'addrB', 'addrC'])).toEqual([
      { bip32AddressIndex: 0, base58: 'addrA' },
      { bip32AddressIndex: 1, base58: 'addrB' },
      { bip32AddressIndex: 2, base58: 'addrC' },
    ]);
  });

  it('legacy entries carry no shielded block, so they are flagged for derivation', () => {
    const normalized = normalizePreCalculatedAddresses(['addrA']);
    expect(normalized.every(entry => entry.shielded === undefined)).toBe(true);
  });

  it('passes a unified IPrecalculatedAddress[] through unchanged', () => {
    const unified: IPrecalculatedAddress[] = [
      {
        bip32AddressIndex: 0,
        base58: 'legacyA',
        shielded: {
          shieldedBase58: 'shieldedA',
          spendBase58: 'spendA',
          scanPubkey: 'scanA',
          spendPubkey: 'spendPubA',
        },
      },
      { bip32AddressIndex: 1, base58: 'legacyB' },
    ];
    // Same reference back — no copying, no mutation.
    expect(normalizePreCalculatedAddresses(unified)).toBe(unified);
  });
});
