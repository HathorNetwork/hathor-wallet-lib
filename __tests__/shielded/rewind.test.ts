/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import {
  rewindShieldedOutput,
  deriveScanChildPrivkey,
  ShieldedRewindError,
} from '../../src/shielded/rewind';
import { IShieldedCryptoProvider, ShieldedOutputMode } from '../../src/shielded/types';
import { NATIVE_TOKEN_UID_HEX } from '../../src/constants';

const customToken = 'ab'.repeat(32);
const buf = (byte: number, size = 33) => Buffer.alloc(size, byte);

function makeProvider(overrides: Partial<IShieldedCryptoProvider> = {}): IShieldedCryptoProvider {
  return {
    rewindAmountShieldedOutput: jest.fn().mockResolvedValue({
      value: 150n,
      blindingFactor: buf(1, 32),
    }),
    rewindFullShieldedOutput: jest.fn().mockResolvedValue({
      value: 70n,
      blindingFactor: buf(2, 32),
      assetBlindingFactor: buf(3, 32),
      tokenUid: customToken,
    }),
    deriveTag: jest.fn().mockResolvedValue(buf(4)),
    createAssetCommitment: jest.fn().mockResolvedValue(buf(5)),
    ...overrides,
  } as unknown as IShieldedCryptoProvider;
}

const privkey = buf(9, 32);

describe('rewindShieldedOutput', () => {
  it('rewinds an amount-shielded output with the known token', async () => {
    const provider = makeProvider();
    const result = await rewindShieldedOutput(provider, privkey, {
      mode: ShieldedOutputMode.AMOUNT_SHIELDED,
      ephemeralPubkey: buf(6),
      commitment: buf(7),
      rangeProof: buf(8, 64),
      tokenUid: NATIVE_TOKEN_UID_HEX,
    });
    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledWith(
      privkey,
      buf(6),
      buf(7),
      buf(8, 64),
      Buffer.from(NATIVE_TOKEN_UID_HEX, 'hex')
    );
    expect(result).toEqual({
      mode: ShieldedOutputMode.AMOUNT_SHIELDED,
      value: 150n,
      tokenUid: NATIVE_TOKEN_UID_HEX,
      blindingFactor: buf(1, 32),
      assetBlindingFactor: undefined,
    });
  });

  it('rewinds a fully-shielded output and checks its asset commitment', async () => {
    const provider = makeProvider();
    const result = await rewindShieldedOutput(provider, privkey, {
      mode: ShieldedOutputMode.FULLY_SHIELDED,
      ephemeralPubkey: buf(6),
      commitment: buf(7),
      rangeProof: buf(8, 64),
      assetCommitment: buf(5),
    });
    expect(provider.deriveTag).toHaveBeenCalledWith(Buffer.from(customToken, 'hex'));
    expect(provider.createAssetCommitment).toHaveBeenCalledWith(buf(4), buf(3, 32));
    expect(result).toEqual({
      mode: ShieldedOutputMode.FULLY_SHIELDED,
      value: 70n,
      tokenUid: customToken,
      blindingFactor: buf(2, 32),
      assetBlindingFactor: buf(3, 32),
    });
  });

  it('rejects a fully-shielded output whose asset commitment does not match', async () => {
    const provider = makeProvider();
    const err = await rewindShieldedOutput(provider, privkey, {
      mode: ShieldedOutputMode.FULLY_SHIELDED,
      ephemeralPubkey: buf(6),
      commitment: buf(7),
      rangeProof: buf(8, 64),
      assetCommitment: buf(0xee),
    }).catch(e => e);
    expect(err).toBeInstanceOf(ShieldedRewindError);
    expect(err.reason).toBe('asset-commitment-mismatch');
  });

  it('rejects a non-positive value', async () => {
    const provider = makeProvider({
      rewindAmountShieldedOutput: jest.fn().mockResolvedValue({
        value: 0n,
        blindingFactor: buf(1, 32),
      }),
    });
    const err = await rewindShieldedOutput(provider, privkey, {
      mode: ShieldedOutputMode.AMOUNT_SHIELDED,
      ephemeralPubkey: buf(6),
      commitment: buf(7),
      rangeProof: buf(8, 64),
      tokenUid: customToken,
    }).catch(e => e);
    expect(err).toBeInstanceOf(ShieldedRewindError);
    expect(err.reason).toBe('non-positive-value');
  });

  it('needs the token of an amount-shielded output and the asset commitment of a fully-shielded one', async () => {
    const provider = makeProvider();
    const base = { ephemeralPubkey: buf(6), commitment: buf(7), rangeProof: buf(8, 64) };
    await expect(
      rewindShieldedOutput(provider, privkey, { ...base, mode: ShieldedOutputMode.AMOUNT_SHIELDED })
    ).rejects.toThrow(/token/);
    await expect(
      rewindShieldedOutput(provider, privkey, { ...base, mode: ShieldedOutputMode.FULLY_SHIELDED })
    ).rejects.toThrow(/asset commitment/);
  });
});

describe('deriveScanChildPrivkey', () => {
  it('derives the compliant child as a 32-byte buffer', () => {
    const scan = new HDPrivateKey();
    expect(deriveScanChildPrivkey(scan, 3)).toEqual(
      scan.deriveChild(3).privateKey.toBuffer({ size: 32 })
    );
  });
});
