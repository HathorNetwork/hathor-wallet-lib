/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HDPrivateKey } from 'bitcore-lib';
import {
  resolveTokenUid,
  processShieldedOutputs,
  decodeShieldedOutputs,
} from '../../src/shielded/processing';
import { NATIVE_TOKEN_UID_HEX, NATIVE_TOKEN_UID } from '../../src/constants';
import {
  ShieldedOutputMode,
  IShieldedOutput,
  IShieldedCryptoProvider,
} from '../../src/shielded/types';
import { IHistoryTx, IHistoryShieldedOutput } from '../../src/types';
import { DecryptionError, InvalidPasswdError, ShieldedKeyError } from '../../src/errors';
import { keyMaterialFromExtendedKey } from '../../src/shielded/keys';
import { SessionClosedError, shieldedSessionOf } from '../../src/shielded/session';

function makeShieldedOutput(overrides: Partial<IShieldedOutput> = {}): IHistoryShieldedOutput {
  return {
    mode: ShieldedOutputMode.AMOUNT_SHIELDED,
    commitment: 'aa'.repeat(33),
    range_proof: 'bb'.repeat(10),
    script: '76a914',
    token_data: 0,
    ephemeral_pubkey: 'cc'.repeat(33),
    decoded: { type: 'P2PKH', address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo' },
    ...overrides,
  } as IHistoryShieldedOutput;
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
  } as unknown as IShieldedCryptoProvider;
}

describe('resolveTokenUid', () => {
  it('should return NATIVE_TOKEN_UID_HEX for token_data 0', () => {
    const so = makeShieldedOutput({ token_data: 0 });
    const tx = makeHistoryTx();
    expect(resolveTokenUid(so.token_data, tx)).toBe(NATIVE_TOKEN_UID_HEX);
  });

  it('should return NATIVE_TOKEN_UID_HEX for token_data with authority bit set but index 0', () => {
    // authority bit is 0x80, so 0x80 & 0x7f = 0
    const so = makeShieldedOutput({ token_data: 0x80 });
    const tx = makeHistoryTx();
    expect(resolveTokenUid(so.token_data, tx)).toBe(NATIVE_TOKEN_UID_HEX);
  });

  it('should return token from tx.tokens for token_data 1', () => {
    const customToken = 'deadbeef'.repeat(8);
    const so = makeShieldedOutput({ token_data: 1 });
    const tx = makeHistoryTx({ tokens: [customToken] });
    expect(resolveTokenUid(so.token_data, tx)).toBe(customToken);
  });

  it('should return second token for token_data 2', () => {
    const tokenA = 'aaaa'.repeat(16);
    const tokenB = 'bbbb'.repeat(16);
    const so = makeShieldedOutput({ token_data: 2 });
    const tx = makeHistoryTx({ tokens: [tokenA, tokenB] });
    expect(resolveTokenUid(so.token_data, tx)).toBe(tokenB);
  });

  it('should throw for out-of-range token_data', () => {
    const so = makeShieldedOutput({ token_data: 5 });
    const tx = makeHistoryTx({ tokens: ['aa'.repeat(32)] });
    expect(() => resolveTokenUid(so.token_data, tx)).toThrow(/Invalid token_data index 5/);
  });

  it('should mask authority bit when resolving', () => {
    // token_data = 0x81 => index = 1 (0x81 & 0x7f = 1)
    const customToken = 'ff'.repeat(32);
    const so = makeShieldedOutput({ token_data: 0x81 });
    const tx = makeHistoryTx({ tokens: [customToken] });
    expect(resolveTokenUid(so.token_data, tx)).toBe(customToken);
  });

  it('should throw when an AmountShielded output is missing token_data', () => {
    // Only FullShielded may omit token_data, and the caller routes those away
    // before reaching resolveTokenUid — so an absent token_data here is a bug,
    // surfaced loudly rather than silently resolved to the native-token slot.
    const so = makeShieldedOutput({ token_data: undefined });
    const tx = makeHistoryTx({ tx_id: 'deadbeef' });
    expect(() => resolveTokenUid(so.token_data, tx)).toThrow(/missing token_data/);
  });
});

