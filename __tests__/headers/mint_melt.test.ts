/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  MintHeader,
  MAX_MINT_MELT_ENTRIES,
  IMintMeltEntry,
  validateMintMeltEntry,
  serializeMintMeltEntries,
  deserializeMintMeltEntries,
} from '../../src/headers/mint_melt';
import { VertexHeaderId, getVertexHeaderIdBuffer } from '../../src/headers/types';
import Network from '../../src/models/network';

const network = new Network('testnet');

const HEADER_NAME = 'TestHeader';

describe('validateMintMeltEntry', () => {
  it('accepts the boundary indices 1 and MAX_MINT_MELT_ENTRIES', () => {
    expect(() => validateMintMeltEntry({ tokenIndex: 1, amount: 1n }, HEADER_NAME)).not.toThrow();
    expect(() =>
      validateMintMeltEntry({ tokenIndex: MAX_MINT_MELT_ENTRIES, amount: 1n }, HEADER_NAME)
    ).not.toThrow();
  });

  it('accepts the boundary amount values 1 and 2**64 - 1', () => {
    expect(() => validateMintMeltEntry({ tokenIndex: 1, amount: 1n }, HEADER_NAME)).not.toThrow();
    expect(() =>
      validateMintMeltEntry({ tokenIndex: 1, amount: (1n << 64n) - 1n }, HEADER_NAME)
    ).not.toThrow();
  });

  it('rejects tokenIndex 0 (HTR is forbidden)', () => {
    expect(() => validateMintMeltEntry({ tokenIndex: 0, amount: 1n }, HEADER_NAME)).toThrow(
      /token_index must be in \[1, 16\]/
    );
  });

  it('rejects tokenIndex greater than MAX_MINT_MELT_ENTRIES', () => {
    expect(() =>
      validateMintMeltEntry({ tokenIndex: MAX_MINT_MELT_ENTRIES + 1, amount: 1n }, HEADER_NAME)
    ).toThrow(/token_index must be in \[1, 16\]/);
  });

  it('rejects a non-integer tokenIndex', () => {
    expect(() => validateMintMeltEntry({ tokenIndex: 1.5, amount: 1n }, HEADER_NAME)).toThrow(
      /token_index must be in \[1, 16\]/
    );
  });

  it('rejects amount 0 and amount >= 2**64', () => {
    expect(() => validateMintMeltEntry({ tokenIndex: 1, amount: 0n }, HEADER_NAME)).toThrow(
      /amount must be in \[1, 2\*\*64\)/
    );
    expect(() => validateMintMeltEntry({ tokenIndex: 1, amount: 1n << 64n }, HEADER_NAME)).toThrow(
      /amount must be in \[1, 2\*\*64\)/
    );
  });

  it('embeds the header name in the error message', () => {
    expect(() => validateMintMeltEntry({ tokenIndex: 0, amount: 1n }, 'CustomHeader')).toThrow(
      /^CustomHeader: /
    );
  });
});

