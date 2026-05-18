/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { intToBytes } from '../utils/buffer';
import { ShieldedOutputMode } from '../shielded/types';
import { OutputValueType } from '../types';

const EPHEMERAL_PUBKEY_SIZE = 33;

/**
 * Represents a shielded output in a transaction.
 *
 * Wire format (matching hathor-core serialization order):
 *   mode(1) | commitment(33) | rp_len(2) | range_proof(var) |
 *   script_len(2) | script(var) |
 *   [if AMOUNT_SHIELDED]: token_data(1)
 *   [if FULLY_SHIELDED]:  asset_commitment(33) | sp_len(2) | surjection_proof(var)
 *   ephemeral_pubkey(33)
 */
class ShieldedOutput {
  mode: ShieldedOutputMode;

  commitment: Buffer;

  rangeProof: Buffer;

  /**
   * AmountShielded only — encodes the token index in `tx.tokens[]` (and the
   * authority bit, 0x80). FullShielded has no wire slot for `token_data`
   * because the token is hidden inside `asset_commitment`, so the field is
   * meaningless for that mode and intentionally optional. `serialize` /
   * `serializeSighash` throw if it's missing while `mode ===
   * AMOUNT_SHIELDED`.
   */
  tokenData?: number;

  script: Buffer;

  ephemeralPubkey: Buffer;

  assetCommitment?: Buffer;

  surjectionProof?: Buffer;

  /** The plaintext value, used for weight calculation. Not serialized on-chain. */
  value: OutputValueType;

  /**
   * @param value Plaintext value (required so callers can't silently get
   *   a 0n placeholder that would skew weight calculation). For wire-
   *   format outputs whose value is hidden until rewind, pass `0n`
   *   explicitly — see `ShieldedOutputsHeader.deserialize` in PR 3.
   * @param options.assetCommitment / options.surjectionProof — required
   *   for FullShielded mode; absent for AmountShielded mode. Enforced at
   *   serialize time, not construction time, so deserializers can build
   *   partial outputs (e.g. during streaming parse) before all fields
   *   are populated.
   */
  constructor(
    mode: ShieldedOutputMode,
    commitment: Buffer,
    rangeProof: Buffer,
    tokenData: number | undefined,
    script: Buffer,
    ephemeralPubkey: Buffer,
    value: OutputValueType,
    options: { assetCommitment?: Buffer; surjectionProof?: Buffer } = {}
  ) {
    this.mode = mode;
    this.commitment = commitment;
    this.rangeProof = rangeProof;
    this.tokenData = tokenData;
    this.script = script;
    this.ephemeralPubkey = ephemeralPubkey;
    this.value = value;
    this.assetCommitment = options.assetCommitment;
    this.surjectionProof = options.surjectionProof;
  }

  /**
   * Serialize a shielded output to bytes (wire format matching hathor-core).
   */
  serialize(): Buffer[] {
    const arr: Buffer[] = [];

    // Mode (1 byte)
    arr.push(intToBytes(this.mode, 1));

    // Commitment (33 bytes)
    arr.push(this.commitment);

    // Range proof (2 bytes length + variable)
    arr.push(intToBytes(this.rangeProof.length, 2));
    arr.push(this.rangeProof);

    // Script (2 bytes length + variable)
    arr.push(intToBytes(this.script.length, 2));
    arr.push(this.script);

    // Mode-specific block (with surjection proof for FullShielded)
    arr.push(...this.serializeModeSpecificFields({ includeProof: true }));

    // Ephemeral pubkey (always 33 bytes)
    arr.push(this.getValidatedEphemeralPubkey());

    return arr;
  }

  /**
   * Serialize for sighash (excludes proofs).
   *
   * Note the script appears AFTER the mode-specific block here, vs BEFORE it
   * in `serialize` — that ordering difference matches hathor-core's
   * `get_sighash_bytes` exactly and is not malleable.
   */
  serializeSighash(): Buffer[] {
    const arr: Buffer[] = [];

    arr.push(intToBytes(this.mode, 1));
    arr.push(this.commitment);

    // Mode-specific block (without surjection proof — sighash excludes proofs)
    arr.push(...this.serializeModeSpecificFields({ includeProof: false }));

    arr.push(this.script);

    // Always include ephemeral pubkey in sighash
    arr.push(this.getValidatedEphemeralPubkey());

    return arr;
  }

  /**
   * Emit the mode-specific portion of the wire format:
   *   - AmountShielded: `token_data` (1 byte)
   *   - FullShielded:   `asset_commitment` (33 bytes), plus
   *                     `sp_len` (2 bytes) + `surjection_proof` (var) when
   *                     `includeProof` is true.
   *
   * Centralizing this here keeps `serialize` and `serializeSighash` in
   * lockstep — the only difference between the two paths is whether the
   * surjection proof is appended, controlled by the `includeProof` flag.
   * Validation lives here too so the error messages match the gate
   * conditions one-to-one.
   */
  private serializeModeSpecificFields({ includeProof }: { includeProof: boolean }): Buffer[] {
    if (this.mode === ShieldedOutputMode.AMOUNT_SHIELDED) {
      if (this.tokenData === undefined) {
        throw new Error('AmountShielded output requires tokenData');
      }
      return [intToBytes(this.tokenData, 1)];
    }
    if (this.mode === ShieldedOutputMode.FULLY_SHIELDED) {
      if (!this.assetCommitment) {
        throw new Error('FullShielded output requires assetCommitment');
      }
      const fields: Buffer[] = [this.assetCommitment];
      if (includeProof) {
        if (!this.surjectionProof) {
          throw new Error('FullShielded output requires surjectionProof');
        }
        fields.push(intToBytes(this.surjectionProof.length, 2));
        fields.push(this.surjectionProof);
      }
      return fields;
    }
    throw new Error(`Unsupported shielded output mode: ${this.mode}`);
  }

  /**
   * Validate that the ephemeral pubkey is exactly `EPHEMERAL_PUBKEY_SIZE`
   * bytes and return it. Both `serialize` and `serializeSighash` need the
   * same length check before emitting the pubkey on the wire; centralizing
   * it here keeps the error message and the gate condition in lockstep.
   */
  private getValidatedEphemeralPubkey(): Buffer {
    if (!this.ephemeralPubkey || this.ephemeralPubkey.length !== EPHEMERAL_PUBKEY_SIZE) {
      throw new Error(
        `Invalid ephemeral pubkey: expected ${EPHEMERAL_PUBKEY_SIZE} bytes, ` +
          `got ${this.ephemeralPubkey?.length ?? 0}`
      );
    }
    return this.ephemeralPubkey;
  }
}

export default ShieldedOutput;
