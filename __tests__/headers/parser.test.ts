/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HeaderParser from '../../src/headers/parser';
import { VertexHeaderId, getVertexHeaderIdFromBuffer } from '../../src/headers/types';
import NanoContractHeader from '../../src/nano_contracts/header';
import FeeHeader from '../../src/headers/fee';
import ShieldedOutputsHeader from '../../src/headers/shielded_outputs';
import UnshieldBalanceHeader from '../../src/headers/unshield_balance';
import { MintHeader } from '../../src/headers/mint_header';
import { MeltHeader } from '../../src/headers/melt_header';

describe('HeaderParser', () => {
  it('exposes every known VertexHeaderId in getSupportedHeaders', () => {
    const headers = HeaderParser.getSupportedHeaders();
    expect(headers[VertexHeaderId.NANO_HEADER]).toBe(NanoContractHeader);
    expect(headers[VertexHeaderId.FEE_HEADER]).toBe(FeeHeader);
    expect(headers[VertexHeaderId.SHIELDED_OUTPUTS_HEADER]).toBe(ShieldedOutputsHeader);
    expect(headers[VertexHeaderId.UNSHIELD_BALANCE_HEADER]).toBe(UnshieldBalanceHeader);
    expect(headers[VertexHeaderId.MINT_HEADER]).toBe(MintHeader);
    expect(headers[VertexHeaderId.MELT_HEADER]).toBe(MeltHeader);
  });

  it('getHeader returns the right class for each id', () => {
    expect(HeaderParser.getHeader(VertexHeaderId.NANO_HEADER)).toBe(NanoContractHeader);
    expect(HeaderParser.getHeader(VertexHeaderId.FEE_HEADER)).toBe(FeeHeader);
    expect(HeaderParser.getHeader(VertexHeaderId.SHIELDED_OUTPUTS_HEADER)).toBe(
      ShieldedOutputsHeader
    );
    expect(HeaderParser.getHeader(VertexHeaderId.UNSHIELD_BALANCE_HEADER)).toBe(
      UnshieldBalanceHeader
    );
    expect(HeaderParser.getHeader(VertexHeaderId.MINT_HEADER)).toBe(MintHeader);
    expect(HeaderParser.getHeader(VertexHeaderId.MELT_HEADER)).toBe(MeltHeader);
  });

  it('getHeader throws for an unknown id', () => {
    expect(() => HeaderParser.getHeader('ff')).toThrow(/Header id not supported: ff/);
  });
});

describe('getVertexHeaderIdFromBuffer', () => {
  it('recognizes each known id by its first byte', () => {
    expect(getVertexHeaderIdFromBuffer(Buffer.from([0x10]))).toBe(VertexHeaderId.NANO_HEADER);
    expect(getVertexHeaderIdFromBuffer(Buffer.from([0x11]))).toBe(VertexHeaderId.FEE_HEADER);
    expect(getVertexHeaderIdFromBuffer(Buffer.from([0x12]))).toBe(
      VertexHeaderId.SHIELDED_OUTPUTS_HEADER
    );
    expect(getVertexHeaderIdFromBuffer(Buffer.from([0x13]))).toBe(
      VertexHeaderId.UNSHIELD_BALANCE_HEADER
    );
    expect(getVertexHeaderIdFromBuffer(Buffer.from([0x14]))).toBe(VertexHeaderId.MINT_HEADER);
    expect(getVertexHeaderIdFromBuffer(Buffer.from([0x15]))).toBe(VertexHeaderId.MELT_HEADER);
  });

  it('throws on an unknown first byte', () => {
    expect(() => getVertexHeaderIdFromBuffer(Buffer.from([0xff]))).toThrow(
      /Invalid VertexHeaderId/
    );
  });

  it('throws an out-of-range Buffer error on an empty buffer (not the domain error)', () => {
    // `buf.readUInt8()` walks off the end of the buffer before any
    // domain check runs, so the error here is the Buffer module's
    // "outside buffer bounds" error rather than "Invalid VertexHeaderId".
    // Worth pinning so a future swap in the implementation doesn't
    // silently change the failure mode at the header-decoding boundary.
    expect(() => getVertexHeaderIdFromBuffer(Buffer.alloc(0))).toThrow(
      /outside buffer bounds|out of range/i
    );
  });
});