describe('serializeMintMeltEntries / deserializeMintMeltEntries round-trip', () => {
  it('round-trips a single entry', () => {
    const entries: IMintMeltEntry[] = [{ tokenIndex: 1, amount: 1n }];
    const buf = serializeMintMeltEntries(entries);
    // num_entries(1) + 1 entry × ENTRY_SIZE(9)
    expect(buf.length).toBe(1 + 9);
    const [parsed, leftover] = deserializeMintMeltEntries(buf, HEADER_NAME);
    expect(parsed).toEqual(entries);
    expect(leftover.length).toBe(0);
  });

  it('round-trips multiple entries preserving order', () => {
    const entries: IMintMeltEntry[] = [
      { tokenIndex: 1, amount: 100n },
      { tokenIndex: 3, amount: 200n },
      { tokenIndex: 5, amount: 9_999_999_999n },
    ];
    const buf = serializeMintMeltEntries(entries);
    const [parsed, leftover] = deserializeMintMeltEntries(buf, HEADER_NAME);
    expect(parsed).toEqual(entries);
    expect(leftover.length).toBe(0);
  });

  it('preserves trailing bytes after the entries section', () => {
    const entries: IMintMeltEntry[] = [{ tokenIndex: 2, amount: 42n }];
    const trailing = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const buf = Buffer.concat([serializeMintMeltEntries(entries), trailing]);
    const [parsed, leftover] = deserializeMintMeltEntries(buf, HEADER_NAME);
    expect(parsed).toEqual(entries);
    expect(leftover.equals(trailing)).toBe(true);
  });

  it('round-trips the maximum amount (2**64 - 1)', () => {
    const entries: IMintMeltEntry[] = [{ tokenIndex: 1, amount: (1n << 64n) - 1n }];
    const buf = serializeMintMeltEntries(entries);
    const [parsed] = deserializeMintMeltEntries(buf, HEADER_NAME);
    expect(parsed[0].amount).toBe((1n << 64n) - 1n);
  });

  it('writes amount big-endian (matches on-chain layout)', () => {
    const entries: IMintMeltEntry[] = [{ tokenIndex: 1, amount: 0x0102030405060708n }];
    const buf = serializeMintMeltEntries(entries);
    // skip num_entries(1) and token_index(1) bytes
    expect(buf.subarray(2)).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]));
  });
});

