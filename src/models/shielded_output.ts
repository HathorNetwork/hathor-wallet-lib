/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { intToBytes, unpackToInt } from '../utils/buffer';
import { ShieldedOutputMode } from '../shielded/types';
import { OutputValueType } from '../types';
import {
  MAX_RANGE_PROOF_SIZE,
  MAX_SURJECTION_PROOF_SIZE,
  MAX_SHIELDED_OUTPUT_SCRIPT_SIZE,
} from '../constants';

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

  /**
   * The wallet's locally-known plaintext value of this output. Not serialized
   * on-chain (the value is hidden in the Pedersen commitment). MUST NOT be fed
   * into tx-weight calculation — see `Transaction.getOutputsSum` — or it leaks
   * the hidden amount through the public weight. `0n` for wire-format outputs
   * whose value is not yet known (before rewind).
   */
  value: OutputValueType;

  /**
   * @param value Plaintext value, for the wallet's local bookkeeping only.
   *   Required so callers can't silently get a 0n placeholder where a real
   *   value is known. It is NOT serialized on-chain and MUST NOT influence
   *   tx weight. For wire-format outputs whose value is hidden until rewind,
   *   pass `0n` explicitly — see `ShieldedOutputsHeader.deserialize`.
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
   * Parse a single shielded output from the wire (inverse of `serialize`).
   *
   * Co-located with `serialize` so the wire layout has a single source of
   * truth (mirrors hathor-core, where `serialize_shielded_output` and
   * `deserialize_shielded_output` both live in the output module and the
   * header just loops over them). Returns the parsed output plus the
   * remaining buffer so callers (e.g. `ShieldedOutputsHeader.deserialize`)
   * can chain across a list.
   *
   * The on-chain form carries no plaintext value — it's recovered later via
   * rewind — so the model is built with `value = 0n`.
   */
  static deserialize(srcBuf: Buffer): [ShieldedOutput, Buffer] {
    let buf = Buffer.from(srcBuf);

    // Mode (1 byte)
    if (buf.length < 1) throw new Error('Truncated shielded output: missing mode byte');
    let mode: number;
    // eslint-disable-next-line prefer-const
    [mode, buf] = unpackToInt(1, false, buf);

    // Commitment (33 bytes)
    if (buf.length < 33) throw new Error('Truncated shielded output: missing commitment');
    const commitment = Buffer.from(buf.subarray(0, 33));
    buf = buf.subarray(33);

    // Range proof (2 bytes length + variable)
    if (buf.length < 2) throw new Error('Truncated shielded output: missing range proof length');
    let rpLen: number;
    // eslint-disable-next-line prefer-const
    [rpLen, buf] = unpackToInt(2, false, buf);
    // hathor-core validation: range proof size cannot exceed MAX_RANGE_PROOF_SIZE.
    if (rpLen > MAX_RANGE_PROOF_SIZE)
      throw new Error(`range proof size ${rpLen} exceeds maximum ${MAX_RANGE_PROOF_SIZE}`);
    if (buf.length < rpLen) throw new Error('Truncated shielded output: incomplete range proof');
    const rangeProof = Buffer.from(buf.subarray(0, rpLen));
    buf = buf.subarray(rpLen);

    // Script (2 bytes length + variable)
    if (buf.length < 2) throw new Error('Truncated shielded output: missing script length');
    let scriptLen: number;
    // eslint-disable-next-line prefer-const
    [scriptLen, buf] = unpackToInt(2, false, buf);
    // hathor-core validation: shielded output script size cannot exceed MAX_SHIELDED_OUTPUT_SCRIPT_SIZE.
    if (scriptLen > MAX_SHIELDED_OUTPUT_SCRIPT_SIZE)
      throw new Error(
        `script size ${scriptLen} exceeds maximum ${MAX_SHIELDED_OUTPUT_SCRIPT_SIZE}`
      );
    if (buf.length < scriptLen) throw new Error('Truncated shielded output: incomplete script');
    const script = Buffer.from(buf.subarray(0, scriptLen));
    buf = buf.subarray(scriptLen);

    // FullShielded has no token_data slot on the wire — leave it undefined
    // (the field is meaningless for that mode) rather than synthesizing a 0.
    let tokenData: number | undefined;
    let assetCommitment: Buffer | undefined;
    let surjectionProof: Buffer | undefined;

    if (mode === ShieldedOutputMode.AMOUNT_SHIELDED) {
      // Token data (1 byte)
      if (buf.length < 1) throw new Error('Truncated AmountShielded output: missing token_data');
      [tokenData, buf] = unpackToInt(1, false, buf);
    } else if (mode === ShieldedOutputMode.FULLY_SHIELDED) {
      // Asset commitment (33 bytes)
      if (buf.length < 33)
        throw new Error('Truncated FullShielded output: missing asset commitment');
      assetCommitment = Buffer.from(buf.subarray(0, 33));
      buf = buf.subarray(33);

      // Surjection proof (2 bytes length + variable)
      if (buf.length < 2)
        throw new Error('Truncated FullShielded output: missing surjection proof length');
      let spLen: number;
      [spLen, buf] = unpackToInt(2, false, buf);
      // hathor-core validation: surjection proof size cannot exceed MAX_SURJECTION_PROOF_SIZE.
      if (spLen > MAX_SURJECTION_PROOF_SIZE)
        throw new Error(
          `surjection proof size ${spLen} exceeds maximum ${MAX_SURJECTION_PROOF_SIZE}`
        );
      if (buf.length < spLen)
        throw new Error('Truncated FullShielded output: incomplete surjection proof');
      surjectionProof = Buffer.from(buf.subarray(0, spLen));
      buf = buf.subarray(spLen);
    } else {
      throw new Error(`Unsupported shielded output mode: ${mode}`);
    }

    // Ephemeral pubkey (33 bytes)
    if (buf.length < 33) throw new Error('Truncated shielded output: missing ephemeral pubkey');
    const ephemeralPubkey = Buffer.from(buf.subarray(0, 33));
    buf = buf.subarray(33);

    const output = new ShieldedOutput(
      mode,
      commitment,
      rangeProof,
      tokenData,
      script,
      ephemeralPubkey,
      0n, // value is not stored on-chain; it's recovered via rewind
      { assetCommitment, surjectionProof }
    );
    return [output, buf];
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
