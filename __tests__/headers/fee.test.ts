/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import FeeHeader from '../../src/headers/fee';
import Transaction from '../../src/models/transaction';
import Network from '../../src/models/network';
import { IFeeEntry } from '../../src/types';
import { VertexHeaderId, getVertexHeaderIdBuffer } from '../../src/headers/types';

describe('FeeHeader', () => {
  const network = new Network('testnet');
  const HTR_TOKEN_INDEX = 0; // HTR is always at index 0

  describe('Constructor and basic properties', () => {
    it('should create a FeeHeader with empty entries', () => {
      const header = new FeeHeader([]);
      expect(header.entries).toEqual([]);
    });

    it('should create a FeeHeader with single entry', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
      const header = new FeeHeader(entries);
      expect(header.entries).toEqual(entries);
      expect(header.entries[0].tokenIndex).toBe(HTR_TOKEN_INDEX);
      expect(header.entries[0].amount).toBe(100n);
    });

    it('should create a FeeHeader with multiple entries', () => {
      const customTokenIndex = 1;
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: customTokenIndex, amount: 200n },
      ];
      const header = new FeeHeader(entries);
      expect(header.entries).toEqual(entries);
      expect(header.entries.length).toBe(2);
    });
  });

  describe('Serialization', () => {
    it('should serialize empty fee header', () => {
      const header = new FeeHeader([]);
      const array: Buffer[] = [];
      header.serialize(array);

      const serialized = Buffer.concat(array);

      // Check header ID (first byte)
      expect(serialized[0]).toBe(0x11); // FEE_HEADER = '11'

      // Check num entries (second byte)
      expect(serialized[1]).toBe(0);
    });

    it('should serialize fee header with single HTR entry', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
      const header = new FeeHeader(entries);
      const array: Buffer[] = [];
      header.serialize(array);

      const serialized = Buffer.concat(array);

      // Check header ID
      expect(serialized[0]).toBe(0x11);

      // Check num entries
      expect(serialized[1]).toBe(1);

      // Check tokenIndex (1 byte)
      expect(serialized[2]).toBe(HTR_TOKEN_INDEX);

      // Verify we have data after tokenIndex
      expect(serialized.length).toBeGreaterThan(3);
    });

    it('should serialize fee header with multiple entries', () => {
      const customTokenIndex = 1;
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: customTokenIndex, amount: 200n },
      ];
      const header = new FeeHeader(entries);
      const array: Buffer[] = [];
      header.serialize(array);

      const serialized = Buffer.concat(array);

      // Check header ID
      expect(serialized[0]).toBe(0x11);

      // Check num entries
      expect(serialized[1]).toBe(2);
    });

    it('should serialize large amounts correctly using LEB128', () => {
      const largeAmount = 1000000n; // 1 million
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: largeAmount }];
      const header = new FeeHeader(entries);
      const array: Buffer[] = [];
      header.serialize(array);

      const serialized = Buffer.concat(array);
      // Header ID (1) + num_entries (1) + tokenIndex (1) + LEB128 amount (variable, at least 1)
      expect(serialized.length).toBeGreaterThan(3);
    });
  });

  describe('serializeSighash', () => {
    it('should produce same output as serializeFields', () => {
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: 1, amount: 200n },
      ];
      const header = new FeeHeader(entries);

      const arrayFields: Buffer[] = [];
      const arraySighash: Buffer[] = [];

      header.serializeFields(arrayFields);
      header.serializeSighash(arraySighash);

      const bufferFields = Buffer.concat(arrayFields);
      const bufferSighash = Buffer.concat(arraySighash);

      expect(bufferSighash).toEqual(bufferFields);
    });
  });

  describe('Deserialization', () => {
    it('should deserialize empty fee header', () => {
      const original = new FeeHeader([]);
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      const [deserialized, remaining] = FeeHeader.deserialize(serialized, network);

      expect(deserialized).toBeInstanceOf(FeeHeader);
      expect((deserialized as FeeHeader).entries).toEqual([]);
      expect(remaining.length).toBe(0);
    });

    it('should deserialize fee header with single entry', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
      const original = new FeeHeader(entries);
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      const [deserialized, remaining] = FeeHeader.deserialize(serialized, network);

      expect(deserialized).toBeInstanceOf(FeeHeader);
      const feeHeader = deserialized as FeeHeader;
      expect(feeHeader.entries.length).toBe(1);
      expect(feeHeader.entries[0].tokenIndex).toBe(HTR_TOKEN_INDEX);
      expect(feeHeader.entries[0].amount).toBe(100n);
      expect(remaining.length).toBe(0);
    });

    it('should deserialize fee header with multiple entries', () => {
      const customTokenIndex = 1;
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: customTokenIndex, amount: 200n },
      ];
      const original = new FeeHeader(entries);
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      const [deserialized, remaining] = FeeHeader.deserialize(serialized, network);

      expect(deserialized).toBeInstanceOf(FeeHeader);
      const feeHeader = deserialized as FeeHeader;
      expect(feeHeader.entries.length).toBe(2);
      expect(feeHeader.entries[0].tokenIndex).toBe(HTR_TOKEN_INDEX);
      expect(feeHeader.entries[0].amount).toBe(100n);
      expect(feeHeader.entries[1].tokenIndex).toBe(customTokenIndex);
      expect(feeHeader.entries[1].amount).toBe(200n);
      expect(remaining.length).toBe(0);
    });

    it('should throw error for invalid header ID', () => {
      // Create a buffer with wrong header ID
      const wrongHeaderId = getVertexHeaderIdBuffer(VertexHeaderId.NANO_HEADER);
      const numEntries = Buffer.from([0]);
      const wrongBuffer = Buffer.concat([wrongHeaderId, numEntries]);

      expect(() => {
        FeeHeader.deserialize(wrongBuffer, network);
      }).toThrow('Invalid vertex header id for fee header.');
    });

    it('should preserve remaining buffer after deserialization', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
      const original = new FeeHeader(entries);
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      // Add extra data to the buffer
      const extraData = Buffer.from([0xaa, 0xbb, 0xcc]);
      const bufferWithExtra = Buffer.concat([serialized, extraData]);

      const [deserialized, remaining] = FeeHeader.deserialize(bufferWithExtra, network);

      expect(deserialized).toBeInstanceOf(FeeHeader);
      expect(remaining).toEqual(extraData);
    });
  });

  describe('Round-trip serialization', () => {
    it('should maintain data integrity after serialize + deserialize (single entry)', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
      const original = new FeeHeader(entries);

      // Serialize
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      // Deserialize
      const [deserialized] = FeeHeader.deserialize(serialized, network);
      const feeHeader = deserialized as FeeHeader;

      // Verify
      expect(feeHeader.entries).toEqual(original.entries);
    });

    it('should maintain data integrity after serialize + deserialize (multiple entries)', () => {
      const tokenIndex1 = 1;
      const tokenIndex2 = 2;
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: tokenIndex1, amount: 200n },
        { tokenIndex: tokenIndex2, amount: 300n },
      ];
      const original = new FeeHeader(entries);

      // Serialize
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      // Deserialize
      const [deserialized] = FeeHeader.deserialize(serialized, network);
      const feeHeader = deserialized as FeeHeader;

      // Verify
      expect(feeHeader.entries).toEqual(original.entries);
    });

    it('should handle large amounts correctly', () => {
      const largeAmount = 999999999900n; // Multiple of 100
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: largeAmount }];
      const original = new FeeHeader(entries);

      // Serialize
      const serializedArray: Buffer[] = [];
      original.serialize(serializedArray);
      const serialized = Buffer.concat(serializedArray);

      // Deserialize
      const [deserialized] = FeeHeader.deserialize(serialized, network);
      const feeHeader = deserialized as FeeHeader;

      // Verify
      expect(feeHeader.entries[0].amount).toBe(largeAmount);
    });
  });

  describe('Helper methods', () => {
    describe('getFeeForTokenIndex', () => {
      it('should return null for token index not in entries', () => {
        const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
        const header = new FeeHeader(entries);

        const customTokenIndex = 1;
        expect(header.getFeeForTokenIndex(customTokenIndex)).toBeNull();
      });

      it('should return correct fee for token index', () => {
        const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
        const header = new FeeHeader(entries);

        expect(header.getFeeForTokenIndex(HTR_TOKEN_INDEX)).toBe(100n);
      });

      it('should return correct fee for multiple entries', () => {
        const tokenIndex1 = 1;
        const entries: IFeeEntry[] = [
          { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
          { tokenIndex: tokenIndex1, amount: 200n },
        ];
        const header = new FeeHeader(entries);

        expect(header.getFeeForTokenIndex(HTR_TOKEN_INDEX)).toBe(100n);
        expect(header.getFeeForTokenIndex(tokenIndex1)).toBe(200n);
      });
    });

    describe('hasTokenIndex', () => {
      it('should return false for token index not in entries', () => {
        const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
        const header = new FeeHeader(entries);

        const customTokenIndex = 1;
        expect(header.hasTokenIndex(customTokenIndex)).toBe(false);
      });

      it('should return true for token index in entries', () => {
        const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
        const header = new FeeHeader(entries);

        expect(header.hasTokenIndex(HTR_TOKEN_INDEX)).toBe(true);
      });

      it('should handle multiple entries correctly', () => {
        const entries: IFeeEntry[] = [
          { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
          { tokenIndex: 1, amount: 200n },
          { tokenIndex: 5, amount: 300n },
        ];
        const header = new FeeHeader(entries);

        expect(header.hasTokenIndex(HTR_TOKEN_INDEX)).toBe(true);
        expect(header.hasTokenIndex(1)).toBe(true);
        expect(header.hasTokenIndex(5)).toBe(true);
        expect(header.hasTokenIndex(2)).toBe(false);
        expect(header.hasTokenIndex(10)).toBe(false);
      });
    });

    describe('getTokenIndexes', () => {
      it('should return empty array for no entries', () => {
        const header = new FeeHeader([]);
        expect(header.getTokenIndexes()).toEqual([]);
      });

      it('should return single token index', () => {
        const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }];
        const header = new FeeHeader(entries);

        expect(header.getTokenIndexes()).toEqual([HTR_TOKEN_INDEX]);
      });

      it('should return all token indexes in order', () => {
        const tokenIndex1 = 1;
        const tokenIndex2 = 2;
        const entries: IFeeEntry[] = [
          { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
          { tokenIndex: tokenIndex1, amount: 200n },
          { tokenIndex: tokenIndex2, amount: 300n },
        ];
        const header = new FeeHeader(entries);

        const indexes = header.getTokenIndexes();
        expect(indexes).toEqual([HTR_TOKEN_INDEX, tokenIndex1, tokenIndex2]);
      });
    });
  });

  describe('validate', () => {
    it('should not throw for valid entries', () => {
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: 1, amount: 200n },
      ];
      const header = new FeeHeader(entries);

      expect(() => header.validate()).not.toThrow();
    });

    it('should not throw for empty entries', () => {
      const header = new FeeHeader([]);
      expect(() => header.validate()).not.toThrow();
    });

    it('should throw for duplicate token index', () => {
      const entries: IFeeEntry[] = [
        { tokenIndex: HTR_TOKEN_INDEX, amount: 100n },
        { tokenIndex: HTR_TOKEN_INDEX, amount: 200n },
      ];
      const header = new FeeHeader(entries);

      expect(() => header.validate()).toThrow('Duplicate token index in fee header: 0');
    });

    it('should throw for negative token index', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: -1, amount: 100n }];
      const header = new FeeHeader(entries);

      expect(() => header.validate()).toThrow('Invalid token index in fee header: -1');
    });

    it('should throw for zero amount', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: 0n }];
      const header = new FeeHeader(entries);

      expect(() => header.validate()).toThrow('Fee amount must be positive for token index 0');
    });

    it('should throw for negative amount', () => {
      const entries: IFeeEntry[] = [{ tokenIndex: HTR_TOKEN_INDEX, amount: -100n }];
      const header = new FeeHeader(entries);

      expect(() => header.validate()).toThrow('Fee amount must be positive for token index 0');
    });

    it('should throw for too many entries (> 16)', () => {
      // Create entries with amounts that are multiples of DIVISOR (100)
      const entries: IFeeEntry[] = Array.from({ length: 17 }, (_, i) => ({
        tokenIndex: i,
        amount: 100n,
      }));
      const header = new FeeHeader(entries);

      expect(() => header.validate()).toThrow('Fee header can have at most 16 entries, got 17');
    });

    it('should not throw for exactly 16 entries', () => {
      // Create entries with amounts that are multiples of DIVISOR (100)
      const entries: IFeeEntry[] = Array.from({ length: 16 }, (_, i) => ({
        tokenIndex: i,
        amount: 100n,
      }));
      const header = new FeeHeader(entries);

      expect(() => header.validate()).not.toThrow();
    });
  });

  describe('getHeadersFromTx', () => {
    it('should return null when transaction has no fee header', () => {
      const tx = new Transaction([], []);
      const feeHeader = FeeHeader.getHeadersFromTx(tx);
      expect(feeHeader).toBeNull();
    });

    it('should return fee header from transaction', () => {
      const tx = new Transaction([], []);
      const feeHeader = new FeeHeader([{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }]);
      tx.headers.push(feeHeader);

      const retrieved = FeeHeader.getHeadersFromTx(tx);
      expect(retrieved).toBe(feeHeader);
    });

    it('should return first fee header when multiple are present', () => {
      const tx = new Transaction([], []);
      const feeHeader1 = new FeeHeader([{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }]);
      const feeHeader2 = new FeeHeader([{ tokenIndex: 1, amount: 200n }]);
      tx.headers.push(feeHeader1);
      tx.headers.push(feeHeader2);

      const retrieved = FeeHeader.getHeadersFromTx(tx);
      expect(retrieved).toBe(feeHeader1);
    });
  });

  describe('Integration with Transaction', () => {
    describe('hasFeeHeader', () => {
      it('should return false when transaction has no fee header', () => {
        const tx = new Transaction([], []);
        expect(tx.hasFeeHeader()).toBe(false);
      });

      it('should return true when transaction has fee header', () => {
        const tx = new Transaction([], []);
        const feeHeader = new FeeHeader([{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }]);
        tx.headers.push(feeHeader);

        expect(tx.hasFeeHeader()).toBe(true);
      });
    });

    describe('getFeeHeader', () => {
      it('should return null when transaction has no fee header', () => {
        const tx = new Transaction([], []);
        expect(tx.getFeeHeader()).toBeNull();
      });

      it('should return fee header when present', () => {
        const tx = new Transaction([], []);
        const feeHeader = new FeeHeader([{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }]);
        tx.headers.push(feeHeader);

        const retrieved = tx.getFeeHeader();
        expect(retrieved).toBe(feeHeader);
      });

      it('should return first fee header when multiple are present', () => {
        const tx = new Transaction([], []);
        const feeHeader1 = new FeeHeader([{ tokenIndex: HTR_TOKEN_INDEX, amount: 100n }]);
        const feeHeader2 = new FeeHeader([{ tokenIndex: HTR_TOKEN_INDEX, amount: 200n }]);
        tx.headers.push(feeHeader1);
        tx.headers.push(feeHeader2);

        const retrieved = tx.getFeeHeader();
        expect(retrieved).toBe(feeHeader1);
      });
    });
  });
});