describe('processShieldedOutputs (SEPARATED model — write in place)', () => {
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
    // The slot stays non-owned (value undefined) — no in-place write.
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it('should skip an output with no ephemeral_pubkey before any storage/key access', async () => {
    // On-chain the ECDH pubkey is a fixed 33 bytes that is all-zeros when
    // absent, and the fullnode omits the JSON key in that case. Such an output
    // can never be rewound, so processShieldedOutputs skips it up front — no
    // ownership check, no scan-key unlock, no rewind.
    const so = makeShieldedOutput({
      ephemeral_pubkey: undefined,
      decoded: { type: 'P2PKH', address: 'addr1' },
    });
    const tx = makeHistoryTx({ shielded_outputs: [so], outputs: [] });
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn(),
      getScanXPrivKey: jest.fn(),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const provider = makeMockProvider();

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
    expect(tx.shielded_outputs![0].value).toBeUndefined();
    // Skipped before touching storage, keys, or the crypto provider.
    expect(storage.isAddressMine).not.toHaveBeenCalled();
    expect(storage.getScanXPrivKey).not.toHaveBeenCalled();
    expect(provider.rewindAmountShieldedOutput).not.toHaveBeenCalled();
  });

  it('should skip outputs for unknown addresses (no in-place write)', async () => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({ shielded_outputs: [so] });
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(false),
      getAddressInfo: jest.fn().mockResolvedValue(null),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const provider = makeMockProvider();
    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it('should throw when the scan xpriv unlock fails (systemic error)', async () => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [{ value: 10n } as any],
    });

    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockRejectedValue(new Error('no key')),
      logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider();

    // A scan-xpriv unlock failure is systemic (wrong PIN / missing key would fail
    // for every owned output), so processShieldedOutputs fails loud rather than
    // silently skipping owned outputs and under-counting the balance.
    await expect(processShieldedOutputs(storage, tx, provider, 'pin')).rejects.toThrow('no key');
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it.each([
    [
      'a wrong PIN',
      () => Promise.reject(new InvalidPasswdError()),
      'shielded-wrong-pin',
      InvalidPasswdError,
    ],
    [
      'a record that does not decrypt',
      () => Promise.reject(new DecryptionError()),
      'shielded-corrupt-key',
      DecryptionError,
    ],
    [
      'a record that holds an xpub',
      () => Promise.resolve(new HDPrivateKey().deriveNonCompliantChild(0).xpubkey),
      'shielded-corrupt-key',
      undefined,
    ],
  ])('throws a typed ShieldedKeyError for %s', async (_name, unlock, errorCode, causeType) => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({ shielded_outputs: [so], outputs: [] });
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockImplementation(unlock),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const provider = makeMockProvider();

    let error: any;
    try {
      await processShieldedOutputs(storage, tx, provider, 'pin');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ShieldedKeyError);
    expect(error.errorCode).toBe(errorCode);
    // The decryption errors carry no key, so they are kept; a parse error is not.
    expect(error.cause?.constructor).toBe(causeType);
    expect(`${error.message} ${error.stack}`).not.toMatch(/htpr|tnpr|xprv|xpub/);
    expect(provider.rewindAmountShieldedOutput).not.toHaveBeenCalled();
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it('does not unlock the key for a tx without an output of the wallet', async () => {
    const tx = makeHistoryTx({ shielded_outputs: [makeShieldedOutput()], outputs: [] });
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(false),
      getAddressInfo: jest.fn(),
      getScanXPrivKey: jest.fn().mockRejectedValue(new InvalidPasswdError()),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    await expect(processShieldedOutputs(storage, tx, makeMockProvider(), 'wrong')).resolves.toEqual(
      []
    );
    expect(storage.getScanXPrivKey).not.toHaveBeenCalled();
  });

  it('zeroes each child key after its rewind', async () => {
    const tx = makeHistoryTx({
      shielded_outputs: [
        makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr1' } }),
        makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr2' } }),
      ],
      outputs: [],
    });
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockImplementation(async (addr: string) => ({
        bip32AddressIndex: addr === 'addr1' ? 0 : 1,
      })),
      getScanXPrivKey: jest
        .fn()
        .mockResolvedValue(new HDPrivateKey().deriveNonCompliantChild(0).xprivkey),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const keysSeen: Buffer[] = [];
    const keysAtRewind: string[] = [];
    let calls = 0;
    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest.fn().mockImplementation(async (privkey: Buffer) => {
        keysSeen.push(privkey);
        keysAtRewind.push(privkey.toString('hex'));
        calls += 1;
        if (calls === 2) {
          throw new Error('decryption failed');
        }
        return { value: 10n, blindingFactor: Buffer.alloc(32, 1) };
      }),
    });

    await processShieldedOutputs(storage, tx, provider, 'pin');

    expect(keysSeen).toHaveLength(2);
    for (const [i, key] of keysSeen.entries()) {
      expect(keysAtRewind[i]).not.toEqual('00'.repeat(32));
      expect(key).toEqual(Buffer.alloc(32));
    }
  });

  it('decodes with the key its PIN unlocks, not with the session of the storage', async () => {
    const sessionKey = new HDPrivateKey().deriveNonCompliantChild(0);
    const pinKey = new HDPrivateKey().deriveNonCompliantChild(0);
    const expectedChild = pinKey.deriveChild(0).privateKey.toBuffer().toString('hex');
    const tx = makeHistoryTx({
      shielded_outputs: [makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr1' } })],
      outputs: [],
    });
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(pinKey.xprivkey),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;
    const session = shieldedSessionOf(storage);
    session.open();
    session.fill(keyMaterialFromExtendedKey(sessionKey), session.epoch);
    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest.fn().mockImplementation(async (privkey: Buffer) => {
        if (privkey.toString('hex') !== expectedChild) {
          throw new Error('decryption failed');
        }
        return { value: 40n, blindingFactor: Buffer.alloc(32, 3) };
      }),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');

    expect(result).toHaveLength(1);
    expect(tx.shielded_outputs![0].value).toBe(40n);
    expect(storage.getScanXPrivKey).toHaveBeenCalledWith('pin');

    // A wrong PIN still throws while the session holds a key.
    storage.getScanXPrivKey.mockRejectedValue(new InvalidPasswdError());
    const other = makeHistoryTx({ shielded_outputs: [makeShieldedOutput()], outputs: [] });
    await expect(processShieldedOutputs(storage, other, provider, 'wrong')).rejects.toMatchObject({
      errorCode: 'shielded-wrong-pin',
    });
    session.close();
  }, 30000);

  it('should skip output when rewind throws and log debug message', async () => {
    const so = makeShieldedOutput();
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [],
    });

    // Mock a valid scan xpriv so key derivation succeeds and rewind is actually called.
    // A real xpriv at depth 1 (chain-level) so deriveNonCompliantChild(index) works
    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;

    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
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
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it('should write decoded fields IN PLACE for an owned AmountShielded output', async () => {
    // One transparent output ahead of the shielded slot, so the absolute
    // on-chain index of shielded_outputs[0] is T + 0 = 1.
    const so = makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr1' } });
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [{ value: 5n } as any],
    });

    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;
    const bf = Buffer.alloc(32, 0x07);

    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest.fn().mockResolvedValue({ value: 100n, blindingFactor: bf }),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');

    // Decoded fields are written IN PLACE on tx.shielded_outputs[0].
    const written = tx.shielded_outputs![0];
    expect(written.value).toBe(100n);
    expect(written.token).toBe(NATIVE_TOKEN_UID);
    expect(written.blindingFactor).toBe(bf.toString('hex'));
    expect(written.assetBlindingFactor).toBeUndefined();
    expect(written.decoded.address).toBe('addr1');

    // Report carries the ABSOLUTE on-chain index (T + s = 1 + 0).
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
    expect(result[0].address).toBe('addr1');
    expect(result[0].decrypted.value).toBe(100n);
  });

  it('should leave the slot non-owned when recovered value <= 0', async () => {
    const so = makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr1' } });
    const tx = makeHistoryTx({
      shielded_outputs: [so],
      outputs: [],
    });

    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;
    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest
        .fn()
        .mockResolvedValue({ value: 0n, blindingFactor: Buffer.alloc(32) }),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toEqual([]);
    expect(storage.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('returned non-positive value 0')
    );
    expect(storage.logger.warn).toHaveBeenCalledTimes(1);
    expect(storage.logger.warn).toHaveBeenCalledWith(
      `Shielded outputs of the wallet in tx ${tx.tx_id} could not be decoded: ` +
        '0 locked, 1 unreadable, 0 in error'
    );
    // value stays undefined → the slot is excluded by the ownership gate.
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it('should process multiple shielded outputs and decode only the decryptable owned ones', async () => {
    const so1 = makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr1' } });
    const so2 = makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr2' } });
    const so3 = makeShieldedOutput({ decoded: { type: 'P2PKH', address: 'addr3' } });

    const tx = makeHistoryTx({
      shielded_outputs: [so1, so2, so3],
      outputs: [{ value: 5n } as any],
    });

    // addr1 is ours and succeeds, addr2 is unknown, addr3 is ours but rewind fails
    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;

    const storage = {
      isAddressMine: jest
        .fn()
        .mockImplementation(async (addr: string) => addr === 'addr1' || addr === 'addr3'),
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
          return { value: 100n, blindingFactor: Buffer.alloc(32, 0x01) };
        }
        throw new Error('decryption failed');
      }),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    // Only addr1 (shielded slot 0) succeeded.
    expect(result).toHaveLength(1);
    expect(result[0].address).toBe('addr1');
    expect(result[0].decrypted.value).toBe(100n);
    expect(result[0].index).toBe(1); // T=1 + s=0

    // In place: slot 0 owned, slots 1 and 2 stay non-owned.
    expect(tx.shielded_outputs![0].value).toBe(100n);
    expect(tx.shielded_outputs![1].value).toBeUndefined();
    expect(tx.shielded_outputs![2].value).toBeUndefined();

    // Ownership is checked via isAddressMine for all 3; getAddressInfo (for the
    // derivation index) is only fetched for the owned addresses (addr1, addr3).
    expect(storage.isAddressMine).toHaveBeenCalledWith('addr1');
    expect(storage.isAddressMine).toHaveBeenCalledWith('addr2');
    expect(storage.isAddressMine).toHaveBeenCalledWith('addr3');
    expect(storage.getAddressInfo).toHaveBeenCalledWith('addr1');
    expect(storage.getAddressInfo).not.toHaveBeenCalledWith('addr2');
    expect(storage.getAddressInfo).toHaveBeenCalledWith('addr3');
    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledTimes(2);
  });

  it('should write FullShielded fields in place when the token cross-check passes', async () => {
    const so = makeShieldedOutput({
      mode: ShieldedOutputMode.FULLY_SHIELDED,
      asset_commitment: 'dd'.repeat(33),
      decoded: { type: 'P2PKH', address: 'addr1' },
    });
    const tx = makeHistoryTx({ shielded_outputs: [so], outputs: [] });

    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;
    const matchingAc = Buffer.from('dd'.repeat(33), 'hex');
    const abf = Buffer.alloc(32, 0x04);

    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider({
      rewindFullShieldedOutput: jest.fn().mockResolvedValue({
        value: 100n,
        blindingFactor: Buffer.alloc(32, 0x02),
        tokenUid: '03'.repeat(32),
        assetBlindingFactor: abf,
      }),
      deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x05)),
      // Return the SAME commitment as on-chain — cross-check passes.
      createAssetCommitment: jest.fn().mockResolvedValue(matchingAc),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    expect(result).toHaveLength(1);

    const written = tx.shielded_outputs![0];
    expect(written.value).toBe(100n);
    expect(written.token).toBe('03'.repeat(32));
    expect(written.assetBlindingFactor).toBe(abf.toString('hex'));
    expect(written.mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
  });

  it('should reject (skip) a FullShielded output when the asset-commitment cross-check fails', async () => {
    const so = makeShieldedOutput({
      mode: ShieldedOutputMode.FULLY_SHIELDED,
      asset_commitment: 'dd'.repeat(33),
      decoded: { type: 'P2PKH', address: 'addr1' },
    });
    const tx = makeHistoryTx({ shielded_outputs: [so], outputs: [] });

    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;

    const storage = {
      isAddressMine: jest.fn().mockResolvedValue(true),
      getAddressInfo: jest.fn().mockResolvedValue({ bip32AddressIndex: 0 }),
      getScanXPrivKey: jest.fn().mockResolvedValue(mockXpriv),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as any;

    const provider = makeMockProvider({
      rewindFullShieldedOutput: jest.fn().mockResolvedValue({
        value: 100n,
        blindingFactor: Buffer.alloc(32, 0x02),
        tokenUid: '03'.repeat(32),
        assetBlindingFactor: Buffer.alloc(32, 0x04),
      }),
      deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x05)),
      // Return a DIFFERENT commitment than on-chain — cross-check fails.
      createAssetCommitment: jest.fn().mockResolvedValue(Buffer.alloc(33, 0xff)),
    });

    const result = await processShieldedOutputs(storage, tx, provider, 'pin');
    // Cross-check failed: the output is rejected and NOT written in place.
    expect(result).toEqual([]);
    expect(tx.shielded_outputs![0].value).toBeUndefined();
    expect(provider.rewindFullShieldedOutput).toHaveBeenCalled();
    // The output's detail is logged at debug level, like every other output
    // that does not open, and the tx's undecoded outputs at warn level.
    expect(storage.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('cross-check failed')
    );
    const detail = (storage.logger.debug as jest.Mock).mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('cross-check failed')
    )![0] as string;
    expect(detail).toMatch(/recovered tokenUid=[0-9a-f]+/);
    expect(detail).toMatch(/on-chain assetCommitment=[0-9a-f]+/);
    expect(detail).toMatch(/expected assetCommitment=[0-9a-f]+/);
    expect(storage.logger.warn).toHaveBeenCalledTimes(1);
    expect(storage.logger.warn).toHaveBeenCalledWith(
      `Shielded outputs of the wallet in tx ${tx.tx_id} could not be decoded: ` +
        '0 locked, 1 unreadable, 0 in error'
    );
    expect(storage.logger.error).not.toHaveBeenCalled();
  });
});

