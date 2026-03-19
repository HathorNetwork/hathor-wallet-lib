/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { intToBytes } from '../utils/buffer';
import { ShieldedOutputMode } from '../shielded/types';
import { OutputValueType } from '../types';

/**
 * Represents a shielded output in a transaction.
 *
 * Wire format (matching hathor-core):
 * [1 byte: mode]
 * [33 bytes: commitment]
 * [2 bytes: range_proof_length]
 * [variable: range_proof]
 * [1 byte: token_data]
 * [2 bytes: script_length]
 * [variable: script]
 * [33 bytes: ephemeral_pubkey]
 * // If FullShielded:
 * [33 bytes: asset_commitment]
 */
class ShieldedOutput {
  mode: ShieldedOutputMode;

  commitment: Buffer;

  rangeProof: Buffer;

  tokenData: number;

  script: Buffer;

  ephemeralPubkey: Buffer;

  assetCommitment: Buffer | null;

  /** The plaintext value, used for weight calculation. Not serialized on-chain. */
  value: OutputValueType;

  constructor(
    mode: ShieldedOutputMode,
    commitment: Buffer,
    rangeProof: Buffer,
    tokenData: number,
    script: Buffer,
    ephemeralPubkey: Buffer,
    assetCommitment: Buffer | null = null,
    value: OutputValueType = 0n,
  ) {
    this.mode = mode;
    this.commitment = commitment;
    this.rangeProof = rangeProof;
    this.tokenData = tokenData;
    this.script = script;
    this.ephemeralPubkey = ephemeralPubkey;
    this.assetCommitment = assetCommitment;
    this.value = value;
  }

  /**
   * Serialize a shielded output to bytes.
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

    // Token data (1 byte)
    arr.push(intToBytes(this.tokenData, 1));

    // Script (2 bytes length + variable)
    arr.push(intToBytes(this.script.length, 2));
    arr.push(this.script);

    // Ephemeral pubkey (33 bytes)
    arr.push(this.ephemeralPubkey);

    // Asset commitment (33 bytes, FullShielded only)
    if (this.mode === ShieldedOutputMode.FULLY_SHIELDED && this.assetCommitment) {
      arr.push(this.assetCommitment);
    }

    return arr;
  }
}

export default ShieldedOutput;
