/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Shared building blocks for the Mint (0x14) and Melt (0x15) headers.
 * Both headers have the identical entry wire format and validation rules,
 * so the entry type, bounds, and (de)serialization helpers live here and
 * are consumed by `mint_header.ts` and `melt_header.ts`.
 *
 * Entry wire format (used by both headers):
 *   num_entries(1) | entries[token_index(1) | amount(8 BE)]
 *
 * Per-entry constraints: 1 ≤ token_index ≤ 16 (HTR forbidden); 1 ≤ amount
 * < 2^64; token_index unique within a header.
 */

import { OutputValueType } from '../types';

export const MAX_MINT_MELT_ENTRIES = 16;
export const ENTRY_SIZE = 1 + 8; // token_index(1) + amount(8 BE)

export interface IMintMeltEntry {
  /** Index into the tx's `tokens[]` (1-based; 0 = HTR is forbidden). */
  tokenIndex: number;
  /** Strictly positive: 1 ≤ amount < 2^64 (RFC §4.1). */
  amount: OutputValueType;
}

export function validateMintMeltEntry(entry: IMintMeltEntry, headerName: string): void {
  if (
    !Number.isInteger(entry.tokenIndex) ||
    entry.tokenIndex < 1 ||
    entry.tokenIndex > MAX_MINT_MELT_ENTRIES
  ) {
    throw new Error(
      `${headerName}: token_index must be in [1, ${MAX_MINT_MELT_ENTRIES}]; got ${entry.tokenIndex}`
    );
  }
  if (entry.amount < 1n || entry.amount >= 1n << 64n) {
    throw new Error(`${headerName}: amount must be in [1, 2**64); got ${entry.amount}`);
  }
}

export function serializeMintMeltEntries(entries: IMintMeltEntry[]): Buffer {
  const buffers: Buffer[] = [];
  const numBuf = Buffer.alloc(1);
  numBuf.writeUInt8(entries.length, 0);
  buffers.push(numBuf);
  for (const entry of entries) {
    const idxBuf = Buffer.alloc(1);
    idxBuf.writeUInt8(entry.tokenIndex, 0);
    buffers.push(idxBuf);
    // React Native's `buffer` polyfill omits `writeBigUInt64BE` (a
    // Node 12+ Buffer extension), so we go through `DataView` —
    // `setBigUint64` is a standard TypedArray method available in
    // Hermes and JavaScriptCore. Big-endian (the second arg `false`
    // means non-little-endian) matches the on-chain layout the
    // verifier expects.
    const amountArr = new ArrayBuffer(8);
    new DataView(amountArr).setBigUint64(0, entry.amount, false);
    buffers.push(Buffer.from(amountArr));
  }
  return Buffer.concat(buffers);
}

export function deserializeMintMeltEntries(
  buf: Buffer,
  headerName: string
): [IMintMeltEntry[], Buffer] {
  if (buf.length < 1) {
    throw new Error(`${headerName}: missing num_entries byte`);
  }
  const numEntries = buf.readUInt8(0);
  if (numEntries < 1) {
    throw new Error(`${headerName}: must contain at least 1 entry`);
  }
  if (numEntries > MAX_MINT_MELT_ENTRIES) {
    throw new Error(
      `${headerName}: too many entries: ${numEntries} exceeds maximum ${MAX_MINT_MELT_ENTRIES}`
    );
  }

  const needed = 1 + numEntries * ENTRY_SIZE;
  if (buf.length < needed) {
    throw new Error(`${headerName}: requires ${needed} bytes, got ${buf.length}`);
  }

  const entries: IMintMeltEntry[] = [];
  const seen = new Set<number>();
  let offset = 1;
  for (let i = 0; i < numEntries; i++) {
    const tokenIndex = buf.readUInt8(offset);
    offset += 1;
    const amount = buf.readBigUInt64BE(offset);
    offset += 8;
    if (tokenIndex < 1) {
      throw new Error(
        `${headerName}: token_index must be >= 1 (got ${tokenIndex}); HTR is forbidden`
      );
    }
    if (tokenIndex > MAX_MINT_MELT_ENTRIES) {
      throw new Error(
        `${headerName}: token_index ${tokenIndex} exceeds maximum ${MAX_MINT_MELT_ENTRIES}`
      );
    }
    if (amount < 1n) {
      throw new Error(`${headerName}: amount must be >= 1 (got ${amount})`);
    }
    if (seen.has(tokenIndex)) {
      throw new Error(`${headerName}: duplicate token_index ${tokenIndex}`);
    }
    seen.add(tokenIndex);
    entries.push({ tokenIndex, amount });
  }

  return [entries, buf.subarray(needed)];
}

export function validateMintMeltEntries(entries: IMintMeltEntry[], headerName: string): void {
  if (entries.length === 0) {
    throw new Error(`${headerName} requires at least 1 entry`);
  }
  if (entries.length > MAX_MINT_MELT_ENTRIES) {
    throw new Error(
      `${headerName}: too many entries: ${entries.length} exceeds maximum ${MAX_MINT_MELT_ENTRIES}`
    );
  }
  const seen = new Set<number>();
  for (const entry of entries) {
    validateMintMeltEntry(entry, headerName);
    if (seen.has(entry.tokenIndex)) {
      throw new Error(`${headerName}: duplicate token_index ${entry.tokenIndex}`);
    }
    seen.add(entry.tokenIndex);
  }
}
