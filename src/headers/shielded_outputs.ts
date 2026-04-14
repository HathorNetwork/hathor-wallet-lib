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
    [numOutputs, buf] = unpackToInt(1, false, buf);

    const outputs: ShieldedOutput[] = [];
    for (let i = 0; i < numOutputs; i++) {
      // Mode (1 byte)
      let mode: number;
      [mode, buf] = unpackToInt(1, false, buf);

      // Commitment (33 bytes)
      const commitment = Buffer.from(buf.subarray(0, 33));
      buf = buf.subarray(33);

      // Range proof (2 bytes length + variable)
      let rpLen: number;
      [rpLen, buf] = unpackToInt(2, false, buf);
      const rangeProof = Buffer.from(buf.subarray(0, rpLen));
      buf = buf.subarray(rpLen);

      // Script (2 bytes length + variable)
      let scriptLen: number;
      [scriptLen, buf] = unpackToInt(2, false, buf);
      const script = Buffer.from(buf.subarray(0, scriptLen));
      buf = buf.subarray(scriptLen);

      let tokenData = 0;
      let assetCommitment: Buffer | undefined;
      let surjectionProof: Buffer | undefined;

      if (mode === ShieldedOutputMode.AMOUNT_SHIELDED) {
        // Token data (1 byte)
        [tokenData, buf] = unpackToInt(1, false, buf);
      } else if (mode === ShieldedOutputMode.FULLY_SHIELDED) {
        // Asset commitment (33 bytes)
        assetCommitment = Buffer.from(buf.subarray(0, 33));
        buf = buf.subarray(33);

        // Surjection proof (2 bytes length + variable)
        let spLen: number;
        [spLen, buf] = unpackToInt(2, false, buf);
        surjectionProof = Buffer.from(buf.subarray(0, spLen));
        buf = buf.subarray(spLen);
      }

      // Ephemeral pubkey (33 bytes)
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
          assetCommitment,
          0n, // value is not stored on-chain; it's recovered via rewind
          surjectionProof
        )
      );
    }

    const header = new ShieldedOutputsHeader(outputs);
    return [header, buf];
  }
}

export default ShieldedOutputsHeader;
