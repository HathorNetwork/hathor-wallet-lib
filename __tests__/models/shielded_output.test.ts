/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ShieldedOutput from '../../src/models/shielded_output';
import { ShieldedOutputMode } from '../../src/shielded/types';

function makeOutput(
  overrides: Partial<{
    mode: ShieldedOutputMode;
    commitment: Buffer;
    rangeProof: Buffer;
    tokenData: number;
    script: Buffer;
    ephemeralPubkey: Buffer;
    assetCommitment: Buffer;
    surjectionProof: Buffer;
    value: bigint;
  }> = {}
): ShieldedOutput {
  return new ShieldedOutput(
    overrides.mode ?? ShieldedOutputMode.AMOUNT_SHIELDED,
    overrides.commitment ?? Buffer.alloc(33, 0xaa),
    overrides.rangeProof ?? Buffer.alloc(10, 0xbb),
    overrides.tokenData ?? 0,
    overrides.script ?? Buffer.from([0x76, 0xa9, 0x14]),
    overrides.ephemeralPubkey ?? Buffer.alloc(33, 0xcc),
    overrides.assetCommitment,
    overrides.surjectionProof,
    overrides.value ?? 100n
  );
}

describe('ShieldedOutput', () => {
  describe('constructor', () => {
    it('should set all fields', () => {
      const out = makeOutput({ tokenData: 1, value: 50n });
      expect(out.mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      expect(out.tokenData).toBe(1);
      expect(out.value).toBe(50n);
      expect(out.assetCommitment).toBeUndefined();
      expect(out.surjectionProof).toBeUndefined();
    });

    it('should accept optional assetCommitment and surjectionProof', () => {
      const ac = Buffer.alloc(33, 0xdd);
      const sp = Buffer.alloc(5, 0xee);
      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
        assetCommitment: ac,
        surjectionProof: sp,
      });
      expect(out.assetCommitment).toBe(ac);
      expect(out.surjectionProof).toBe(sp);
    });
  });

  describe('serialize (AmountShielded)', () => {
    it('should produce correct wire format', () => {
      const commitment = Buffer.alloc(33, 0x01);
      const rangeProof = Buffer.from([0x02, 0x03, 0x04]);
      const script = Buffer.from([0x76, 0xa9]);
      const ephemeralPubkey = Buffer.alloc(33, 0x05);

      const out = makeOutput({
        mode: ShieldedOutputMode.AMOUNT_SHIELDED,
        commitment,
        rangeProof,
        tokenData: 0,
        script,
        ephemeralPubkey,
      });

      const parts = out.serialize();
      const serialized = Buffer.concat(parts);

      let offset = 0;
      // mode (1)
      expect(serialized[offset]).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      offset += 1;
      // commitment (33)
      expect(serialized.subarray(offset, offset + 33)).toEqual(commitment);
      offset += 33;
      // range_proof length (2) + data
      expect(serialized.readUInt16BE(offset)).toBe(3);
      offset += 2;
      expect(serialized.subarray(offset, offset + 3)).toEqual(rangeProof);
      offset += 3;
      // script length (2) + data
      expect(serialized.readUInt16BE(offset)).toBe(2);
      offset += 2;
      expect(serialized.subarray(offset, offset + 2)).toEqual(script);
      offset += 2;
      // token_data (1, AmountShielded only)
      expect(serialized[offset]).toBe(0);
      offset += 1;
      // ephemeral_pubkey (33)
      expect(serialized.subarray(offset, offset + 33)).toEqual(ephemeralPubkey);
      offset += 33;

      expect(offset).toBe(serialized.length);
    });
  });

  describe('serialize (FullShielded)', () => {
    it('should include asset_commitment and surjection_proof', () => {
      const assetCommitment = Buffer.alloc(33, 0x07);
      const surjectionProof = Buffer.from([0x08, 0x09]);

      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
        assetCommitment,
        surjectionProof,
      });

      const parts = out.serialize();
      const serialized = Buffer.concat(parts);

      // Find the asset_commitment after script
      // mode(1) + commitment(33) + rp_len(2) + rp(10) + script_len(2) + script(3)
      const acOffset = 1 + 33 + 2 + 10 + 2 + 3;
      expect(serialized.subarray(acOffset, acOffset + 33)).toEqual(assetCommitment);
      // surjection_proof length (2) + data (2)
      expect(serialized.readUInt16BE(acOffset + 33)).toBe(2);
      expect(serialized.subarray(acOffset + 35, acOffset + 37)).toEqual(surjectionProof);
    });

    it('should throw when FullShielded fields are missing', () => {
      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
      });

      expect(() => out.serialize()).toThrow(
        'FullShielded output requires assetCommitment and surjectionProof'
      );
      expect(() => out.serializeSighash()).toThrow('FullShielded output requires assetCommitment');
    });
  });

  describe('serializeSighash', () => {
    it('should exclude proofs for AmountShielded', () => {
      const commitment = Buffer.alloc(33, 0x01);
      const script = Buffer.from([0x76, 0xa9]);
      const ephemeralPubkey = Buffer.alloc(33, 0x05);

      const out = makeOutput({
        mode: ShieldedOutputMode.AMOUNT_SHIELDED,
        commitment,
        tokenData: 2,
        script,
        ephemeralPubkey,
      });

      const parts = out.serializeSighash();
      const serialized = Buffer.concat(parts);

      let offset = 0;
      // mode (1)
      expect(serialized[offset]).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      offset += 1;
      // commitment (33)
      expect(serialized.subarray(offset, offset + 33)).toEqual(commitment);
      offset += 33;
      // token_data (1)
      expect(serialized[offset]).toBe(2);
      offset += 1;
      // script (raw, no length prefix)
      expect(serialized.subarray(offset, offset + 2)).toEqual(script);
      offset += 2;
      // ephemeral_pubkey (33)
      expect(serialized.subarray(offset, offset + 33)).toEqual(ephemeralPubkey);
      offset += 33;

      expect(offset).toBe(serialized.length);
    });

    it('should include asset_commitment for FullShielded', () => {
      const assetCommitment = Buffer.alloc(33, 0xdd);

      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
        assetCommitment,
      });

      const parts = out.serializeSighash();
      const serialized = Buffer.concat(parts);

      // mode(1) + commitment(33) + asset_commitment(33) + script(3) + ephemeral(33)
      expect(serialized.length).toBe(1 + 33 + 33 + 3 + 33);

      // asset_commitment is after mode + commitment
      const acOffset = 1 + 33;
      expect(serialized.subarray(acOffset, acOffset + 33)).toEqual(assetCommitment);
    });
  });
});
