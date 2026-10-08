/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { WalletServiceSendStorage } from '../../src/wallet/walletServiceSendStorage';
import Network from '../../src/models/network';
import config from '../../src/config';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import transactionUtils from '../../src/utils/transaction';
import { decryptData } from '../../src/utils/crypto';
import { SendTxError, WalletError } from '../../src/errors';
import { IStorage, IWalletAccessData, TokenVersion, WalletType } from '../../src/types';
import { IShieldedCryptoProvider } from '../../src/shielded/types';
import { NATIVE_TOKEN_UID, NATIVE_TOKEN_UID_HEX } from '../../src/constants';
import { FullNodeTxResponse, Utxo } from '../../src/wallet/types';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  legacyFixtureAddress,
  buildShieldedNewAddressesResponse,
  buildShieldedTxOutputEntry,
  buildTransparentTxOutputEntry,
} from '../__mock_helpers__/shielded-ws.fixtures';

const network = new Network('testnet');
const PIN = '1234';
const customToken = 'cd'.repeat(32);
const bf = (byte: number) => Buffer.alloc(32, byte);

let accessData: IWalletAccessData;

beforeAll(() => {
  accessData = walletUtils.generateAccessDataFromSeed(shieldedFixtureSeed, {
    networkName: 'testnet',
    password: 'password',
    pin: PIN,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Shape a fixture entry the way the parsed API response delivers it. */
const parsed = (entry: Record<string, unknown>): Utxo =>
  ({ ...entry, value: BigInt(entry.value as number), authorities: 0n }) as unknown as Utxo;

const transparentUtxo = (overrides: Partial<Record<string, unknown>> = {}) =>
  parsed({ ...buildTransparentTxOutputEntry(), ...overrides });

const shieldedUtxo = (overrides: Parameters<typeof buildShieldedTxOutputEntry>[0] = {}) =>
  parsed(buildShieldedTxOutputEntry(overrides));

function makeProvider(): IShieldedCryptoProvider {
  return {
    rewindAmountShieldedOutput: jest.fn().mockImplementation(async () => ({
      value: 150n,
      blindingFactor: bf(1),
    })),
    rewindFullShieldedOutput: jest.fn().mockImplementation(async () => ({
      value: 150n,
      blindingFactor: bf(2),
      assetBlindingFactor: bf(3),
      tokenUid: NATIVE_TOKEN_UID_HEX,
    })),
    deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(33, 4)),
    // Matches the fixture's assetCommitment ('0a' padded with 'f')
    createAssetCommitment: jest.fn().mockResolvedValue(Buffer.from('0a'.padEnd(66, 'f'), 'hex')),
  } as unknown as IShieldedCryptoProvider;
}

async function setup({ pools = {} }: { pools?: { transparent?: Utxo[]; shielded?: Utxo[] } } = {}) {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(accessData);
  const provider = makeProvider();
  storage.setShieldedCryptoProvider(provider);
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed: shieldedFixtureSeed,
    network,
    storage,
  });
  wallet.setState('Ready');
  (wallet as unknown as { shieldedEnabled: boolean }).shieldedEnabled = true;
  jest
    .spyOn(walletApi, 'getShieldedNewAddresses')
    .mockResolvedValue(buildShieldedNewAddressesResponse());
  await (wallet as unknown as { getNewAddresses: () => Promise<void> }).getNewAddresses();

  const txOutputsSpy = jest
    .spyOn(walletApi, 'getTxOutputs')
    .mockImplementation(async (_w, options = {}) => {
      if (options.txId !== undefined) {
        const all = [...(pools.transparent ?? []), ...(pools.shielded ?? [])];
        return {
          success: true,
          txOutputs: all.filter(u => u.txId === options.txId && u.index === options.index),
        };
      }
      const pool = options.kind === 'shielded' ? pools.shielded : pools.transparent;
      return {
        success: true,
        txOutputs: (pool ?? []).filter(u => u.tokenId === (options.tokenId ?? '00')),
      };
    });

  const adapter = new WalletServiceSendStorage(wallet, PIN);
  return { wallet, storage, provider, adapter, proxy: adapter.createProxy(), txOutputsSpy };
}

const collect = async <T>(gen: AsyncGenerator<T>) => {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
};

describe('skeleton', () => {
  it('reports the wallet network even when the global config is on another one', async () => {
    const { proxy } = await setup();
    const previous = config.getNetwork().name;
    config.setNetwork('mainnet');
    try {
      expect(proxy.config.getNetwork().name).toBe('testnet');
    } finally {
      config.setNetwork(previous);
    }
  });

  it('delegates availability and wallet type to the wallet-service', async () => {
    const { proxy, provider, storage } = await setup();
    await expect(proxy.getCurrentHeight()).resolves.toBe(0);
    expect(proxy.version?.reward_spend_min_blocks).toBe(0);
    await expect(proxy.isUtxoSelectedAsInput({ txId: 'tx', index: 0 })).resolves.toBe(false);
    await expect(proxy.getWalletType()).resolves.toBe(WalletType.P2PKH);
    expect(proxy.shieldedCryptoProvider).toBe(provider);
    expect(proxy.getShieldedCryptoProvider()).toBe(provider);
    await expect(proxy.getScanXPubKey()).resolves.toBe(await storage.getScanXPubKey());
    await expect(proxy.getSpendXPubKey()).resolves.toBe(await storage.getSpendXPubKey());
  });

  it('refuses members it does not support, naming them', async () => {
    const { proxy } = await setup();
    expect(() => (proxy as IStorage).getAllUtxos).toThrow(/getAllUtxos/);
  });

  it('counts the unused shielded addresses as the store shielded address count', async () => {
    const { proxy, wallet } = await setup();
    await expect(proxy.store.addressCount({ legacy: false })).resolves.toBe(3);
    (wallet as unknown as { newShieldedAddresses: unknown[] }).newShieldedAddresses = [];
    await expect(proxy.store.addressCount({ legacy: false })).resolves.toBe(0);
    await expect(proxy.store.addressCount()).rejects.toThrow(/not supported/);
  });

  it('records the members used', async () => {
    const { proxy, adapter } = await setup();
    await proxy.getCurrentHeight();
    expect(adapter.accessedMembers()).toContain('getCurrentHeight');
  });
});

describe('utxo pools', () => {
  it('fetches one transparent pool, unspent and unlocked, without touching the shielded one', async () => {
    const { proxy, txOutputsSpy } = await setup({ pools: { transparent: [transparentUtxo()] } });
    const utxos = await collect(proxy.selectUtxos({ token: NATIVE_TOKEN_UID, shielded: false }));
    expect(utxos).toHaveLength(1);
    expect(utxos[0]).toEqual({
      txId: transparentUtxo().txId,
      index: 0,
      token: NATIVE_TOKEN_UID,
      address: legacyFixtureAddress,
      value: 100n,
      authorities: 0n,
      timelock: null,
      type: expect.any(Number),
      height: null,
    });
    await collect(proxy.selectUtxos({ token: NATIVE_TOKEN_UID, shielded: false }));
    expect(txOutputsSpy).toHaveBeenCalledTimes(1);
    expect(txOutputsSpy.mock.calls[0][1]).toEqual({
      tokenId: NATIVE_TOKEN_UID,
      kind: 'transparent',
      skipSpent: true,
      ignoreLocked: true,
      authority: 0n,
      maxOutputs: 255,
    });
  });

  it('rewinds shielded utxos when their pool is fetched', async () => {
    const { proxy, provider } = await setup({
      pools: {
        shielded: [
          shieldedUtxo({ mode: 1, index: 5, shieldedIndex: 1 }),
          shieldedUtxo({ mode: 2, index: 6, shieldedIndex: 2 }),
        ],
      },
    });
    const utxos = await collect(proxy.selectUtxos({ shielded: true }));
    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledTimes(1);
    expect(provider.rewindFullShieldedOutput).toHaveBeenCalledTimes(1);
    const [amountShielded, fullShielded] = utxos;
    expect(amountShielded).toMatchObject({
      shielded: true,
      value: 150n,
      blindingFactor: bf(1).toString('hex'),
      address: shieldedFixtureAddresses[1].spendBase58,
    });
    expect(amountShielded.assetBlindingFactor).toBeUndefined();
    expect(fullShielded).toMatchObject({
      shielded: true,
      blindingFactor: bf(2).toString('hex'),
      assetBlindingFactor: bf(3).toString('hex'),
    });
  });

  it('rewinds with the scan key of the utxo address index', async () => {
    const { proxy, provider } = await setup({
      pools: { shielded: [shieldedUtxo({ mode: 1, shieldedIndex: 2 })] },
    });
    // The adapter zeroes the key after the rewind, so copy it when it is used
    const keys: Buffer[] = [];
    const rewind = provider.rewindAmountShieldedOutput as jest.Mock;
    const original = rewind.getMockImplementation()!;
    rewind.mockImplementation(async (key: Buffer, ...rest: unknown[]) => {
      keys.push(Buffer.from(key));
      return original(key, ...rest);
    });
    await collect(proxy.selectUtxos({ shielded: true }));
    const scan = new HDPrivateKey(decryptData(accessData.scanMainKey!, PIN));
    expect(keys[0]).toEqual(scan.deriveChild(2).privateKey.toBuffer({ size: 32 }));
    expect(rewind.mock.calls[0][4]).toEqual(Buffer.from(NATIVE_TOKEN_UID_HEX, 'hex'));
    // ...and does not keep it around
    expect(rewind.mock.calls[0][0]).toEqual(Buffer.alloc(32));
  });

  it('fails when the rewound value differs from the server value', async () => {
    const { proxy } = await setup({
      pools: { shielded: [shieldedUtxo({ mode: 1, value: 999 })] },
    });
    await expect(collect(proxy.selectUtxos({ shielded: true }))).rejects.toThrow(SendTxError);
  });

  it('merges both pools, filters and orders them', async () => {
    const { proxy } = await setup({
      pools: {
        transparent: [
          transparentUtxo({ index: 0, value: 100 }),
          transparentUtxo({ index: 1, value: 20 }),
        ],
        shielded: [shieldedUtxo({ mode: 1, index: 5 })],
      },
    });
    const asc = await collect(proxy.selectUtxos({ order_by_value: 'asc' }));
    expect(asc.map(u => u.value)).toEqual([20n, 100n, 150n]);
    const desc = await collect(proxy.selectUtxos({ order_by_value: 'desc', max_utxos: 2 }));
    expect(desc.map(u => u.value)).toEqual([150n, 100n]);
    const filtered = await collect(
      proxy.selectUtxos({ filter_method: u => u.index !== 0, amount_bigger_than: 10n })
    );
    expect(filtered.map(u => u.index).sort()).toEqual([1, 5]);
  });

  it('keeps tokens apart', async () => {
    const { proxy, txOutputsSpy } = await setup({
      pools: { transparent: [transparentUtxo(), transparentUtxo({ tokenId: customToken })] },
    });
    const custom = await collect(proxy.selectUtxos({ token: customToken, shielded: false }));
    expect(custom).toHaveLength(1);
    expect(custom[0].token).toBe(customToken);
    expect(txOutputsSpy.mock.calls[0][1]).toMatchObject({ tokenId: customToken });
  });
});

describe('pool pagination', () => {
  /** The wallet-service query: value < smallerThan, largest first, at most maxOutputs. */
  const serverQuery =
    (pool: Utxo[]) =>
    async (_w: unknown, options: Record<string, unknown> = {}) => {
      const smallerThan =
        options.smallerThan === undefined ? undefined : BigInt(options.smallerThan as string);
      const rows = pool
        .filter(u => smallerThan === undefined || u.value < smallerThan)
        .sort((a, b) => Number(b.value - a.value))
        .slice(0, options.maxOutputs as number);
      return { success: true, txOutputs: rows };
    };

  it('reads a pool of more than 255 utxos completely, ties at page edges included', async () => {
    // 600 utxos with values 1..300, each value twice: every page edge falls on a tie
    const pool = Array.from({ length: 600 }, (_v, i) =>
      transparentUtxo({ index: i, value: 300 - Math.floor(i / 2) })
    );
    const { proxy, txOutputsSpy } = await setup();
    txOutputsSpy.mockImplementation(serverQuery(pool) as never);
    const utxos = await collect(proxy.selectUtxos({ shielded: false }));
    expect(utxos).toHaveLength(600);
    expect(new Set(utxos.map(u => u.index)).size).toBe(600);
    expect(txOutputsSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(txOutputsSpy.mock.calls[1][1]).toMatchObject({ maxOutputs: 255 });
  });

  it('gets past more than 255 utxos of the same value', async () => {
    const pool = [
      ...Array.from({ length: 300 }, (_v, i) => transparentUtxo({ index: i, value: 50 })),
      transparentUtxo({ index: 300, value: 10 }),
    ];
    const { proxy, txOutputsSpy } = await setup();
    txOutputsSpy.mockImplementation(serverQuery(pool) as never);
    const utxos = await collect(proxy.selectUtxos({ shielded: false }));
    // The small utxo below the oversized tie is still reached
    expect(utxos.map(u => u.index)).toContain(300);
  });

  it('skips shielded entries the wallet-service has not recovered', async () => {
    const { proxy } = await setup({
      pools: {
        shielded: [
          shieldedUtxo({ mode: 1, index: 5 }),
          { ...shieldedUtxo({ mode: 1, index: 6 }), recoveryState: 'pending' } as Utxo,
        ],
      },
    });
    const utxos = await collect(proxy.selectUtxos({ shielded: true }));
    expect(utxos.map(u => u.index)).toEqual([5]);
  });
});

describe('getUtxo', () => {
  it('returns a pooled utxo without another request', async () => {
    const { proxy, txOutputsSpy } = await setup({ pools: { transparent: [transparentUtxo()] } });
    await collect(proxy.selectUtxos({ shielded: false }));
    const utxo = await proxy.getUtxo({ txId: transparentUtxo().txId, index: 0 });
    expect(utxo?.value).toBe(100n);
    expect(txOutputsSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches and rewinds a utxo outside the pools', async () => {
    const entry = shieldedUtxo({ mode: 2, index: 6 });
    const { proxy } = await setup({ pools: { shielded: [entry] } });
    const utxo = await proxy.getUtxo({ txId: entry.txId, index: 6 });
    expect(utxo).toMatchObject({ shielded: true, assetBlindingFactor: bf(3).toString('hex') });
  });

  it('fails on a missing, locked or proposal-held utxo instead of returning null', async () => {
    const { proxy } = await setup({
      pools: {
        transparent: [
          transparentUtxo({ index: 1, locked: true }),
          transparentUtxo({ index: 2, txProposalId: 'other-proposal' }),
        ],
      },
    });
    const { txId } = transparentUtxo();
    await expect(proxy.getUtxo({ txId, index: 9 })).rejects.toThrow(SendTxError);
    await expect(proxy.getUtxo({ txId, index: 1 })).rejects.toThrow(/locked/);
    await expect(proxy.getUtxo({ txId, index: 2 })).rejects.toThrow(/proposal/);
  });

  it('remembers the derivation path of every utxo it hands out', async () => {
    const entry = shieldedUtxo({ mode: 1, index: 5, shieldedIndex: 1 });
    const { proxy, adapter } = await setup({
      pools: { transparent: [transparentUtxo()], shielded: [entry] },
    });
    await collect(proxy.selectUtxos({}));
    expect(adapter.getAddressPath(entry.txId, 5)).toBe("m/44'/280'/2'/0/1");
    expect(adapter.getAddressPath(transparentUtxo().txId, 0)).toBe("m/44'/280'/0'/0/5");
  });
});

describe('tokens and addresses', () => {
  it('describes HTR without a request and other tokens with their version', async () => {
    const { proxy } = await setup();
    const detailsSpy = jest.spyOn(walletApi, 'getTokenDetails').mockResolvedValue({
      success: true,
      details: {
        tokenInfo: { id: customToken, name: 'Fee', symbol: 'FEE', version: TokenVersion.FEE },
        totalSupply: 0n,
        totalTransactions: 0,
        authorities: { mint: false, melt: false },
      },
    });
    await expect(proxy.getToken(NATIVE_TOKEN_UID)).resolves.toMatchObject({
      uid: NATIVE_TOKEN_UID,
      version: TokenVersion.NATIVE,
    });
    await expect(proxy.getToken(customToken)).resolves.toEqual({
      uid: customToken,
      name: 'Fee',
      symbol: 'FEE',
      version: TokenVersion.FEE,
    });
    expect(detailsSpy).toHaveBeenCalledTimes(1);
  });

  it('gives the current address of each chain, one per send', async () => {
    const { proxy } = await setup();
    await expect(proxy.getCurrentAddress(false, { legacy: false })).resolves.toBe(
      shieldedFixtureAddresses[0].shieldedBase58
    );
    await expect(proxy.getCurrentAddress(true, { legacy: false })).resolves.toBe(
      shieldedFixtureAddresses[0].shieldedBase58
    );
    await expect(proxy.getChangeAddress()).resolves.toBe(legacyFixtureAddress);
    await expect(proxy.getCurrentAddress()).resolves.toBe(legacyFixtureAddress);
  });

  it('marks a current address used only when the transaction pays it', async () => {
    const { proxy, adapter, wallet } = await setup();
    await proxy.getCurrentAddress(false, { legacy: false });
    await proxy.getChangeAddress();
    // Reading the addresses (as the engine does while probing) uses none
    expect(wallet.getCurrentAddress({}, { legacy: false }).address).toBe(
      shieldedFixtureAddresses[0].shieldedBase58
    );
    adapter.markChangeAddressesUsed({
      inputs: [],
      outputs: [],
      tokens: [],
      shieldedOutputs: [{ address: shieldedFixtureAddresses[0].spendBase58 } as never],
    });
    // The shielded change was paid, the legacy one was not
    expect(wallet.getCurrentAddress({}, { legacy: false }).address).toBe(
      shieldedFixtureAddresses[1].shieldedBase58
    );
    expect(wallet.getCurrentAddress().address).toBe(legacyFixtureAddress);
  });

  it('keeps the reason when the wallet has no unused shielded address', async () => {
    const { wallet, proxy } = await setup();
    (wallet as unknown as { newShieldedAddresses: unknown[] }).newShieldedAddresses = [];
    await expect(proxy.getCurrentAddress(false, { legacy: false })).rejects.toThrow(
      /no unused shielded address/
    );
  });

  it('checks the ownership of an explicit change address', async () => {
    const { proxy, wallet } = await setup();
    const mine = jest.spyOn(wallet, 'isAddressMine').mockResolvedValueOnce(true);
    await expect(proxy.getChangeAddress({ changeAddress: legacyFixtureAddress })).resolves.toBe(
      legacyFixtureAddress
    );
    mine.mockResolvedValueOnce(false);
    await expect(proxy.getChangeAddress({ changeAddress: legacyFixtureAddress })).rejects.toThrow(
      'Change address is not from the wallet'
    );
    mine.mockResolvedValueOnce(true);
    await expect(proxy.isAddressMine(shieldedFixtureAddresses[0].shieldedBase58)).resolves.toBe(
      true
    );
  });
});

describe('getTx', () => {
  const ownedEntry = shieldedUtxo({ mode: 1, index: 2, shieldedIndex: 1 });

  const fullTx = (): FullNodeTxResponse =>
    ({
      success: true,
      tx: {
        hash: ownedEntry.txId,
        nonce: '0',
        timestamp: 1,
        version: 1,
        weight: 1,
        parents: [],
        inputs: [],
        outputs: [
          {
            value: 5n,
            token_data: 0,
            script: '',
            decoded: { type: 'P2PKH', address: legacyFixtureAddress },
          },
        ],
        shielded_outputs: [
          {
            mode: 1,
            commitment: 'aa',
            range_proof: 'bb',
            script: 'cc',
            token_data: 0,
            ephemeral_pubkey: 'dd',
            decoded: { type: 'P2PKH', address: shieldedFixtureAddresses[9].spendBase58 },
          },
          {
            mode: 1,
            commitment: 'aa',
            range_proof: 'bb',
            script: 'cc',
            token_data: 0,
            ephemeral_pubkey: 'dd',
            decoded: { type: 'P2PKH', address: shieldedFixtureAddresses[1].spendBase58 },
          },
        ],
        tokens: [],
        raw: '',
      },
      meta: {
        hash: ownedEntry.txId,
        received_by: [],
        children: [],
        conflict_with: [],
        first_block: null,
        height: 10,
        voided_by: [],
        spent_outputs: [],
        twins: [],
        accumulated_weight: 1,
        score: 1,
      },
    }) as unknown as FullNodeTxResponse;

  it('decorates the shielded outputs this wallet owns', async () => {
    const { proxy, wallet } = await setup({ pools: { shielded: [ownedEntry] } });
    jest.spyOn(wallet, 'getFullTxById').mockResolvedValue(fullTx());
    const tx = await proxy.getTx(ownedEntry.txId);
    expect(tx!.shielded_outputs![0].value).toBeUndefined();
    expect(tx!.shielded_outputs![1]).toMatchObject({
      value: 150n,
      token: NATIVE_TOKEN_UID,
      blindingFactor: bf(1).toString('hex'),
      decoded: { address: shieldedFixtureAddresses[1].spendBase58 },
    });
  });

  it('lets a decorated shielded input pass the availability check', async () => {
    const { proxy, wallet } = await setup({ pools: { shielded: [ownedEntry] } });
    jest.spyOn(wallet, 'getFullTxById').mockResolvedValue(fullTx());
    await expect(
      transactionUtils.canUseUtxo({ txId: ownedEntry.txId, index: 2 }, proxy)
    ).resolves.toBe(true);
  });

  it('returns null for a transaction the wallet-service does not know', async () => {
    const { proxy, wallet } = await setup();
    jest.spyOn(wallet, 'getFullTxById').mockRejectedValue(new WalletError('not found'));
    await expect(proxy.getTx('unknown')).resolves.toBeNull();
  });
});
