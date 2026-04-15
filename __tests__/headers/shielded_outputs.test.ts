/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ShieldedOutputsHeader from '../../src/headers/shielded_outputs';
import ShieldedOutput from '../../src/models/shielded_output';
import { ShieldedOutputMode } from '../../src/shielded/types';
import Network from '../../src/models/network';

function makeAmountShieldedOutput(
  overrides: Partial<{
    commitment: Buffer;
    rangeProof: Buffer;
    tokenData: number;
    script: Buffer;
    ephemeralPubkey: Buffer;
  }> = {}
): ShieldedOutput {
  return new ShieldedOutput(
    ShieldedOutputMode.AMOUNT_SHIELDED,
    overrides.commitment ?? Buffer.alloc(33, 0x01),
    overrides.rangeProof ?? Buffer.from([0x02, 0x03, 0x04]),
    overrides.tokenData ?? 0,
    overrides.script ?? Buffer.from([0x76, 0xa9, 0x14]),
    overrides.ephemeralPubkey ?? Buffer.alloc(33, 0x05)
  );
}

function makeFullShieldedOutput(
  overrides: Partial<{
    commitment: Buffer;
    rangeProof: Buffer;
    script: Buffer;
    ephemeralPubkey: Buffer;
    assetCommitment: Buffer;
    surjectionProof: Buffer;
  }> = {}
): ShieldedOutput {
  return new ShieldedOutput(
    ShieldedOutputMode.FULLY_SHIELDED,
    overrides.commitment ?? Buffer.alloc(33, 0x11),
    overrides.rangeProof ?? Buffer.from([0x22, 0x33]),
    0,
    overrides.script ?? Buffer.from([0x76, 0xa9]),
    overrides.ephemeralPubkey ?? Buffer.alloc(33, 0x44),
    overrides.assetCommitment ?? Buffer.alloc(33, 0x55),
    overrides.surjectionProof ?? Buffer.from([0x66, 0x77, 0x88]),
    0n
  );
}

