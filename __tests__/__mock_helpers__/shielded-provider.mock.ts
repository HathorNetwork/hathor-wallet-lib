/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IShieldedCryptoProvider } from '../../src/shielded/types';

/**
 * A structural (non-cryptographic) shielded crypto provider: fixed-size
 * buffers so the creation pipeline runs to completion. Rewinds open every
 * output to `rewoundValue`, with HTR as the token of fully shielded ones.
 */
export function makeStructuralShieldedProvider({
  rewoundValue = 150n,
  rewoundTokenUid = '00'.repeat(32),
}: { rewoundValue?: bigint; rewoundTokenUid?: string } = {}): IShieldedCryptoProvider {
  return {
    generateRandomBlindingFactor: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x01)),
    createAmountShieldedOutput: jest.fn().mockResolvedValue({
      ephemeralPubkey: Buffer.alloc(33, 0x02),
      commitment: Buffer.alloc(33, 0x03),
      rangeProof: Buffer.alloc(10, 0x04),
      blindingFactor: Buffer.alloc(32, 0x05),
    }),
    createShieldedOutputWithBothBlindings: jest.fn().mockResolvedValue({
      ephemeralPubkey: Buffer.alloc(33, 0x02),
      commitment: Buffer.alloc(33, 0x03),
      rangeProof: Buffer.alloc(10, 0x04),
      blindingFactor: Buffer.alloc(32, 0x05),
      assetCommitment: Buffer.alloc(33, 0x06),
      assetBlindingFactor: Buffer.alloc(32, 0x07),
    }),
    rewindAmountShieldedOutput: jest.fn().mockImplementation(async () => ({
      value: rewoundValue,
      blindingFactor: Buffer.alloc(32, 0x11),
    })),
    rewindFullShieldedOutput: jest.fn().mockImplementation(async () => ({
      value: rewoundValue,
      blindingFactor: Buffer.alloc(32, 0x12),
      assetBlindingFactor: Buffer.alloc(32, 0x13),
      tokenUid: rewoundTokenUid,
    })),
    computeBalancingBlindingFactor: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x08)),
    deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x09)),
    createAssetCommitment: jest.fn().mockResolvedValue(Buffer.alloc(33, 0x0a)),
    createSurjectionProof: jest.fn().mockResolvedValue(Buffer.alloc(20, 0x0b)),
    deriveEcdhSharedSecret: jest.fn(),
  } as unknown as IShieldedCryptoProvider;
}
