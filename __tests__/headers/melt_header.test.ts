/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MeltHeader } from '../../src/headers/melt_header';
import { MAX_MINT_MELT_ENTRIES, IMintMeltEntry } from '../../src/headers/mint_melt';
import { VertexHeaderId, getVertexHeaderIdBuffer } from '../../src/headers/types';
import Network from '../../src/models/network';

const network = new Network('testnet');

describe('MeltHeader', () => {
  describe('constructor', () => {
    it('stores the entries verbatim when valid', () => {
      const entries: IMintMeltEntry[] = [
        { tokenIndex: 1, amount: 10n },
        { tokenIndex: 2, amount: 20n },
      ];
      const header = new MeltHeader(entries);
      expect(header.entries).toEqual(entries);
    });

    it('rejects an empty entries list', () => {
      expect(() => new MeltHeader([])).toThrow(/MeltHeader requires at least 1 entry/);
    });

    it('rejects more than MAX_MINT_MELT_ENTRIES entries', () => {
      // 17 entries with valid token indices (1..16) plus a 17th that fails per-entry validation
      const entries: IMintMeltEntry[] = Array.from(
        { length: MAX_MINT_MELT_ENTRIES + 1 },
        (_, i) => ({
          tokenIndex: i + 1,
          amount: 1n,
        })
      );
      expect(() => new MeltHeader(entries)).toThrow(/MeltHeader:/);
    });

    it('rejects duplicate tokenIndex values', () => {
      const entries: IMintMeltEntry[] = [
        { tokenIndex: 3, amount: 1n },
        { tokenIndex: 3, amount: 1n },
      ];
      expect(() => new MeltHeader(entries)).toThrow(/MeltHeader: duplicate token_index 3/);
    });

    it('rejects an entry that fails per-entry validation', () => {
      expect(() => new MeltHeader([{ tokenIndex: 0, amount: 1n }])).toThrow(/MeltHeader:/);
      expect(() => new MeltHeader([{ tokenIndex: 1, amount: 0n }])).toThrow(/MeltHeader:/);
    });
  });

  describe('serialization', () => {
    const entries: IMintMeltEntry[] = [
      { tokenIndex: 1, amount: 50n },
      { tokenIndex: 3, amount: 1_000_000n },
    ];

    it('serializeFields prepends the MeltHeader id byte', () => {
      const header = new MeltHeader(entries);
      const acc: Buffer[] = [];
      header.serializeFields(acc);
      expect(acc.length).toBe(2);
      expect(acc[0].equals(getVertexHeaderIdBuffer(VertexHeaderId.MELT_HEADER))).toBe(true);
    });

    it('serialize, serializeFields and serializeSighash yield identical bytes', () => {
      const header = new MeltHeader(entries);
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
      const original = new MeltHeader(entries);
      const acc: Buffer[] = [];
      original.serialize(acc);
      const wire = Buffer.concat(acc);

      const [parsed, leftover] = MeltHeader.deserialize(wire, network);
      expect(parsed).toBeInstanceOf(MeltHeader);
      expect((parsed as MeltHeader).entries).toEqual(entries);
      expect(leftover.length).toBe(0);
    });

    it('preserves trailing bytes from the source buffer', () => {
      const entries: IMintMeltEntry[] = [{ tokenIndex: 2, amount: 7n }];
      const header = new MeltHeader(entries);
      const acc: Buffer[] = [];
      header.serialize(acc);
      const trailing = Buffer.from([0xaa, 0xbb]);
      const wire = Buffer.concat([Buffer.concat(acc), trailing]);

      const [, leftover] = MeltHeader.deserialize(wire, network);
      expect(leftover.equals(trailing)).toBe(true);
    });

    it('rejects a buffer that does not start with the MeltHeader id', () => {
      // 0x14 is MintHeader's id — wrong for MeltHeader.deserialize
      const wrongId = Buffer.from([0x14, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 1]);
      expect(() => MeltHeader.deserialize(wrongId, network)).toThrow(
        /Invalid vertex header id for melt header/
      );
    });
  });
});