describe('ShieldedOutputsHeader', () => {
  const network = new Network('testnet');

  describe('serialize', () => {
    it('should serialize header with AmountShielded outputs', () => {
      const out1 = makeAmountShieldedOutput();
      const out2 = makeAmountShieldedOutput({ tokenData: 1 });
      const header = new ShieldedOutputsHeader([out1, out2]);

      const parts: Buffer[] = [];
      header.serialize(parts);
      const buf = Buffer.concat(parts);

      // First byte is header ID (0x12)
      expect(buf[0]).toBe(0x12);
      // Second byte is number of outputs
      expect(buf[1]).toBe(2);
    });

    it('should serialize header with FullShielded outputs', () => {
      const out = makeFullShieldedOutput();
      const header = new ShieldedOutputsHeader([out]);

      const parts: Buffer[] = [];
      header.serialize(parts);
      const buf = Buffer.concat(parts);

      expect(buf[0]).toBe(0x12);
      expect(buf[1]).toBe(1);
    });
  });

  describe('serializeSighash', () => {
    it('should produce different output from serialize (no proofs)', () => {
      const out = makeAmountShieldedOutput();
      const header = new ShieldedOutputsHeader([out]);

      const serParts: Buffer[] = [];
      header.serialize(serParts);
      const serialized = Buffer.concat(serParts);

      const sighashParts: Buffer[] = [];
      header.serializeSighash(sighashParts);
      const sighash = Buffer.concat(sighashParts);

      // Sighash should be shorter (no range_proof length prefix or data)
      expect(sighash.length).toBeLessThan(serialized.length);
      // Both should start with header ID and count
      expect(sighash[0]).toBe(0x12);
      expect(sighash[1]).toBe(1);
    });
  });

  describe('deserialize', () => {
    it('should round-trip AmountShielded outputs', () => {
      const out1 = makeAmountShieldedOutput();
      const out2 = makeAmountShieldedOutput({ tokenData: 2, script: Buffer.from([0xab, 0xcd]) });
      const header = new ShieldedOutputsHeader([out1, out2]);

      const parts: Buffer[] = [];
      header.serialize(parts);
      const serialized = Buffer.concat(parts);

      const [deserialized, remaining] = ShieldedOutputsHeader.deserialize(serialized, network);
      const result = deserialized as ShieldedOutputsHeader;

      expect(remaining.length).toBe(0);
      expect(result.shieldedOutputs.length).toBe(2);

      expect(result.shieldedOutputs[0].mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      expect(result.shieldedOutputs[0].commitment).toEqual(out1.commitment);
      expect(result.shieldedOutputs[0].rangeProof).toEqual(out1.rangeProof);
      expect(result.shieldedOutputs[0].tokenData).toBe(0);
      expect(result.shieldedOutputs[0].script).toEqual(out1.script);
      expect(result.shieldedOutputs[0].ephemeralPubkey).toEqual(out1.ephemeralPubkey);

      expect(result.shieldedOutputs[1].tokenData).toBe(2);
      expect(result.shieldedOutputs[1].script).toEqual(Buffer.from([0xab, 0xcd]));
    });

    it('should round-trip FullShielded outputs', () => {
      const out = makeFullShieldedOutput();
      const header = new ShieldedOutputsHeader([out]);

      const parts: Buffer[] = [];
      header.serialize(parts);
      const serialized = Buffer.concat(parts);

      const [deserialized, remaining] = ShieldedOutputsHeader.deserialize(serialized, network);
      const result = deserialized as ShieldedOutputsHeader;

      expect(remaining.length).toBe(0);
      expect(result.shieldedOutputs.length).toBe(1);

      const d = result.shieldedOutputs[0];
      expect(d.mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(d.commitment).toEqual(out.commitment);
      expect(d.rangeProof).toEqual(out.rangeProof);
      expect(d.script).toEqual(out.script);
      expect(d.ephemeralPubkey).toEqual(out.ephemeralPubkey);
      expect(d.assetCommitment).toEqual(out.assetCommitment);
      expect(d.surjectionProof).toEqual(out.surjectionProof);
    });

    it('should round-trip mixed AmountShielded and FullShielded outputs', () => {
      const amountOut = makeAmountShieldedOutput({ tokenData: 1 });
      const fullOut = makeFullShieldedOutput();
      const header = new ShieldedOutputsHeader([amountOut, fullOut]);

      const parts: Buffer[] = [];
      header.serialize(parts);
      const serialized = Buffer.concat(parts);

      const [deserialized, remaining] = ShieldedOutputsHeader.deserialize(serialized, network);
      const result = deserialized as ShieldedOutputsHeader;

      expect(remaining.length).toBe(0);
      expect(result.shieldedOutputs.length).toBe(2);
      expect(result.shieldedOutputs[0].mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      expect(result.shieldedOutputs[1].mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
    });

    it('should preserve remaining buffer bytes', () => {
      const out = makeAmountShieldedOutput();
      const header = new ShieldedOutputsHeader([out]);

      const parts: Buffer[] = [];
      header.serialize(parts);
      const trailingData = Buffer.from([0xfe, 0xed]);
      const serialized = Buffer.concat([Buffer.concat(parts), trailingData]);

      const [_, remaining] = ShieldedOutputsHeader.deserialize(serialized, network);
      expect(remaining).toEqual(trailingData);
    });

    it('should throw for invalid header ID', () => {
      const buf = Buffer.from([0xff, 0x01]);
      expect(() => ShieldedOutputsHeader.deserialize(buf, network)).toThrow('Invalid');
    });

    it('should re-serialize to identical bytes', () => {
      const header = new ShieldedOutputsHeader([
        makeAmountShieldedOutput(),
        makeFullShieldedOutput(),
      ]);

      const parts1: Buffer[] = [];
      header.serialize(parts1);
      const bytes1 = Buffer.concat(parts1);

      const [deserialized] = ShieldedOutputsHeader.deserialize(bytes1, network);
      const parts2: Buffer[] = [];
      (deserialized as ShieldedOutputsHeader).serialize(parts2);
      const bytes2 = Buffer.concat(parts2);

      expect(bytes2).toEqual(bytes1);
    });
  });

  describe('deserialization bounds checking', () => {
    const network = new Network('testnet');
    // Header ID (0x12) + numOutputs(1) + mode(1) = minimum 3 bytes before commitment
    const headerId = 0x12;

    it('should throw on truncated commitment', () => {
      // header_id + num_outputs=1 + mode=1 + only 32 bytes (need 33)
      const buf = Buffer.from([headerId, 0x01, 0x01, ...Array(32).fill(0)]);
      expect(() => ShieldedOutputsHeader.deserialize(buf, network)).toThrow(/missing commitment/);
    });

    it('should throw on truncated range proof', () => {
      // header_id + num=1 + mode=1 + commitment(33) + rp_len=2 bytes saying 100 + only 10 bytes
      const buf = Buffer.alloc(3 + 33 + 2 + 10);
      buf[0] = headerId;
      buf[1] = 1; // num outputs
      buf[2] = 1; // mode AMOUNT_SHIELDED
      buf.writeUInt16BE(100, 3 + 33); // range proof length = 100
      expect(() => ShieldedOutputsHeader.deserialize(buf, network)).toThrow(
        /incomplete range proof/
      );
    });

    it('should throw on unknown mode byte', () => {
      // header_id + num=1 + mode=0x99 + enough bytes for commitment
      const buf = Buffer.alloc(3 + 33 + 2 + 5 + 2 + 5 + 1 + 33);
      buf[0] = headerId;
      buf[1] = 1;
      buf[2] = 0x99; // unknown mode
      expect(() => ShieldedOutputsHeader.deserialize(buf, network)).toThrow(
        /Unsupported shielded output mode: 153/
      );
    });

    it('should throw on truncated ephemeral pubkey', () => {
      // Build a valid AmountShielded up to the ephemeral pubkey, then truncate
      const header = new ShieldedOutputsHeader([makeAmountShieldedOutput()]);
      const parts: Buffer[] = [];
      header.serialize(parts);
      const full = Buffer.concat(parts);
      // Trim the last 10 bytes (ephemeral pubkey is 33 bytes at the end)
      const truncated = full.subarray(0, full.length - 10);
      expect(() => ShieldedOutputsHeader.deserialize(truncated, network)).toThrow(
        /missing ephemeral pubkey/
      );
    });
  });
});
