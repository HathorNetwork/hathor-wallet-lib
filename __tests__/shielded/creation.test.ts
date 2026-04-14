/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createShieldedOutputs } from '../../src/shielded/creation';
import { IShieldedCryptoProvider, ShieldedOutputMode } from '../../src/shielded/types';
import Network from '../../src/models/network';

function makeMockProvider(overrides: Partial<IShieldedCryptoProvider> = {}): IShieldedCryptoProvider {
  let callCount = 0;
  return {
    generateRandomBlindingFactor: jest.fn().mockReturnValue(Buffer.alloc(32, 0x01)),
    createAmountShieldedOutput: jest.fn().mockImplementation(() => {
      callCount++;
      return {
        ephemeralPubkey: Buffer.alloc(33, 0x02),
        commitment: Buffer.alloc(33, 0x03),
        rangeProof: Buffer.alloc(10, 0x04),
        blindingFactor: Buffer.alloc(32, 0x05),
      };
    }),
    createShieldedOutputWithBothBlindings: jest.fn().mockReturnValue({
      ephemeralPubkey: Buffer.alloc(33, 0x02),
      commitment: Buffer.alloc(33, 0x03),
      rangeProof: Buffer.alloc(10, 0x04),
      blindingFactor: Buffer.alloc(32, 0x05),
      assetCommitment: Buffer.alloc(33, 0x06),
      assetBlindingFactor: Buffer.alloc(32, 0x07),
    }),
    rewindAmountShieldedOutput: jest.fn(),
    rewindFullShieldedOutput: jest.fn(),
    computeBalancingBlindingFactor: jest.fn().mockReturnValue(Buffer.alloc(32, 0x08)),
    deriveTag: jest.fn().mockReturnValue(Buffer.alloc(32, 0x09)),
    createAssetCommitment: jest.fn().mockReturnValue(Buffer.alloc(33, 0x0a)),
    createSurjectionProof: jest.fn().mockReturnValue(Buffer.alloc(20, 0x0b)),
    deriveEcdhSharedSecret: jest.fn(),
    ...overrides,
  };
}

const network = new Network('testnet');

// Use a valid testnet P2PKH address for script generation
const TEST_ADDRESS = 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo';
const TEST_SCAN_PUBKEY = '02' + 'aa'.repeat(32);

function makeDef(overrides = {}) {
  return {
    address: TEST_ADDRESS,
    value: 100n,
    token: '00',
    scanPubkey: TEST_SCAN_PUBKEY,
    shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
    ...overrides,
  };
}

describe('createShieldedOutputs', () => {
  it('should create AmountShielded outputs with balancing blinding factor on last output', async () => {
    const provider = makeMockProvider();
    const defs = [makeDef({ value: 60n }), makeDef({ value: 40n })];

    const results = await createShieldedOutputs(defs, provider, network);

    expect(results).toHaveLength(2);
    // First output uses random vbf
    expect(provider.generateRandomBlindingFactor).toHaveBeenCalled();
    // Second (last) output uses balancing vbf
    expect(provider.computeBalancingBlindingFactor).toHaveBeenCalledWith(
      40n,
      expect.any(Buffer),
      [],
      expect.any(Array)
    );
    // Both outputs should have scripts
    expect(results[0].script).toBeDefined();
    expect(results[1].script).toBeDefined();
  });

  it('should propagate crypto provider error on first output', async () => {
    const provider = makeMockProvider({
      createAmountShieldedOutput: jest.fn().mockImplementation(() => {
        throw new Error('crypto failure on output 0');
      }),
    });
    const defs = [makeDef(), makeDef()];

    await expect(createShieldedOutputs(defs, provider, network)).rejects.toThrow(
      'crypto failure on output 0'
    );
  });

  it('should propagate crypto provider error on second output', async () => {
    let callCount = 0;
    const provider = makeMockProvider({
      createAmountShieldedOutput: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            ephemeralPubkey: Buffer.alloc(33, 0x02),
            commitment: Buffer.alloc(33, 0x03),
            rangeProof: Buffer.alloc(10, 0x04),
            blindingFactor: Buffer.alloc(32, 0x05),
          };
        }
        throw new Error('crypto failure on output 1');
      }),
    });
    const defs = [makeDef({ value: 60n }), makeDef({ value: 40n })];

    await expect(createShieldedOutputs(defs, provider, network)).rejects.toThrow(
      'crypto failure on output 1'
    );
  });

  it('should create FullShielded outputs with surjection proofs', async () => {
    const provider = makeMockProvider();
    const defs = [
      makeDef({ value: 60n, shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
      makeDef({ value: 40n, shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
    ];

    const results = await createShieldedOutputs(defs, provider, network);

    expect(results).toHaveLength(2);
    // Both FullShielded outputs should have surjection proofs
    expect(results[0].surjectionProof).toBeDefined();
    expect(results[1].surjectionProof).toBeDefined();
    expect(provider.createSurjectionProof).toHaveBeenCalledTimes(2);
  });

  it('should handle single output (no balancing needed)', async () => {
    const provider = makeMockProvider();
    const defs = [makeDef({ value: 100n })];

    const results = await createShieldedOutputs(defs, provider, network);

    expect(results).toHaveLength(1);
    // Single output: isLast=true but createdOutputs.length=0, so random vbf path
    expect(provider.computeBalancingBlindingFactor).not.toHaveBeenCalled();
  });
});
