/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The hathor-core has a similar enum that maps to bytes.
 * In typescript this is not easy to manipulate so I decided
 * to have the same enum but with hex values instead.
 */
export const enum VertexHeaderId {
  NANO_HEADER = '10',
  FEE_HEADER = '11',
  SHIELDED_OUTPUTS_HEADER = '12',
  UNSHIELD_BALANCE_HEADER = '13',
  MINT_HEADER = '14',
  MELT_HEADER = '15',
}

export function getVertexHeaderIdBuffer(id: VertexHeaderId): Buffer {
  return Buffer.from(id, 'hex');
}

export function getVertexHeaderIdFromBuffer(buf: Buffer): VertexHeaderId {
  const vertexId = buf.readUInt8().toString(16);
  switch (vertexId) {
    case VertexHeaderId.NANO_HEADER:
      return VertexHeaderId.NANO_HEADER;
    case VertexHeaderId.FEE_HEADER:
      return VertexHeaderId.FEE_HEADER;
    case VertexHeaderId.SHIELDED_OUTPUTS_HEADER:
      return VertexHeaderId.SHIELDED_OUTPUTS_HEADER;
    case VertexHeaderId.UNSHIELD_BALANCE_HEADER:
      return VertexHeaderId.UNSHIELD_BALANCE_HEADER;
    case VertexHeaderId.MINT_HEADER:
      return VertexHeaderId.MINT_HEADER;
    case VertexHeaderId.MELT_HEADER:
      return VertexHeaderId.MELT_HEADER;
    default:
      throw new Error('Invalid VertexHeaderId');
  }
}
