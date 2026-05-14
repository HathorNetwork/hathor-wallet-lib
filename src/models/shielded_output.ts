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

  tokenData: number;

  script: Buffer;

  ephemeralPubkey: Buffer;

  assetCommitment?: Buffer;

  surjectionProof?: Buffer;

  /** The plaintext value, used for weight calculation. Not serialized on-chain. */
  value: OutputValueType;

  // eslint-disable-next-line default-param-last
  constructor(
    mode: ShieldedOutputMode,
    commitment: Buffer,
    rangeProof: Buffer,
    tokenData: number,
    script: Buffer,
    ephemeralPubkey: Buffer,
    assetCommitment?: Buffer,
    surjectionProof?: Buffer,
    value: OutputValueType = 0n
  ) {
    this.mode = mode;
    this.commitment = commitment;
    this.rangeProof = rangeProof;
    this.tokenData = tokenData;
    this.script = script;
    this.ephemeralPubkey = ephemeralPubkey;
    this.assetCommitment = assetCommitment;
    this.value = value;
    this.surjectionProof = surjectionProof;
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

    if (this.mode === ShieldedOutputMode.AMOUNT_SHIELDED) {
      // Token data (1 byte, AmountShielded only)
      arr.push(intToBytes(this.tokenData, 1));
    } else if (this.mode === ShieldedOutputMode.FULLY_SHIELDED) {
      if (!this.assetCommitment || !this.surjectionProof) {
        throw new Error('FullShielded output requires assetCommitment and surjectionProof');
      }
      // Asset commitment (33 bytes, FullShielded only)
      arr.push(this.assetCommitment);
      // Surjection proof (2 bytes length + variable, FullShielded only)
      arr.push(intToBytes(this.surjectionProof.length, 2));
      arr.push(this.surjectionProof);
    } else {
      throw new Error(`Unsupported shielded output mode: ${this.mode}`);
    }

    // Ephemeral pubkey (always 33 bytes)
    if (!this.ephemeralPubkey || this.ephemeralPubkey.length !== EPHEMERAL_PUBKEY_SIZE) {
      throw new Error(
        `Invalid ephemeral pubkey: expected ${EPHEMERAL_PUBKEY_SIZE} bytes, ` +
          `got ${this.ephemeralPubkey?.length ?? 0}`
      );
    }
    arr.push(this.ephemeralPubkey);

    return arr;
  }

  /**
   * Serialize for sighash (excludes proofs).
   */
  serializeSighash(): Buffer[] {
    const arr: Buffer[] = [];

    arr.push(intToBytes(this.mode, 1));
    arr.push(this.commitment);

    if (this.mode === ShieldedOutputMode.AMOUNT_SHIELDED) {
      arr.push(intToBytes(this.tokenData, 1));
    } else if (this.mode === ShieldedOutputMode.FULLY_SHIELDED) {
      if (!this.assetCommitment) {
        throw new Error('FullShielded output requires assetCommitment');
      }
      arr.push(this.assetCommitment);
    } else {
      throw new Error(`Unsupported shielded output mode: ${this.mode}`);
    }

    arr.push(this.script);

    // Always include ephemeral pubkey in sighash
    if (!this.ephemeralPubkey || this.ephemeralPubkey.length !== EPHEMERAL_PUBKEY_SIZE) {
      throw new Error(
        `Invalid ephemeral pubkey: expected ${EPHEMERAL_PUBKEY_SIZE} bytes, ` +
          `got ${this.ephemeralPubkey?.length ?? 0}`
      );
    }
    arr.push(this.ephemeralPubkey);

    return arr;
  }
}

export default ShieldedOutput;
