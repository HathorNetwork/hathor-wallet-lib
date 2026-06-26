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
    rewindAmountShieldedOutput: jest.fn(),
    rewindFullShieldedOutput: jest.fn(),
    computeBalancingBlindingFactor: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x08)),
    deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x09)),
    createAssetCommitment: jest.fn().mockResolvedValue(Buffer.alloc(33, 0x0a)),
    createSurjectionProof: jest.fn().mockResolvedValue(Buffer.alloc(20, 0x0b)),
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
      createAmountShieldedOutput: jest
        .fn()
        .mockRejectedValue(new Error('crypto failure on output 0')),
    });
    const proposals = [makeProposal(), makeProposal()];

    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network
    ).catch(e => e);
    // VULN-1: the provider error is preserved as `cause`, NOT flattened into
    // `.message` (which would re-leak provider-supplied strings to logs).
    expect(err).toBeInstanceOf(Error);
    expect(err.cause?.message).toContain('crypto failure on output 0');
  });

  it('should propagate crypto provider error on second output', async () => {
    let callCount = 0;
    const provider = makeMockProvider({
      createAmountShieldedOutput: jest.fn().mockImplementation(async () => {
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

    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network
    ).catch(e => e);
    expect(err.cause?.message).toContain('crypto failure on output 1');
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

  it('rejects a single-output call (hathor-core trivial-commitment rule)', async () => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ value: 100n })];

    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      /At least 2 shielded outputs are required/
    );
    expect(provider.createAmountShieldedOutput).not.toHaveBeenCalled();
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
    // Two proposals so the minimum-2 check (hathor-core trivial-commitment
    // rule) doesn't fire first — we want to exercise the per-proposal
    // scanPubkey length guard.
    const proposals = [makeProposal({ scanPubkey: '02aa' /* 2 bytes */ }), makeProposal()];

    // INP-02: the canonical-hex guard fires first for a non-66-hex string.
    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      /scanPubkey must be 66 hex characters/
    );
    // Crypto provider must not have been called for the invalid input.
    expect(provider.createAmountShieldedOutput).not.toHaveBeenCalled();
  });

  it('rejects proposal.token that is not 32 bytes', async () => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ token: 'cafe' /* 2 bytes */ }), makeProposal()];

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
      createShieldedOutputWithBothBlindings: jest.fn().mockResolvedValue({
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

    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network,
      [{ tokenUid: '00' }]
    ).catch(e => e);
    expect(err.cause?.message).toMatch(/no assetBlindingFactor for FullShielded output/);
  });

  it('rejects when provider returns FullShielded result without assetBlindingFactor (last)', async () => {
    // First call returns a valid result, second (last) returns no abf —
    // exercises the last-output FullShielded branch's throw.
    let callCount = 0;
    const provider = makeMockProvider({
      createShieldedOutputWithBothBlindings: jest.fn().mockImplementation(async () => {
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

    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network,
      [{ tokenUid: '00' }]
    ).catch(e => e);
    expect(err.cause?.message).toMatch(/no assetBlindingFactor for FullShielded output/);
  });

  it('rejects when provider returns FullShielded result without assetCommitment', async () => {
    // Same contract as the assetBlindingFactor tests above — the FullShielded
    // helper checks both at the post-crypto-call boundary so it can construct
    // a well-formed `IDataFullShieldedOutput`. Silently storing `undefined`
    // would propagate down to the on-chain serialization and the fullnode
    // rejects with a confusing error far from the actual cause.
    const provider = makeMockProvider({
      createShieldedOutputWithBothBlindings: jest.fn().mockResolvedValue({
        ephemeralPubkey: Buffer.alloc(33, 0x02),
        commitment: Buffer.alloc(33, 0x03),
        rangeProof: Buffer.alloc(10, 0x04),
        blindingFactor: Buffer.alloc(32, 0x05),
        assetBlindingFactor: Buffer.alloc(32, 0x07),
        // assetCommitment intentionally omitted
      }),
    });
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 60n }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, value: 40n }),
    ];

    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network,
      [{ tokenUid: '00' }]
    ).catch(e => e);
    expect(err.cause?.message).toMatch(/no assetCommitment for FullShielded output/);
  });
});

