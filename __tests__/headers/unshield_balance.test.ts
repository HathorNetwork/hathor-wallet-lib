/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import UnshieldBalanceHeader from '../../src/headers/unshield_balance';
import { VertexHeaderId, getVertexHeaderIdBuffer } from '../../src/headers/types';
import Network from '../../src/models/network';

const network = new Network('testnet');
const EXCESS_BYTES = 32;

function makeExcess(fillByte = 0xab): Buffer {
  return Buffer.alloc(EXCESS_BYTES, fillByte);
}

describe('UnshieldBalanceHeader', () => {
  describe('constructor', () => {
    it('stores a 32-byte excess blinding factor', () => {
      const excess = makeExcess(0x42);
      const header = new UnshieldBalanceHeader(excess);
      expect(header.excessBlindingFactor.equals(excess)).toBe(true);
    });

    it('rejects a too-short excess buffer', () => {
      expect(() => new UnshieldBalanceHeader(Buffer.alloc(31))).toThrow(
        /excess_blinding_factor must be 32 bytes, got 31/
      );
    });

    it('rejects a too-long excess buffer', () => {
      expect(() => new UnshieldBalanceHeader(Buffer.alloc(33))).toThrow(
        /excess_blinding_factor must be 32 bytes, got 33/
      );
    });

    it('rejects an empty buffer', () => {
      expect(() => new UnshieldBalanceHeader(Buffer.alloc(0))).toThrow(
        /excess_blinding_factor must be 32 bytes, got 0/
      );
    });
  });

  describe('serialization', () => {
    const excess = makeExcess(0x77);
    const header = new UnshieldBalanceHeader(excess);

    it('serializeFields emits [id byte, excess bytes] in that order', () => {
      const acc: Buffer[] = [];
      header.serializeFields(acc);
      const wire = Buffer.concat(acc);
      expect(wire.length).toBe(1 + EXCESS_BYTES);
      expect(wire[0]).toBe(0x13);
      expect(wire.subarray(1).equals(excess)).toBe(true);
    });

    it('serialize, serializeFields and serializeSighash produce identical bytes', () => {
      const a: Buffer[] = [];
      const b: Buffer[] = [];
      const c: Buffer[] = [];
      header.serialize(a);
      header.serializeFields(b);
      header.serializeSighash(c);
      expect(Buffer.concat(a).equals(Buffer.concat(b))).toBe(true);
      expect(Buffer.concat(a).equals(Buffer.concat(c))).toBe(true);
    });

    it('emits the canonical UNSHIELD_BALANCE_HEADER id (0x13)', () => {
      const acc: Buffer[] = [];
      header.serializeFields(acc);
      expect(acc[0].equals(getVertexHeaderIdBuffer(VertexHeaderId.UNSHIELD_BALANCE_HEADER))).toBe(
        true
      );
    });
  });

  describe('deserialize', () => {
    it('round-trips through serialize → deserialize', () => {
      const excess = makeExcess(0x55);
      const original = new UnshieldBalanceHeader(excess);
      const acc: Buffer[] = [];
      original.serialize(acc);
      const wire = Buffer.concat(acc);

      const [parsed, leftover] = UnshieldBalanceHeader.deserialize(wire, network);
      expect(parsed).toBeInstanceOf(UnshieldBalanceHeader);
      expect((parsed as UnshieldBalanceHeader).excessBlindingFactor.equals(excess)).toBe(true);
      expect(leftover.length).toBe(0);
    });

    it('preserves trailing bytes', () => {
      const excess = makeExcess(0x11);
      const header = new UnshieldBalanceHeader(excess);
      const acc: Buffer[] = [];
      header.serialize(acc);
      const trailing = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
      const wire = Buffer.concat([Buffer.concat(acc), trailing]);

      const [, leftover] = UnshieldBalanceHeader.deserialize(wire, network);
      expect(leftover.equals(trailing)).toBe(true);
    });

    it('rejects a buffer whose first byte is not 0x13', () => {
      // 0x14 = MintHeader's id
      const wrongId = Buffer.concat([Buffer.from([0x14]), makeExcess()]);
      expect(() => UnshieldBalanceHeader.deserialize(wrongId, network)).toThrow(
        /Invalid vertex header id for unshield balance header/
      );
    });

    it('rejects a truncated body (excess less than 32 bytes)', () => {
      const truncated = Buffer.concat([Buffer.from([0x13]), Buffer.alloc(31)]);
      expect(() => UnshieldBalanceHeader.deserialize(truncated, network)).toThrow(
        /Truncated unshield balance header: need 32 bytes, got 31/
      );
    });

    it('copies the excess bytes into a fresh Buffer (no shared backing array)', () => {
      // Mutating the source buffer after deserialize should not change the parsed excess.
      const wire = Buffer.concat([Buffer.from([0x13]), makeExcess(0xaa)]);
      const [parsed] = UnshieldBalanceHeader.deserialize(wire, network);
      const beforeMutation = Buffer.from((parsed as UnshieldBalanceHeader).excessBlindingFactor);
      wire.fill(0x00, 1);
      expect((parsed as UnshieldBalanceHeader).excessBlindingFactor.equals(beforeMutation)).toBe(
        true
      );
    });
  });
});
