/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getVertexHeaderIdBuffer, getVertexHeaderIdFromBuffer, VertexHeaderId } from './types';
import Header from './base';
import Network from '../models/network';
import ShieldedOutput from '../models/shielded_output';
import { ShieldedOutputMode } from '../shielded/types';
import { intToBytes, unpackToInt } from '../utils/buffer';
import {
  MAX_SHIELDED_OUTPUTS,
  MAX_RANGE_PROOF_SIZE,
  MAX_SURJECTION_PROOF_SIZE,
  MAX_SHIELDED_OUTPUT_SCRIPT_SIZE,
} from '../constants';

/**
 * ShieldedOutputsHeader contains shielded outputs for a transaction.
 *
 * Wire format (matching hathor-core):
 *   [header_id: 1 byte (0x12)]
 *   [num_outputs: 1 byte]
 *   [shielded_output_0...]
 *   [shielded_output_1...]
 *   ...
 */
class ShieldedOutputsHeader extends Header {
  shieldedOutputs: ShieldedOutput[];

  constructor(shieldedOutputs: ShieldedOutput[]) {
    super();
    this.shieldedOutputs = shieldedOutputs;
  }

  private serializeWith(array: Buffer[], outputSerializer: (output: ShieldedOutput) => Buffer[]) {
    // hathor-core validation: a shielded outputs header must carry at least 1 output.
    if (this.shieldedOutputs.length < 1) {
      throw new Error('shielded outputs header must contain at least 1 output');
    }
    // hathor-core validation: shielded outputs per header cannot exceed MAX_SHIELDED_OUTPUTS.
    if (this.shieldedOutputs.length > MAX_SHIELDED_OUTPUTS) {
      throw new Error(
        `too many shielded outputs: ${this.shieldedOutputs.length} exceeds maximum ${MAX_SHIELDED_OUTPUTS}`
      );
    }
    array.push(getVertexHeaderIdBuffer(VertexHeaderId.SHIELDED_OUTPUTS_HEADER));
    array.push(intToBytes(this.shieldedOutputs.length, 1));
    for (const output of this.shieldedOutputs) {
      array.push(...outputSerializer(output));
    }
  }

  serializeFields(array: Buffer[]) {
    this.serializeWith(array, o => o.serialize());
  }

  serialize(array: Buffer[]) {
    this.serializeFields(array);
  }

  serializeSighash(array: Buffer[]) {
    this.serializeWith(array, o => o.serializeSighash());
  }

  static deserialize(srcBuf: Buffer, _network: Network): [Header, Buffer] {
    let buf = Buffer.from(srcBuf);

    // Validate header ID
    if (getVertexHeaderIdFromBuffer(buf) !== VertexHeaderId.SHIELDED_OUTPUTS_HEADER) {
      throw new Error('Invalid vertex header id for shielded outputs header.');
    }
    buf = buf.subarray(1);

    // Number of shielded outputs (1 byte)
    let numOutputs: number;
    // eslint-disable-next-line prefer-const
    [numOutputs, buf] = unpackToInt(1, false, buf);

    // hathor-core validation: a shielded outputs header must carry at least 1 output.
    if (numOutputs < 1) {
      throw new Error('shielded outputs header must contain at least 1 output');
    }
    // hathor-core validation: shielded outputs per header cannot exceed MAX_SHIELDED_OUTPUTS.
    if (numOutputs > MAX_SHIELDED_OUTPUTS) {
      throw new Error(
        `too many shielded outputs: ${numOutputs} exceeds maximum ${MAX_SHIELDED_OUTPUTS}`
      );
    }

    const outputs: ShieldedOutput[] = [];
    for (let i = 0; i < numOutputs; i++) {
      // Mode (1 byte)
      if (buf.length < 1) throw new Error('Truncated shielded output: missing mode byte');
      let mode: number;
      [mode, buf] = unpackToInt(1, false, buf);

      // Commitment (33 bytes)
      if (buf.length < 33) throw new Error('Truncated shielded output: missing commitment');
      const commitment = Buffer.from(buf.subarray(0, 33));
      buf = buf.subarray(33);

      // Range proof (2 bytes length + variable)
      if (buf.length < 2) throw new Error('Truncated shielded output: missing range proof length');
      let rpLen: number;
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
      [scriptLen, buf] = unpackToInt(2, false, buf);
      // hathor-core validation: shielded output script size cannot exceed MAX_SHIELDED_OUTPUT_SCRIPT_SIZE.
      if (scriptLen > MAX_SHIELDED_OUTPUT_SCRIPT_SIZE)
        throw new Error(
          `script size ${scriptLen} exceeds maximum ${MAX_SHIELDED_OUTPUT_SCRIPT_SIZE}`
        );
      if (buf.length < scriptLen) throw new Error('Truncated shielded output: incomplete script');
      const script = Buffer.from(buf.subarray(0, scriptLen));
      buf = buf.subarray(scriptLen);

      let tokenData = 0;
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

      outputs.push(
        new ShieldedOutput(
          mode,
          commitment,
          rangeProof,
          tokenData,
          script,
          ephemeralPubkey,
          0n, // value is not stored on-chain; it's recovered via rewind
          { assetCommitment, surjectionProof }
        )
      );
    }

    const header = new ShieldedOutputsHeader(outputs);
    return [header, buf];
  }
}

export default ShieldedOutputsHeader;
