/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MintHeader } from '../../src/headers/mint_header';
import { IMintMeltEntry, MAX_MINT_MELT_ENTRIES } from '../../src/headers/mint_melt_entry';
import { VertexHeaderId, getVertexHeaderIdBuffer } from '../../src/headers/types';
import Network from '../../src/models/network';

const network = new Network('testnet');

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

    it('rejects more than MAX_MINT_MELT_ENTRIES entries (count check fires before the per-entry loop)', () => {
      const entries: IMintMeltEntry[] = Array.from(
        { length: MAX_MINT_MELT_ENTRIES + 1 },
        (_, i) => ({
          tokenIndex: i + 1,
          amount: 1n,
        })
      );
      expect(() => new MintHeader(entries)).toThrow(
        /MintHeader: too many entries: 17 exceeds maximum 16/
      );
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

    describe('post-construction mutation is caught at serialize time', () => {
      it('rejects a duplicate tokenIndex pushed after construction', () => {
        const header = new MintHeader([{ tokenIndex: 1, amount: 10n }]);
        header.entries.push({ tokenIndex: 1, amount: 20n });
        expect(() => header.serialize([])).toThrow(/MintHeader: duplicate token_index 1/);
      });

      it('rejects an amount mutated to 0 after construction', () => {
        const header = new MintHeader([{ tokenIndex: 1, amount: 10n }]);
        header.entries[0].amount = 0n;
        expect(() => header.serialize([])).toThrow(/MintHeader: amount must be in/);
      });

      it('rejects an entry array emptied after construction', () => {
        const header = new MintHeader([{ tokenIndex: 1, amount: 10n }]);
        header.entries.length = 0;
        expect(() => header.serialize([])).toThrow(/MintHeader requires at least 1 entry/);
      });

      it('catches the same drift via serializeFields and serializeSighash', () => {
        const header = new MintHeader([{ tokenIndex: 1, amount: 10n }]);
        header.entries[0].tokenIndex = 0;
        expect(() => header.serializeFields([])).toThrow(/MintHeader:/);
        expect(() => header.serializeSighash([])).toThrow(/MintHeader:/);
      });
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
