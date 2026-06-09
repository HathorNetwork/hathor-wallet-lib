/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ShieldedOutput from '../../src/models/shielded_output';
import { ShieldedOutputMode } from '../../src/shielded/types';
import { MAX_RANGE_PROOF_SIZE } from '../../src/constants';

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
    overrides.value ?? 100n,
    { assetCommitment: overrides.assetCommitment, surjectionProof: overrides.surjectionProof }
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

    it('should throw when FullShielded asset_commitment is missing', () => {
      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
      });

      expect(() => out.serialize()).toThrow('FullShielded output requires assetCommitment');
      expect(() => out.serializeSighash()).toThrow('FullShielded output requires assetCommitment');
    });

    it('should throw when FullShielded surjection_proof is missing on serialize but not on sighash', () => {
      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
        assetCommitment: Buffer.alloc(33, 0xdd),
      });

      // serialize requires the proof — sighash deliberately omits it.
      expect(() => out.serialize()).toThrow('FullShielded output requires surjectionProof');
      expect(() => out.serializeSighash()).not.toThrow();
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

    it('should throw when ephemeral pubkey is missing', () => {
      const out = makeOutput({ ephemeralPubkey: Buffer.alloc(0) });
      expect(() => out.serializeSighash()).toThrow(/Invalid ephemeral pubkey/);
    });

    it('should throw when ephemeral pubkey has wrong size', () => {
      const out = makeOutput({ ephemeralPubkey: Buffer.alloc(32) });
      expect(() => out.serializeSighash()).toThrow(/expected 33 bytes/);
    });
  });

  describe('AmountShielded tokenData', () => {
    it('serialize should throw when tokenData is undefined', () => {
      const out = new ShieldedOutput(
        ShieldedOutputMode.AMOUNT_SHIELDED,
        Buffer.alloc(33, 0xaa),
        Buffer.alloc(10, 0xbb),
        undefined,
        Buffer.from([0x76, 0xa9, 0x14]),
        Buffer.alloc(33, 0xcc),
        100n
      );
      expect(() => out.serialize()).toThrow('AmountShielded output requires tokenData');
      expect(() => out.serializeSighash()).toThrow('AmountShielded output requires tokenData');
    });

    it('FullShielded does not require tokenData', () => {
      // Mirrors how PR 2+ deserializers build FullShielded outputs without
      // ever populating tokenData — the wire format has no slot for it in
      // FullShielded mode, so requiring callers to pass a placeholder would
      // be misleading.
      const out = new ShieldedOutput(
        ShieldedOutputMode.FULLY_SHIELDED,
        Buffer.alloc(33, 0xaa),
        Buffer.alloc(10, 0xbb),
        undefined,
        Buffer.from([0x76, 0xa9, 0x14]),
        Buffer.alloc(33, 0xcc),
        100n,
        { assetCommitment: Buffer.alloc(33, 0xdd), surjectionProof: Buffer.from([0xee]) }
      );
      expect(() => out.serialize()).not.toThrow();
      expect(() => out.serializeSighash()).not.toThrow();
    });
  });

  describe('defensive throws', () => {
    // The enum-typed `mode` parameter excludes invalid values at compile
    // time, but runtime data (JSON ingest, `as` casts) can bypass that.
    // We exercise the runtime guards with an explicit unsafe cast.
    const INVALID_MODE = 99 as unknown as ShieldedOutputMode;

    it('serialize throws on unsupported mode', () => {
      const out = makeOutput({ mode: INVALID_MODE });
      expect(() => out.serialize()).toThrow(/Unsupported shielded output mode: 99/);
    });

    it('serializeSighash throws on unsupported mode', () => {
      const out = makeOutput({ mode: INVALID_MODE });
      expect(() => out.serializeSighash()).toThrow(/Unsupported shielded output mode: 99/);
    });

    it('serialize throws when ephemeral pubkey is missing', () => {
      const out = makeOutput({ ephemeralPubkey: Buffer.alloc(0) });
      expect(() => out.serialize()).toThrow(/Invalid ephemeral pubkey/);
    });

    it('serialize throws when ephemeral pubkey has wrong size', () => {
      const out = makeOutput({ ephemeralPubkey: Buffer.alloc(32) });
      expect(() => out.serialize()).toThrow(/expected 33 bytes/);
    });
  });

  describe('deserialize', () => {
    it('round-trips an AmountShielded output (value reset to 0n)', () => {
      const out = makeOutput({ tokenData: 3, value: 777n });
      const wire = Buffer.concat(out.serialize());

      const [parsed, leftover] = ShieldedOutput.deserialize(wire);
      expect(leftover.length).toBe(0);
      expect(parsed.mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      expect(parsed.commitment).toEqual(out.commitment);
      expect(parsed.rangeProof).toEqual(out.rangeProof);
      expect(parsed.tokenData).toBe(3);
      expect(parsed.script).toEqual(out.script);
      expect(parsed.ephemeralPubkey).toEqual(out.ephemeralPubkey);
      // value is not on-chain; deserialize always rebuilds it as 0n
      expect(parsed.value).toBe(0n);
    });

    it('round-trips a FullShielded output preserving asset commitment + surjection proof', () => {
      const out = makeOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
        assetCommitment: Buffer.alloc(33, 0xdd),
        surjectionProof: Buffer.alloc(7, 0xee),
      });
      const wire = Buffer.concat(out.serialize());

      const [parsed, leftover] = ShieldedOutput.deserialize(wire);
      expect(leftover.length).toBe(0);
      expect(parsed.mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(parsed.assetCommitment).toEqual(out.assetCommitment);
      expect(parsed.surjectionProof).toEqual(out.surjectionProof);
      // FullShielded has no token_data on the wire — it must stay undefined,
      // not a synthesized 0 (which would invent a token index).
      expect(parsed.tokenData).toBeUndefined();
    });

    it('returns the remaining buffer so callers can chain across a list', () => {
      const a = makeOutput({ tokenData: 1 });
      const b = makeOutput({ tokenData: 2 });
      const wire = Buffer.concat([...a.serialize(), ...b.serialize()]);

      const [first, rest] = ShieldedOutput.deserialize(wire);
      expect(first.tokenData).toBe(1);
      const [second, leftover] = ShieldedOutput.deserialize(rest);
      expect(second.tokenData).toBe(2);
      expect(leftover.length).toBe(0);
    });

    it('throws on an unsupported mode byte', () => {
      const buf = Buffer.alloc(1 + 33 + 2 + 5 + 2 + 5 + 1 + 33);
      buf[0] = 0x99; // unknown mode
      expect(() => ShieldedOutput.deserialize(buf)).toThrow(
        /Unsupported shielded output mode: 153/
      );
    });

    it('enforces the hathor-core range proof size cap', () => {
      // mode(1) + commitment(33) + rp_len(2) declaring > MAX_RANGE_PROOF_SIZE
      const buf = Buffer.alloc(1 + 33 + 2);
      buf[0] = ShieldedOutputMode.AMOUNT_SHIELDED;
      buf.writeUInt16BE(MAX_RANGE_PROOF_SIZE + 1, 1 + 33);
      expect(() => ShieldedOutput.deserialize(buf)).toThrow(/range proof size .* exceeds maximum/);
    });

    describe('FullShielded truncation', () => {
      // FullShielded wire layout for these fixed sizes:
      //   mode(1) | commitment(33) | rp_len(2) | range_proof(4) |
      //   script_len(2) | script(2) | asset_commitment(33) | sp_len(2) |
      //   surjection_proof(3) | ephemeral_pubkey(33)
      function fullWire(): Buffer {
        const out = makeOutput({
          mode: ShieldedOutputMode.FULLY_SHIELDED,
          rangeProof: Buffer.alloc(4, 0xbb),
          script: Buffer.alloc(2, 0x76),
          assetCommitment: Buffer.alloc(33, 0xdd),
          surjectionProof: Buffer.alloc(3, 0xee),
        });
        return Buffer.concat(out.serialize());
      }
      const AFTER_SCRIPT = 1 + 33 + 2 + 4 + 2 + 2; // asset_commitment starts here
      const AFTER_ASSET_COMMITMENT = AFTER_SCRIPT + 33; // sp_len starts here
      const AFTER_SP_LEN = AFTER_ASSET_COMMITMENT + 2; // surjection_proof starts here

      it('throws on missing asset commitment', () => {
        const buf = fullWire().subarray(0, AFTER_SCRIPT + 10); // < 33 bytes left
        expect(() => ShieldedOutput.deserialize(buf)).toThrow(
          /Truncated FullShielded output: missing asset commitment/
        );
      });

      it('throws on missing surjection proof length', () => {
        const buf = fullWire().subarray(0, AFTER_ASSET_COMMITMENT + 1); // < 2 bytes left
        expect(() => ShieldedOutput.deserialize(buf)).toThrow(
          /Truncated FullShielded output: missing surjection proof length/
        );
      });

      it('throws on incomplete surjection proof', () => {
        const buf = fullWire().subarray(0, AFTER_SP_LEN + 1); // sp_len says 3, only 1 byte left
        expect(() => ShieldedOutput.deserialize(buf)).toThrow(
          /Truncated FullShielded output: incomplete surjection proof/
        );
      });
    });
  });
});
