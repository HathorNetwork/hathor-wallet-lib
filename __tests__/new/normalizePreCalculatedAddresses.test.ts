import { normalizePreCalculatedAddresses } from '../../src/new/wallet';
import { IPrecalculatedAddress } from '../../src/types';

describe('normalizePreCalculatedAddresses', () => {
  it('returns an empty array for an absent or empty input', () => {
    expect(normalizePreCalculatedAddresses(null)).toEqual([]);
    expect(normalizePreCalculatedAddresses([])).toEqual([]);
    // The option is optional, so `undefined` reaches here on any wallet that
    // simply omits it — pinned so a refactor to `input === null` cannot pass.
    expect(normalizePreCalculatedAddresses(undefined)).toEqual([]);
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
    const normalized = normalizePreCalculatedAddresses(unified);
    expect(normalized).toEqual(unified);
    // Entries are passed through by reference — nothing is copied or mutated.
    expect(normalized[0]).toBe(unified[0]);
    expect(normalized[1]).toBe(unified[1]);
  });

  /**
   * Normalisation is per element rather than a whole-array classification from
   * element 0. "Unified where I have a fixture, plain string otherwise" is the
   * obvious caller shape, and sniffing element 0 mapped every later object to
   * `base58: <object>` — which `saveAddress` accepts, since it only rejects a
   * falsy base58, permanently poisoning that index.
   */
  it('normalises a mixed list per element', () => {
    const fixture = {
      bip32AddressIndex: 1,
      base58: 'legacyB',
      shielded: {
        shieldedBase58: 'shieldedB',
        spendBase58: 'spendB',
        scanPubkey: 'scanB',
        spendPubkey: 'spendPubB',
      },
    };

    expect(normalizePreCalculatedAddresses(['addrA', fixture, 'addrC'])).toEqual([
      { bip32AddressIndex: 0, base58: 'addrA' },
      fixture,
      { bip32AddressIndex: 2, base58: 'addrC' },
    ]);
  });

  it('gives a string entry the BIP32 index of its array position', () => {
    const fixture = { bip32AddressIndex: 9, base58: 'legacyNine' };
    const normalized = normalizePreCalculatedAddresses([fixture, 'addrB']);

    // The object keeps its declared index; the string takes its position.
    expect(normalized[0].bip32AddressIndex).toBe(9);
    expect(normalized[1]).toEqual({ bip32AddressIndex: 1, base58: 'addrB' });
  });
});
