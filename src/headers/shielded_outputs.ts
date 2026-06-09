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
import { intToBytes, unpackToInt } from '../utils/buffer';
import { MAX_SHIELDED_OUTPUTS } from '../constants';

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

  /**
   * Validate the output count (1..MAX_SHIELDED_OUTPUTS). Following the
   * FeeHeader convention this is NOT run from the constructor — `serialize`
   * calls it so an out-of-range header never reaches the wire. `deserialize`
   * checks the count separately since it guards untrusted wire bytes.
   */
  validate(): void {
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
  }

  private serializeWith(array: Buffer[], outputSerializer: (output: ShieldedOutput) => Buffer[]) {
    this.validate();
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
      // Each output's wire format (and its hathor-core size validations)
      // lives on the model, next to `serialize`.
      let output: ShieldedOutput;
      [output, buf] = ShieldedOutput.deserialize(buf);
      outputs.push(output);
    }

    const header = new ShieldedOutputsHeader(outputs);
    return [header, buf];
  }
}

export default ShieldedOutputsHeader;