describe('deserializeMintMeltEntries error paths', () => {
  it('rejects an empty buffer (missing num_entries byte)', () => {
    expect(() => deserializeMintMeltEntries(Buffer.alloc(0), HEADER_NAME)).toThrow(
      /missing num_entries byte/
    );
  });

  it('rejects num_entries = 0', () => {
    expect(() => deserializeMintMeltEntries(Buffer.from([0x00]), HEADER_NAME)).toThrow(
      /must contain at least 1 entry/
    );
  });

  it('rejects num_entries > MAX_MINT_MELT_ENTRIES', () => {
    const tooMany = Buffer.alloc(1 + (MAX_MINT_MELT_ENTRIES + 1) * 9);
    tooMany.writeUInt8(MAX_MINT_MELT_ENTRIES + 1, 0);
    expect(() => deserializeMintMeltEntries(tooMany, HEADER_NAME)).toThrow(
      /too many entries: 17 exceeds maximum 16/
    );
  });

  it('rejects a truncated buffer (declared entries exceed remaining bytes)', () => {
    const truncated = Buffer.from([0x01, 0x01]); // declares 1 entry but only has 1 of 9 entry bytes
    expect(() => deserializeMintMeltEntries(truncated, HEADER_NAME)).toThrow(
      /requires 10 bytes, got 2/
    );
  });

  it('rejects tokenIndex = 0 on the wire (HTR forbidden)', () => {
    // num_entries=1, token_index=0, amount=1
    const buf = Buffer.from([0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(() => deserializeMintMeltEntries(buf, HEADER_NAME)).toThrow(
      /token_index must be >= 1.*HTR is forbidden/
    );
  });

  it('rejects tokenIndex > MAX_MINT_MELT_ENTRIES on the wire', () => {
    // num_entries=1, token_index=17, amount=1
    const buf = Buffer.from([0x01, 0x11, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(() => deserializeMintMeltEntries(buf, HEADER_NAME)).toThrow(
      /token_index 17 exceeds maximum 16/
    );
  });

  it('rejects amount = 0 on the wire', () => {
    // num_entries=1, token_index=1, amount=0
    const buf = Buffer.from([0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => deserializeMintMeltEntries(buf, HEADER_NAME)).toThrow(/amount must be >= 1/);
  });

  it('rejects duplicate tokenIndex within a single header', () => {
    // num_entries=2, both entries use token_index=2, amount=1
    const buf = Buffer.from([0x02, 0x02, 0, 0, 0, 0, 0, 0, 0, 1, 0x02, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(() => deserializeMintMeltEntries(buf, HEADER_NAME)).toThrow(/duplicate token_index 2/);
  });
});

describe('MintHeader', () => {
  describe('constructor', () => {
    it('stores the entries verbatim when valid', () => {
      const entries: IMintMeltEntry[] = [
        { tokenIndex: 1, amount: 10n },
        { tokenIndex: 2, amount: 20n },
      ];
      const header = new MintHeader(entries);
      expect(header.entries).toEqual(entries);
    });

    it('rejects an empty entries list', () => {
      expect(() => new MintHeader([])).toThrow(/MintHeader requires at least 1 entry/);
    });

    it('rejects more than MAX_MINT_MELT_ENTRIES entries', () => {
      const entries: IMintMeltEntry[] = Array.from(
        { length: MAX_MINT_MELT_ENTRIES + 1 },
        (_, i) => ({
          tokenIndex: i + 1,
          amount: 1n,
        })
      );
      // tokenIndex 17 exceeds the per-entry validator before the overall count check
      expect(() => new MintHeader(entries)).toThrow(/MintHeader:/);
    });

    it('rejects duplicate tokenIndex values', () => {
      const entries: IMintMeltEntry[] = [
        { tokenIndex: 2, amount: 1n },
        { tokenIndex: 2, amount: 1n },
      ];
      expect(() => new MintHeader(entries)).toThrow(/MintHeader: duplicate token_index 2/);
    });

    it('rejects an entry that fails per-entry validation', () => {
      const entries: IMintMeltEntry[] = [{ tokenIndex: 0, amount: 1n }];
      expect(() => new MintHeader(entries)).toThrow(/MintHeader:/);
    });
  });

  describe('serialization', () => {
    const entries: IMintMeltEntry[] = [
      { tokenIndex: 1, amount: 50n },
      { tokenIndex: 3, amount: 1_000_000n },
    ];

    it('serializeFields prepends the MintHeader id byte', () => {
      const header = new MintHeader(entries);
      const acc: Buffer[] = [];
      header.serializeFields(acc);
      expect(acc.length).toBe(2);
      expect(acc[0].equals(getVertexHeaderIdBuffer(VertexHeaderId.MINT_HEADER))).toBe(true);
    });

    it('serialize, serializeFields and serializeSighash yield identical bytes', () => {
      const header = new MintHeader(entries);
      const a: Buffer[] = [];
      const b: Buffer[] = [];
      const c: Buffer[] = [];
      header.serialize(a);
      header.serializeFields(b);
      header.serializeSighash(c);
      expect(Buffer.concat(a).equals(Buffer.concat(b))).toBe(true);
      expect(Buffer.concat(a).equals(Buffer.concat(c))).toBe(true);
    });
  });

  describe('deserialize', () => {
    it('round-trips through serialize → deserialize', () => {
      const entries: IMintMeltEntry[] = [
        { tokenIndex: 1, amount: 10n },
        { tokenIndex: 4, amount: 2n ** 50n },
      ];
      const original = new MintHeader(entries);
      const acc: Buffer[] = [];
      original.serialize(acc);
      const wire = Buffer.concat(acc);

      const [parsed, leftover] = MintHeader.deserialize(wire, network);
      expect(parsed).toBeInstanceOf(MintHeader);
      expect((parsed as MintHeader).entries).toEqual(entries);
      expect(leftover.length).toBe(0);
    });

    it('preserves trailing bytes from the source buffer', () => {
      const entries: IMintMeltEntry[] = [{ tokenIndex: 2, amount: 7n }];
      const header = new MintHeader(entries);
      const acc: Buffer[] = [];
      header.serialize(acc);
      const trailing = Buffer.from([0xaa, 0xbb]);
      const wire = Buffer.concat([Buffer.concat(acc), trailing]);

      const [, leftover] = MintHeader.deserialize(wire, network);
      expect(leftover.equals(trailing)).toBe(true);
    });

    it('rejects a buffer that does not start with the MintHeader id', () => {
      // 0x15 is MeltHeader's id — wrong for MintHeader.deserialize
      const wrongId = Buffer.from([0x15, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 1]);
      expect(() => MintHeader.deserialize(wrongId, network)).toThrow(
        /Invalid vertex header id for mint header/
      );
    });
  });
});
