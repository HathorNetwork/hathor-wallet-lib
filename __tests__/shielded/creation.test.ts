/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createShieldedOutputs } from '../../src/shielded/creation';
import { IShieldedCryptoProvider, ShieldedOutputMode } from '../../src/shielded/types';
import Network from '../../src/models/network';

function makeMockProvider(
  overrides: Partial<IShieldedCryptoProvider> = {}
): IShieldedCryptoProvider {
  return {
    generateRandomBlindingFactor: jest.fn().mockReturnValue(Buffer.alloc(32, 0x01)),
    createAmountShieldedOutput: jest.fn().mockImplementation(() => {
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
const TEST_SCAN_PUBKEY = `02${'aa'.repeat(32)}`;

function makeProposal(overrides = {}) {
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
    const proposals = [makeProposal({ value: 60n }), makeProposal({ value: 40n })];

    const results = await createShieldedOutputs(proposals, provider, network);

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
    const proposals = [makeProposal(), makeProposal()];

    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
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
    const proposals = [makeProposal({ value: 60n }), makeProposal({ value: 40n })];

    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      'crypto failure on output 1'
    );
  });

  it('should create FullShielded outputs with surjection proofs', async () => {
    const provider = makeMockProvider();
    const proposals = [
      makeProposal({ value: 60n, shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
      makeProposal({ value: 40n, shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
    ];

    const results = await createShieldedOutputs(proposals, provider, network, [{ tokenUid: '00' }]);

    expect(results).toHaveLength(2);
    // Both FullShielded outputs should have surjection proofs
    expect(results[0].surjectionProof).toBeDefined();
    expect(results[1].surjectionProof).toBeDefined();
    expect(provider.createSurjectionProof).toHaveBeenCalledTimes(2);
  });

  it('should handle single output (no balancing needed)', async () => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ value: 100n })];

    const results = await createShieldedOutputs(proposals, provider, network);

    expect(results).toHaveLength(1);
    // Single output: isLast=true but createdOutputs.length=0, so random vbf path
    expect(provider.computeBalancingBlindingFactor).not.toHaveBeenCalled();
  });

  it('should return empty array for empty proposals', async () => {
    const provider = makeMockProvider();
    const results = await createShieldedOutputs([], provider, network);
    expect(results).toEqual([]);
  });
});

/**
 * Coverage for the upfront validation block in `createShieldedOutputs`.
 * Each test exercises one rejection path so a future "cleanup" of the
 * guard block can't silently delete a check without a red test.
 */
describe('createShieldedOutputs validation guards', () => {
  it('rejects scanPubkey that is not 33 bytes', async () => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ scanPubkey: '02aa' /* 2 bytes */ })];

    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      /scanPubkey must be 33 bytes, got 2/
    );
    // Crypto provider must not have been called for the invalid input.
    expect(provider.createAmountShieldedOutput).not.toHaveBeenCalled();
  });

  it('rejects proposal.token that is not 32 bytes', async () => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ token: 'cafe' /* 2 bytes */ })];

    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      /token UID must be 32 bytes, got 2/
    );
    expect(provider.createAmountShieldedOutput).not.toHaveBeenCalled();
  });

  it('rejects FullShielded outputs with empty inputGenerators', async () => {
    const provider = makeMockProvider();
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
    ];

    await expect(createShieldedOutputs(proposals, provider, network, [])).rejects.toThrow(
      /FullShielded outputs require at least one input token UID/
    );
    expect(provider.createShieldedOutputWithBothBlindings).not.toHaveBeenCalled();
  });

  it('rejects inputGenerators tokenUid that is not 32 bytes', async () => {
    const provider = makeMockProvider();
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 60n }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 40n }),
    ];
    const inputGenerators = [{ tokenUid: 'cafe' /* 2 bytes */ }];

    await expect(
      createShieldedOutputs(proposals, provider, network, inputGenerators)
    ).rejects.toThrow(/inputGenerators\[0\]: token UID must be 32 bytes, got 2/);
    expect(provider.createShieldedOutputWithBothBlindings).not.toHaveBeenCalled();
  });

  it('rejects when provider returns FullShielded result without assetBlindingFactor (non-last)', async () => {
    // Provider returns the non-last FullShielded output WITHOUT abf — that
    // is a contract violation; the code must throw rather than silently
    // store ZERO_TWEAK as the generator blinding factor.
    const provider = makeMockProvider({
      createShieldedOutputWithBothBlindings: jest.fn().mockReturnValue({
        ephemeralPubkey: Buffer.alloc(33, 0x02),
        commitment: Buffer.alloc(33, 0x03),
        rangeProof: Buffer.alloc(10, 0x04),
        blindingFactor: Buffer.alloc(32, 0x05),
        assetCommitment: Buffer.alloc(33, 0x06),
        // assetBlindingFactor intentionally omitted
      }),
    });
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 60n }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 40n }),
    ];

    await expect(
      createShieldedOutputs(proposals, provider, network, [{ tokenUid: '00' }])
    ).rejects.toThrow(/no assetBlindingFactor for FullShielded output/);
  });

  it('rejects when provider returns FullShielded result without assetBlindingFactor (last)', async () => {
    // First call returns a valid result, second (last) returns no abf —
    // exercises the last-output FullShielded branch's throw.
    let callCount = 0;
    const provider = makeMockProvider({
      createShieldedOutputWithBothBlindings: jest.fn().mockImplementation(() => {
        callCount++;
        const base = {
          ephemeralPubkey: Buffer.alloc(33, 0x02),
          commitment: Buffer.alloc(33, 0x03),
          rangeProof: Buffer.alloc(10, 0x04),
          blindingFactor: Buffer.alloc(32, 0x05),
          assetCommitment: Buffer.alloc(33, 0x06),
        };
        if (callCount === 1) {
          return { ...base, assetBlindingFactor: Buffer.alloc(32, 0x07) };
        }
        return base; // last output: abf missing
      }),
    });
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 60n }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 40n }),
    ];

    await expect(
      createShieldedOutputs(proposals, provider, network, [{ tokenUid: '00' }])
    ).rejects.toThrow(/no assetBlindingFactor for last FullShielded output/);
  });
});