describe('createShieldedOutputs — security hardening (CREATION_TS_SECURITY_REVIEW)', () => {
  const SECRET_TOKEN = 'ab'.repeat(32); // 32-byte FullShielded token UID (the hidden secret)

  // VULN-1
  it('redacts the hidden token UID in a FullShielded build error (cause preserved)', async () => {
    const provider = makeMockProvider({
      createShieldedOutputWithBothBlindings: jest
        .fn()
        .mockRejectedValue(new Error('inner crypto failure')),
    });
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, token: SECRET_TOKEN }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED, token: SECRET_TOKEN }),
    ];
    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network,
      [{ tokenUid: SECRET_TOKEN }]
    ).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(SECRET_TOKEN);
    expect(err.message).toContain('<hidden>');
    expect(err.cause).toBeInstanceOf(Error); // full inner error still available locally
  });

  it('still surfaces the (public) token for an AmountShielded build error', async () => {
    const provider = makeMockProvider({
      createAmountShieldedOutput: jest.fn().mockRejectedValue(new Error('inner')),
    });
    const proposals = [makeProposal({ token: '00' }), makeProposal({ token: '00' })];
    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network
    ).catch(e => e);
    expect(err.message).toContain('token=00');
  });

  // VULN-2 / DISC-02
  it.each([
    ['zero', 0n],
    ['negative', -1n],
    ['exactly 2^40', 1n << 40n],
    ['above 2^40', (1n << 40n) + 7n],
  ])('rejects out-of-range value (%s)', async (_label, value) => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ value }), makeProposal()];
    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      'value must be in [1, 2^40)'
    );
  });

  it('accepts a value just below 2^40', async () => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ value: (1n << 40n) - 1n }), makeProposal({ value: 1n })];
    await expect(createShieldedOutputs(proposals, provider, network)).resolves.toHaveLength(2);
  });

  // CRY-01
  it('rejects an oversized surjection domain before the uncatchable native abort', async () => {
    const provider = makeMockProvider();
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
    ];
    const inputGenerators = Array.from({ length: 257 }, () => ({ tokenUid: '00' }));
    await expect(
      createShieldedOutputs(proposals, provider, network, inputGenerators)
    ).rejects.toThrow('surjection-proof');
  });

  // INP-02
  it('rejects a truncated scanPubkey that still decodes to a valid byte length', async () => {
    const provider = makeMockProvider();
    // TEST_SCAN_PUBKEY is valid 66-hex; trailing 'zz' makes Buffer.from truncate
    // back to the valid 33 bytes (the old length-only gate passed), but it is not
    // canonical 66-hex → must be rejected (would otherwise be unspendable).
    const proposals = [makeProposal({ scanPubkey: `${TEST_SCAN_PUBKEY}zz` }), makeProposal()];
    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow(
      'hex characters'
    );
  });

  // INP-03
  it('rejects more than MAX_SHIELDED_OUTPUTS (32) proposals', async () => {
    const provider = makeMockProvider();
    const proposals = Array.from({ length: 33 }, () => makeProposal());
    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow('At most 32');
  });

  // INP-04
  it.each([
    ['too large', 2 ** 32],
    ['negative', -1],
    ['non-integer', 1.5],
  ])('rejects invalid timelock (%s)', async (_label, timelock) => {
    const provider = makeMockProvider();
    const proposals = [makeProposal({ timelock }), makeProposal()];
    await expect(createShieldedOutputs(proposals, provider, network)).rejects.toThrow('timelock');
  });

  // INP-07
  it('rejects a wrong-length assetBlindingFactor in inputGenerators', async () => {
    const provider = makeMockProvider();
    const proposals = [
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
      makeProposal({ shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }),
    ];
    await expect(
      createShieldedOutputs(proposals, provider, network, [
        { tokenUid: '00', assetBlindingFactor: Buffer.alloc(16) }, // 16 != 32
      ])
    ).rejects.toThrow('assetBlindingFactor must be 32');
  });

  // SUP-02
  it('rejects provider output with a wrong-length commitment', async () => {
    const provider = makeMockProvider({
      createAmountShieldedOutput: jest.fn().mockResolvedValue({
        ephemeralPubkey: Buffer.alloc(33, 0x02),
        commitment: Buffer.alloc(10, 0x03), // wrong: should be 33
        rangeProof: Buffer.alloc(100, 0x04),
        blindingFactor: Buffer.alloc(32, 0x05),
      }),
    });
    const proposals = [makeProposal(), makeProposal()];
    const err: Error & { cause?: Error } = await createShieldedOutputs(
      proposals,
      provider,
      network
    ).catch(e => e);
    // The provider-shape error is thrown inside the per-output try → rewrapped;
    // the original is preserved as `cause`.
    expect(err.cause?.message ?? err.message).toContain('commitment');
  });
});