describe('decodeShieldedOutputs — what happens to each of the wallet outputs', () => {
  const OWNED = ['own0', 'own1', 'own2', 'own3', 'own4'];

  function makeStorage(overrides: Record<string, unknown> = {}) {
    return {
      isAddressMine: jest.fn().mockImplementation(async (addr: string) => OWNED.includes(addr)),
      getAddressInfo: jest
        .fn()
        .mockImplementation(async (addr: string) => ({ bip32AddressIndex: OWNED.indexOf(addr) })),
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
      ...overrides,
    } as any;
  }

  function keysWith(derive: (index: number) => Buffer = () => Buffer.alloc(32, 7)) {
    return {
      getSource: jest.fn().mockResolvedValue({ derive: jest.fn(derive) }),
      assertCurrent: jest.fn(),
    };
  }

  // Two transparent outputs, so shielded output s is at on-chain index 2 + s.
  function makeTx(outputs: IHistoryShieldedOutput[]) {
    return makeHistoryTx({
      shielded_outputs: outputs,
      outputs: [{ value: 1n } as any, { value: 2n } as any],
    });
  }

  const at = (address: string, overrides: Partial<IShieldedOutput> = {}) =>
    makeShieldedOutput({ decoded: { type: 'P2PKH', address }, ...overrides });

  it('sorts each output of the wallet into decoded, unreadable and ignored', async () => {
    const tx = makeTx([
      at('own0', { commitment: '01'.repeat(33) }), // decodes
      at('foreign'), // not the wallet's: in no list
      at('own1', { commitment: '02'.repeat(33) }), // the rewind throws
      at('own2', { commitment: '03'.repeat(33) }), // a non-positive value
      at('own3', { ephemeral_pubkey: undefined }), // cannot be rewound: ignored
      at('own4', { commitment: '04'.repeat(33), token_data: 9 }), // a malformed token index
    ]);
    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest
        .fn()
        .mockImplementation(async (_k, _e, commitment: Buffer) => {
          if (commitment[0] === 0x01) return { value: 5n, blindingFactor: Buffer.alloc(32, 9) };
          if (commitment[0] === 0x03) return { value: 0n, blindingFactor: Buffer.alloc(32) };
          throw new Error('decryption failed');
        }),
    });

    const outcome = await decodeShieldedOutputs(makeStorage(), tx, provider, keysWith());

    expect(outcome.decoded.map(output => output.index)).toEqual([2]);
    expect(outcome.locked).toEqual([]);
    expect(outcome.unreadable).toEqual([4, 5, 7]);
    expect(outcome.error).toEqual([]);
    expect(outcome.failure).toBeNull();
    expect(tx.shielded_outputs![0].value).toBe(5n);
    expect(tx.shielded_outputs!.slice(1).every(output => output.value === undefined)).toBe(true);
  });

  it.each([
    ['there is no key provider', () => null],
    [
      'no key is available',
      () => ({ getSource: jest.fn().mockResolvedValue(null), assertCurrent: jest.fn() }),
    ],
  ])('counts the outputs of the wallet as locked when %s', async (_name, makeKeys) => {
    const tx = makeTx([at('own0'), at('foreign'), at('own1')]);

    const outcome = await decodeShieldedOutputs(makeStorage(), tx, makeMockProvider(), makeKeys());

    expect(outcome.locked).toEqual([2, 4]);
    expect(outcome.decoded).toEqual([]);
    expect(outcome.unreadable).toEqual([]);
    expect(outcome.failure).toBeNull();
  });

  it('counts the outputs of the wallet as locked, and asks for no key, without a crypto provider', async () => {
    const keys = keysWith();
    const tx = makeTx([at('own0'), at('foreign'), at('own1')]);

    const outcome = await decodeShieldedOutputs(makeStorage(), tx, null, keys);

    expect(outcome.locked).toEqual([2, 4]);
    expect(outcome.decoded).toEqual([]);
    expect(keys.getSource).not.toHaveBeenCalled();
  });

  it('asks for no key when no output is the wallet', async () => {
    const keys = keysWith();
    const outcome = await decodeShieldedOutputs(
      makeStorage(),
      makeTx([at('foreign'), at('other')]),
      makeMockProvider(),
      keys
    );
    expect(keys.getSource).not.toHaveBeenCalled();
    expect(outcome).toEqual({ decoded: [], locked: [], unreadable: [], error: [], failure: null });
  });

  it('counts an output of the wallet without an address index as unreadable', async () => {
    const storage = makeStorage({ getAddressInfo: jest.fn().mockResolvedValue(null) });
    const outcome = await decodeShieldedOutputs(
      storage,
      makeTx([at('own0')]),
      makeMockProvider(),
      keysWith()
    );
    expect(outcome.unreadable).toEqual([2]);
  });

  it('zeroes the child key of an output whose fields cannot be read, and counts only it unreadable', async () => {
    const children: Buffer[] = [];
    const keys = keysWith(() => {
      const child = Buffer.alloc(32, 7);
      children.push(child);
      return child;
    });
    // An output of the wallet without its range proof, as a store that is not
    // the lib's can hand out, before an output that opens.
    const tx = makeTx([
      at('own0', { range_proof: undefined as unknown as string }),
      at('own1', { commitment: '01'.repeat(33) }),
    ]);
    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest
        .fn()
        .mockResolvedValue({ value: 5n, blindingFactor: Buffer.alloc(32, 9) }),
    });

    const outcome = await decodeShieldedOutputs(makeStorage(), tx, provider, keys);

    expect(children).toHaveLength(2);
    expect(children.every(child => child.equals(Buffer.alloc(32)))).toBe(true);
    expect(outcome.failure).toBeNull();
    expect(outcome.unreadable).toEqual([2]);
    expect(outcome.decoded.map(output => output.index)).toEqual([3]);
  });

  it('counts an output whose child key cannot be derived as unreadable', async () => {
    const outcome = await decodeShieldedOutputs(
      makeStorage(),
      makeTx([at('own0'), at('own1')]),
      makeMockProvider({
        rewindAmountShieldedOutput: jest
          .fn()
          .mockResolvedValue({ value: 3n, blindingFactor: Buffer.alloc(32, 1) }),
      }),
      keysWith(index => {
        if (index === 0) {
          throw new Error('Invalid non-hardened index: 0');
        }
        return Buffer.alloc(32, 7);
      })
    );
    expect(outcome.unreadable).toEqual([2]);
    expect(outcome.decoded.map(output => output.index)).toEqual([3]);
  });

  it('reports an unexpected key failure on every output of the wallet', async () => {
    const failure = new Error('store read failed');
    const keys = { getSource: jest.fn().mockRejectedValue(failure), assertCurrent: jest.fn() };
    const tx = makeTx([at('own0'), at('foreign'), at('own1')]);

    const outcome = await decodeShieldedOutputs(makeStorage(), tx, makeMockProvider(), keys);

    expect(outcome.failure).toEqual({ cause: failure });
    expect(outcome.error).toEqual([2, 4]);
    expect(outcome.decoded).toEqual([]);
    expect(outcome.locked).toEqual([]);
  });

  it('reports a store failure during the ownership check on the outputs not ruled out', async () => {
    const failure = new Error('IndexedDB read failed');
    const storage = makeStorage({
      isAddressMine: jest.fn().mockImplementation(async (addr: string) => {
        if (addr === 'own1') {
          throw failure;
        }
        return OWNED.includes(addr);
      }),
    });
    const keys = keysWith();
    // own0 is the wallet's and foreign is not, both checked before the failure;
    // own1 and own2 are not checked.
    const tx = makeTx([at('own0'), at('foreign'), at('own1'), at('own2')]);

    const outcome = await decodeShieldedOutputs(storage, tx, makeMockProvider(), keys);

    expect(outcome.failure).toEqual({ cause: failure });
    expect(outcome.error).toEqual([2, 4, 5]);
    expect(keys.getSource).not.toHaveBeenCalled();
  });

  it('lets a closed session end the pass', async () => {
    const keys = keysWith(() => {
      throw new SessionClosedError();
    });
    const tx = makeTx([at('own0')]);
    await expect(
      decodeShieldedOutputs(makeStorage(), tx, makeMockProvider(), keys)
    ).rejects.toBeInstanceOf(SessionClosedError);
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  });

  it('writes nothing when its session was closed while the outputs were decoded', async () => {
    const keys = keysWith();
    keys.assertCurrent.mockImplementation(() => {
      throw new SessionClosedError();
    });
    const provider = makeMockProvider({
      rewindAmountShieldedOutput: jest
        .fn()
        .mockResolvedValue({ value: 3n, blindingFactor: Buffer.alloc(32, 1) }),
    });
    const tx = makeTx([at('own0'), at('own1')]);

    await expect(decodeShieldedOutputs(makeStorage(), tx, provider, keys)).rejects.toBeInstanceOf(
      SessionClosedError
    );

    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledTimes(2);
    expect(tx.shielded_outputs!.every(output => output.value === undefined)).toBe(true);
  });

  it('skips the outputs a previous pass decoded', async () => {
    const decoded = at('own0', { value: 9n, token: NATIVE_TOKEN_UID } as any);
    const keys = keysWith();
    const outcome = await decodeShieldedOutputs(
      makeStorage(),
      makeTx([decoded]),
      makeMockProvider(),
      keys
    );
    expect(outcome).toEqual({ decoded: [], locked: [], unreadable: [], error: [], failure: null });
    expect(keys.getSource).not.toHaveBeenCalled();
  });
});
