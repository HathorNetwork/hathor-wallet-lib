/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getVertexHeaderIdBuffer, getVertexHeaderIdFromBuffer, VertexHeaderId } from './types';
import Header from './base';
import Network from '../models/network';

const EXCESS_BLINDING_FACTOR_SIZE = 32;

/**
 * UnshieldBalanceHeader carries the excess blinding factor that closes the
 * homomorphic Pedersen balance equation for a full-unshield transaction
 * (shielded inputs → transparent outputs only, no shielded outputs).
 *
 * Wire format (matching hathor-core's UnshieldBalanceHeader, id 0x13):
 *
 *   [header_id: 1 byte (0x13)]
 *   [excess_blinding_factor: 32 bytes]
 *
 * The scalar is `sum(r_in) − sum(r_out)`. On the verifier side the fullnode
 * reconstructs `0·H + excess·G` on the output side so the equation
 * `sum(C_in) = sum(C_out) + excess·G` can hold.
 *
 * Invariants (enforced by hathor-core on both the FFI boundary and the tx-
 * header layer; the wallet must respect them to avoid rejection):
 *   1. Mutually exclusive with ShieldedOutputsHeader — a tx MUST carry either
 *      shielded outputs OR an excess, never both.
 *   2. Required when the tx has shielded inputs and no shielded outputs.
 *   3. Requires at least one shielded input (otherwise the scalar is
 *      meaningless).
 *
 * The full serialization is included in the sighash (see `get_sighash_bytes`
 * on the hathor-core side), so any mutation of the scalar invalidates
 * signatures over the tx.
 */
class UnshieldBalanceHeader extends Header {
  excessBlindingFactor: Buffer;

  constructor(excessBlindingFactor: Buffer) {
    super();
    if (excessBlindingFactor.length !== EXCESS_BLINDING_FACTOR_SIZE) {
      throw new Error(
        `excess_blinding_factor must be ${EXCESS_BLINDING_FACTOR_SIZE} bytes, ` +
          `got ${excessBlindingFactor.length}`
      );
    }
    this.excessBlindingFactor = excessBlindingFactor;
  }

  private serializeAll(array: Buffer[]) {
    array.push(getVertexHeaderIdBuffer(VertexHeaderId.UNSHIELD_BALANCE_HEADER));
    array.push(this.excessBlindingFactor);
  }

  serializeFields(array: Buffer[]) {
    this.serializeAll(array);
  }

  serialize(array: Buffer[]) {
    this.serializeAll(array);
  }

  serializeSighash(array: Buffer[]) {
    // Full serialization is bound to the signature (same as hathor-core's
    // get_sighash_bytes).
    this.serializeAll(array);
  }

  static deserialize(srcBuf: Buffer, _network: Network): [Header, Buffer] {
    let buf = Buffer.from(srcBuf);

    if (getVertexHeaderIdFromBuffer(buf) !== VertexHeaderId.UNSHIELD_BALANCE_HEADER) {
      throw new Error('Invalid vertex header id for unshield balance header.');
    }
    buf = buf.subarray(1);

    if (buf.length < EXCESS_BLINDING_FACTOR_SIZE) {
      throw new Error(
        `Truncated unshield balance header: need ${EXCESS_BLINDING_FACTOR_SIZE} bytes, ` +
          `got ${buf.length}`
      );
    }
    const excess = Buffer.from(buf.subarray(0, EXCESS_BLINDING_FACTOR_SIZE));
    buf = buf.subarray(EXCESS_BLINDING_FACTOR_SIZE);

    return [new UnshieldBalanceHeader(excess), buf];
  }
}

export default UnshieldBalanceHeader;
