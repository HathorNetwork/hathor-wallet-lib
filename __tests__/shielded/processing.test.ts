/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HDPrivateKey } from 'bitcore-lib';
import { resolveTokenUid, processShieldedOutputs } from '../../src/shielded/processing';
import { NATIVE_TOKEN_UID_HEX } from '../../src/constants';
import {
  ShieldedOutputMode,
  IShieldedOutput,
  IShieldedCryptoProvider,
} from '../../src/shielded/types';
import { IHistoryTx } from '../../src/types';

function makeShieldedOutput(overrides: Partial<IShieldedOutput> = {}): IShieldedOutput {
  return {
    mode: ShieldedOutputMode.AMOUNT_SHIELDED,
    commitment: 'aa'.repeat(33),
    range_proof: 'bb'.repeat(10),
    script: '76a914',
    token_data: 0,
    ephemeral_pubkey: 'cc'.repeat(33),
    decoded: { type: 'P2PKH', address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo' },
    ...overrides,
  };
}

function makeHistoryTx(overrides: Partial<IHistoryTx> = {}): IHistoryTx {
  return {
    tx_id: 'abc123',
    version: 1,
    weight: 1,
    timestamp: 1000,
    is_voided: false,
    nonce: 0,
    inputs: [],
    outputs: [],
    parents: [],
    tokens: [],
    token_name: undefined,
    token_symbol: undefined,
    height: 1,
    ...overrides,
  } as IHistoryTx;
}

function makeMockProvider(
  overrides: Partial<IShieldedCryptoProvider> = {}
): IShieldedCryptoProvider {
  return {
    generateRandomBlindingFactor: jest.fn().mockReturnValue(Buffer.alloc(32)),
    createAmountShieldedOutput: jest.fn(),
    createShieldedOutputWithBothBlindings: jest.fn(),
    rewindAmountShieldedOutput: jest.fn(),
    rewindFullShieldedOutput: jest.fn(),
    computeBalancingBlindingFactor: jest.fn(),
    deriveTag: jest.fn(),
    createAssetCommitment: jest.fn(),
    createSurjectionProof: jest.fn(),
    deriveEcdhSharedSecret: jest.fn(),
    ...overrides,
  };
}

describe('resolveTokenUid', () => {
  it('should return NATIVE_TOKEN_UID_HEX for token_data 0', () => {
    const so = makeShieldedOutput({ token_data: 0 });
    const tx = makeHistoryTx();
    expect(resolveTokenUid(so, tx)).toBe(NATIVE_TOKEN_UID_HEX);
  });

  it('should return NATIVE_TOKEN_UID_HEX for token_data with authority bit set but index 0', () => {
    // authority bit is 0x80, so 0x80 & 0x7f = 0
    const so = makeShieldedOutput({ token_data: 0x80 });
    const tx = makeHistoryTx();
    expect(resolveTokenUid(so, tx)).toBe(NATIVE_TOKEN_UID_HEX);
  });

  it('should return token from tx.tokens for token_data 1', () => {
    const customToken = 'deadbeef'.repeat(8);
    const so = makeShieldedOutput({ token_data: 1 });
    const tx = makeHistoryTx({ tokens: [customToken] });
    expect(resolveTokenUid(so, tx)).toBe(customToken);
  });

  it('should return second token for token_data 2', () => {
    const tokenA = 'aaaa'.repeat(16);
    const tokenB = 'bbbb'.repeat(16);
    const so = makeShieldedOutput({ token_data: 2 });
    const tx = makeHistoryTx({ tokens: [tokenA, tokenB] });
    expect(resolveTokenUid(so, tx)).toBe(tokenB);
  });

  it('should throw for out-of-range token_data', () => {
    const so = makeShieldedOutput({ token_data: 5 });
    const tx = makeHistoryTx({ tokens: ['aa'.repeat(32)] });
    expect(() => resolveTokenUid(so, tx)).toThrow(/Invalid token_data index 5/);
  });

  it('should mask authority bit when resolving', () => {
    // token_data = 0x81 => index = 1 (0x81 & 0x7f = 1)
    const customToken = 'ff'.repeat(32);
    const so = makeShieldedOutput({ token_data: 0x81 });
    const tx = makeHistoryTx({ tokens: [customToken] });
    expect(resolveTokenUid(so, tx)).toBe(customToken);
  });
});

describe('processShieldedOutputs', () => {
  it('should return empty array when no shielded outputs', async () => {
    const tx = makeHistoryTx();
    const storage = {
      getAddressInfo: jest.fn(),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const provider = makeMockProvider();
    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
  });

  it('should skip outputs without decoded address', async () => {
    const so = makeShieldedOutput({ decoded: {} });
    const tx = makeHistoryTx({ shielded_outputs: [so] });
    const storage = {
      getAddressInfo: jest.fn(),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const provider = makeMockProvider();
    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
    expect(storage.getAddressInfo).not.toHaveBeenCalled();
  });

  it('should skip outputs for unknown addresses', async () => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({ shielded_outputs: [so] });
    const storage = {
      getAddressInfo: jest.fn().mockResolvedValue(null),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const provider = makeMockProvider();
    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
  });

  it('should skip output when scan key derivation fails and log warning', async () => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [{ value: 10n } as any],
    });

    const storage = {
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockRejectedValue(new Error('no key')),
      logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider();

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
    expect(storage.logger.warn).toHaveBeenCalled();
  });

  it('should skip output when rewind throws and log debug message', async () => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [],
    });

    // Mock a valid scan xpriv so key derivation succeeds and rewind is actually called.
    // Use a real-looking xpriv that bitcore can parse.
    // A real xpriv at depth 1 (chain-level) so deriveNonCompliantChild(index) works
    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;

    const storage = {
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest.fn().mockImplementation(() => {
        throw new Error('decryption failed');
      }),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
    // rewind was called and threw — the debug log should capture the failure
    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalled();
    expect(storage.logger.debug).toHaveBeenCalled();
  });

  it('should process multiple shielded outputs and return only decryptable ones', async () => {
    const so1 = makeShieldedOutput({
      decoded: { type: 'P2PKH', address: 'addr1' },
    });
    const so2 = makeShieldedOutput({
      decoded: { type: 'P2PKH', address: 'addr2' },
    });
    const so3 = makeShieldedOutput({
      decoded: { type: 'P2PKH', address: 'addr3' },
    });

    const tx = makeHistoryTx({
      shielded_outputs: [so1, so2, so3],
      outputs: [{ value: 5n } as any],
    });

    // addr1 is ours and succeeds, addr2 is unknown, addr3 is ours but rewind fails
    // A real xpriv at depth 1 (chain-level) so deriveNonCompliantChild(index) works
    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;

    const storage = {
      getAddressInfo: jest.fn().mockImplementation(async (addr: string) => {
        if (addr === 'addr1') return { bip32AddressIndex: 0 };
        if (addr === 'addr3') return { bip32AddressIndex: 2 };
        return null;
      }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    // addr1 rewind succeeds, addr3 rewind fails
    let callCount = 0;
    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // addr1: success
          return { value: 100n, blindingFactor: Buffer.alloc(32, 0x01) };
        }
        // addr3: failure
        throw new Error('decryption failed');
      }),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    // Only addr1 succeeded
    expect(result).toHaveLength(1);
    expect(result[0].address).toBe('addr1');
    expect(result[0].decrypted.value).toBe(100n);
    // addr2 was skipped (unknown), addr3 failed rewind
    expect(storage.getAddressInfo).toHaveBeenCalledWith('addr1');
    expect(storage.getAddressInfo).toHaveBeenCalledWith('addr2');
    expect(storage.getAddressInfo).toHaveBeenCalledWith('addr3');
    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledTimes(2);
  });

  it('should skip FullShielded output when asset commitment cross-check fails', async () => {
    const so = makeShieldedOutput({
      mode: ShieldedOutputMode.FULLY_SHIELDED,
      asset_commitment: 'dd'.repeat(33),
      decoded: { type: 'P2PKH', address: 'addr1' },
    });
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [],
    });

    // Use a valid xpriv so key derivation succeeds and rewind is actually called
    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;

    const storage = {
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider({
      rewindFullShieldedOutput: jest.fn().mockReturnValue({
        value: 100n,
        blindingFactor: Buffer.alloc(32, 0x02),
        // PR 1 refactor: provider boundary returns tokenUid as hex string
        // (single canonical encoding for the shielded module).
        tokenUid: '03'.repeat(32),
        assetBlindingFactor: Buffer.alloc(32, 0x04),
      }),
      deriveTag: jest.fn().mockReturnValue(Buffer.alloc(32, 0x05)),
      // Return a DIFFERENT commitment than on-chain — cross-check should fail
      createAssetCommitment: jest.fn().mockReturnValue(Buffer.alloc(33, 0xff)),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    // Cross-check failed: createAssetCommitment returned a mismatched value
    expect(result).toEqual([]);
    // rewind WAS called (key derivation succeeded)
    expect(provider.rewindFullShieldedOutput).toHaveBeenCalled();
    // cross-check failure was logged at error level (this branch indicates
    // either a bug in tag/commitment construction or active forgery — both
    // warrant error-level visibility, not warn).
    expect(storage.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('cross-check failed')
    );
    // The error message must carry enough context to debug from logs alone:
    // the recovered token UID and the on-chain assetCommitment hex.
    const errorMsg = (storage.logger.error as jest.Mock).mock.calls[0][0] as string;
    expect(errorMsg).toMatch(/recovered tokenUid=[0-9a-f]+/);
    expect(errorMsg).toMatch(/on-chain assetCommitment=[0-9a-f]+/);
    expect(errorMsg).toMatch(/expected assetCommitment=[0-9a-f]+/);
  });
});
