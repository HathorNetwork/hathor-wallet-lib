/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey, HDPublicKey } from 'bitcore-lib';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import { decryptData, verifyMessage } from '../../src/utils/crypto';
import { ShieldedNotEnabledError, WalletError } from '../../src/errors';
import { IWalletAccessData, TokenVersion } from '../../src/types';
import type { IShieldedCryptoProvider } from '../../src/shielded/types';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../src/constants';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  legacyFixtureAddress,
  buildShieldedAddressRow,
  buildShieldedNewAddressesResponse,
  buildSplitBalanceResponse,
  buildShieldedTxOutputEntry,
} from '../__mock_helpers__/shielded-ws.fixtures';
import { Utxo, WsTransaction } from '../../src/wallet/types';

const network = new Network('testnet');
const PIN = '1234';
const PASSWORD = 'password';

const statusResponse = (status = 'ready') => ({
  success: true,
  status: {
    walletId: 'id',
    xpubkey: 'xpub',
    status,
    maxGap: 20,
    createdAt: 0,
    readyAt: 0,
    shieldedMaxGap: 20,
    lastUsedShieldedIndex: null,
  },
});

const addressOf = (key: HDPrivateKey | HDPublicKey) =>
  key.publicKey.toAddress(network.getNetwork()).toString();

let createWalletSpy: jest.SpyInstance;
let pollSpy: jest.SpyInstance;

beforeEach(() => {
  pollSpy = jest
    .spyOn(HathorWalletServiceWallet.prototype, 'pollForWalletStatus')
    .mockImplementation(() => Promise.resolve());
  jest.spyOn(HathorWalletServiceWallet.prototype, 'setupConnection').mockImplementation(jest.fn());
  jest
    .spyOn(HathorWalletServiceWallet.prototype, 'renewAuthToken')
    .mockImplementation(async function mockRenew(this: HathorWalletServiceWallet) {
      this.authToken = 'mocked-token';
    });
  jest
    .spyOn(walletApi, 'getNewAddresses')
    .mockImplementation(() => Promise.resolve({ success: true, addresses: [] }));
  jest
    .spyOn(walletApi, 'getShieldedNewAddresses')
    .mockImplementation(() => Promise.resolve(buildShieldedNewAddressesResponse()));
  jest.spyOn(walletApi, 'getVersionData').mockRejectedValue(new Error('no version in tests'));
  createWalletSpy = jest
    .spyOn(walletApi, 'createWallet')
    .mockImplementation(() => Promise.resolve(statusResponse()));
});

afterEach(() => {
  jest.restoreAllMocks();
});

const buildSeedWallet = (storage = new Storage(new MemoryStore())) =>
  new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed: shieldedFixtureSeed,
    network,
    storage,
  });

/** Access data as a wallet created before shielded support would have stored it. */
const preShieldedAccessData = (): IWalletAccessData => {
  const accessData = walletUtils.generateAccessDataFromSeed(shieldedFixtureSeed, {
    networkName: 'testnet',
    password: PASSWORD,
    pin: PIN,
  });
  delete accessData.scanXpubkey;
  delete accessData.scanMainKey;
  delete accessData.spendXpubkey;
  delete accessData.spendMainKey;
  return accessData;
};

const rootKey = (): HDPrivateKey =>
  walletUtils.getXPrivKeyFromSeed(shieldedFixtureSeed, { networkName: 'testnet' });

/** Same key, regardless of the network version bytes it is encoded with. */
const sameKey = (a: string, b: HDPrivateKey | HDPublicKey) => {
  const parsed = a.startsWith('xpub') ? new HDPublicKey(a) : new HDPrivateKey(a);
  return (
    parsed.publicKey.toString() === b.publicKey.toString() &&
    parsed.toObject().chainCode === b.toObject().chainCode
  );
};

describe('signPayload', () => {
  it('signs timestamp + walletId + payload with the given key', () => {
    const key = rootKey().deriveChild("m/44'/280'/2'/0");
    const signature = HathorWalletServiceWallet.signPayload(key, 100, 'wallet-id', 'payload');
    expect(verifyMessage('100wallet-idpayload', signature, addressOf(key))).toBe(true);
  });

  it('keeps signMessage signing the signer address', () => {
    const wallet = buildSeedWallet();
    const key = rootKey().deriveChild("m/44'/280'/0'");
    const signature = wallet.signMessage(key, 100, 'wallet-id');
    expect(verifyMessage(`100wallet-id${addressOf(key)}`, signature, addressOf(key))).toBe(true);
  });
});

describe('shielded registration on start', () => {
  it('sends the shielded keys and proofs for a seed wallet', async () => {
    const wallet = buildSeedWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });

    expect(createWalletSpy).toHaveBeenCalledTimes(1);
    const args = createWalletSpy.mock.calls[0];
    const timestamp = args[5];
    const shielded = args[7];
    const walletId = HathorWalletServiceWallet.getWalletIdFromXPub(args[1]);

    const root = rootKey();
    const scanNode = root.deriveChild("m/44'/280'/1'/0");
    const spendNode = root.deriveChild("m/44'/280'/2'/0");
    // The wallet-service parses keys with the default (xprv/xpub) version bytes.
    expect(shielded.scanXpriv.startsWith('xprv')).toBe(true);
    expect(shielded.spendXpub.startsWith('xpub')).toBe(true);
    expect(sameKey(shielded.scanXpriv, scanNode)).toBe(true);
    expect(sameKey(shielded.spendXpub, spendNode.hdPublicKey)).toBe(true);
    expect(shielded.firstCtAddress).toBe(shieldedFixtureAddresses[0].shieldedBase58);

    expect(
      verifyMessage(
        `${timestamp}${walletId}${shielded.spendXpub}`,
        shielded.spendXpubSignature,
        addressOf(new HDPublicKey(shielded.spendXpub))
      )
    ).toBe(true);

    const authAddress = addressOf(new HDPublicKey(args[3]));
    expect(
      verifyMessage(
        `${timestamp}${walletId}${shielded.firstCtAddress}`,
        shielded.ctAddressSignature,
        authAddress
      )
    ).toBe(true);
    expect(addressOf(HathorWalletServiceWallet.deriveAuthPrivateKey(root))).toBe(authAddress);

    expect(wallet.isShieldedEnabled()).toBe(true);
  });

  it('never sends the spend private key', async () => {
    const wallet = buildSeedWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    const shielded = createWalletSpy.mock.calls[0][7];
    const accessData = await wallet.storage.getAccessData();
    const spendPriv = decryptData(accessData.spendMainKey!, PIN);
    expect(JSON.stringify(createWalletSpy.mock.calls[0])).not.toContain(spendPriv);
    expect(shielded.spendXpub.startsWith('xpub')).toBe(true);
  });

  it('polls an upgraded wallet until it is ready', async () => {
    createWalletSpy.mockImplementation(() => Promise.resolve(statusResponse('creating')));
    const wallet = buildSeedWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    expect(pollSpy).toHaveBeenCalledTimes(1);
  });

  it('does not poll a wallet already registered with the same keys', async () => {
    const wallet = buildSeedWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    expect(pollSpy).not.toHaveBeenCalled();
  });

  it('propagates registration errors', async () => {
    createWalletSpy.mockRejectedValue(new WalletError('boom'));
    const wallet = buildSeedWallet();
    await expect(wallet.start({ pinCode: PIN, password: PASSWORD })).rejects.toThrow('boom');
  });

  it('sends no shielded fields for an xpriv wallet', async () => {
    const root = rootKey();
    const wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      xpriv: root.deriveNonCompliantChild("m/44'/280'/0'").xprivkey,
      authxpriv: root.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH).xprivkey,
      network,
      storage: new Storage(new MemoryStore()),
    });
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    expect(createWalletSpy.mock.calls[0][7]).toBeNull();
    expect(wallet.isShieldedEnabled()).toBe(false);
  });

  it('reports shielded disabled before start', () => {
    expect(buildSeedWallet().isShieldedEnabled()).toBe(false);
  });

  it('clears the decrypted shielded keys after start', async () => {
    const wallet = buildSeedWallet();
    await wallet.start({ pinCode: PIN, password: PASSWORD });
    const accessData = await wallet.storage.getAccessData();
    const scanXpriv = decryptData(accessData.scanMainKey!, PIN);
    const strings = Object.values(wallet).filter(v => typeof v === 'string');
    expect(strings).not.toContain(scanXpriv);
  });
});

describe('stored access data without shielded keys', () => {
  it('migrates and saves the shielded keys when the password is given', async () => {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(preShieldedAccessData());
    const wallet = buildSeedWallet(storage);
    await wallet.start({ pinCode: PIN, password: PASSWORD });

    const saved = await storage.getAccessData();
    expect(saved.scanXpubkey).toBeDefined();
    expect(saved.spendXpubkey).toBeDefined();
    expect(
      sameKey(decryptData(saved.scanMainKey!, PIN), rootKey().deriveChild("m/44'/280'/1'/0"))
    ).toBe(true);
    expect(createWalletSpy.mock.calls[0][7]).not.toBeNull();
    expect(wallet.isShieldedEnabled()).toBe(true);
  });

  it('asks for the password when it is missing', async () => {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(preShieldedAccessData());
    const wallet = buildSeedWallet(storage);
    const err = await wallet.start({ pinCode: PIN }).catch(e => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err.message).toMatch(/password/i);
    expect(createWalletSpy).not.toHaveBeenCalled();
  });

  it('wraps a wrong password in a WalletError', async () => {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(preShieldedAccessData());
    const wallet = buildSeedWallet(storage);
    const err = await wallet.start({ pinCode: PIN, password: 'wrong' }).catch(e => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err.cause).toBeDefined();
    expect(createWalletSpy).not.toHaveBeenCalled();
  });

  it('starts a stored wallet that already has shielded keys without the password', async () => {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(
      walletUtils.generateAccessDataFromSeed(shieldedFixtureSeed, {
        networkName: 'testnet',
        password: PASSWORD,
        pin: PIN,
      })
    );
    const wallet = buildSeedWallet(storage);
    await wallet.start({ pinCode: PIN });
    expect(createWalletSpy.mock.calls[0][7]).not.toBeNull();
  });
});

describe('setShieldedCryptoProvider', () => {
  it('stores the provider on the wallet storage, and clears it', () => {
    const wallet = buildSeedWallet();
    const provider = { name: 'mock-provider' } as unknown as IShieldedCryptoProvider;
    wallet.setShieldedCryptoProvider(provider);
    expect(wallet.storage.getShieldedCryptoProvider()).toBe(provider);
    wallet.setShieldedCryptoProvider(undefined);
    expect(wallet.storage.shieldedCryptoProvider).toBeUndefined();
  });
});

/**
 * A wallet marked ready with shielded keys registered, without running the
 * (slow) seed derivation of start().
 */
const readyWallet = async ({ shielded = true, singleAddress = false } = {}) => {
  const storage = new Storage(new MemoryStore());
  // xpub-only access data is enough for these tests and skips seed derivation
  await storage.saveAccessData(
    walletUtils.generateAccessDataFromXpub(
      rootKey().deriveNonCompliantChild("m/44'/280'/0'").xpubkey
    )
  );
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed: shieldedFixtureSeed,
    network,
    storage,
    singleAddressMode: singleAddress,
  });
  wallet.setState('Ready');
  (wallet as unknown as { shieldedEnabled: boolean }).shieldedEnabled = shielded;
  await (wallet as unknown as { getNewAddresses: () => Promise<void> }).getNewAddresses();
  return wallet;
};

describe('address chain options', () => {
  const ct = (i: number) => shieldedFixtureAddresses[i].shieldedBase58;
  const spend = (i: number) => shieldedFixtureAddresses[i].spendBase58;

  beforeEach(() => {
    jest.spyOn(walletApi, 'getShieldedAddresses').mockResolvedValue({
      success: true,
      addresses: [buildShieldedAddressRow(0, 2), buildShieldedAddressRow(1)],
    });
    jest.spyOn(walletApi, 'getAddresses').mockResolvedValue({
      success: true,
      addresses: [{ address: legacyFixtureAddress, index: 0, transactions: 0 }],
    });
  });

  it('fills both unused-address lists from one request', async () => {
    const wallet = await readyWallet();
    expect(walletApi.getShieldedNewAddresses).toHaveBeenCalledTimes(1);
    expect(walletApi.getNewAddresses).not.toHaveBeenCalled();
    expect(wallet.getCurrentAddress().address).toBe(legacyFixtureAddress);
    expect(wallet.getCurrentAddress({}, { legacy: false })).toEqual({
      address: ct(0),
      spendAddress: spend(0),
      index: 0,
      addressPath: "m/44'/280'/2'/0/0",
    });
  });

  it('keeps legacy-only wallets on the legacy request', async () => {
    const wallet = await readyWallet({ shielded: false });
    expect(walletApi.getNewAddresses).toHaveBeenCalledTimes(1);
    expect(walletApi.getShieldedNewAddresses).not.toHaveBeenCalled();
    expect(() => wallet.getCurrentAddress({}, { legacy: false })).toThrow(ShieldedNotEnabledError);
  });

  it('moves the shielded cursor independently of the legacy one', async () => {
    const wallet = await readyWallet();
    expect(wallet.getNextAddress({ legacy: false }).address).toBe(ct(1));
    expect(wallet.getCurrentAddress({ markAsUsed: true }, { legacy: false }).address).toBe(ct(1));
    expect(wallet.getCurrentAddress({}, { legacy: false }).address).toBe(ct(2));
    // The legacy chain is untouched
    expect(wallet.getCurrentAddress().address).toBe(legacyFixtureAddress);
    wallet.getNextAddress();
    expect(wallet.getCurrentAddress({}, { legacy: false }).address).toBe(ct(2));
  });

  it('reports the gap limit past the last shielded address', async () => {
    const wallet = await readyWallet();
    wallet.getCurrentAddress({ markAsUsed: true }, { legacy: false });
    wallet.getCurrentAddress({ markAsUsed: true }, { legacy: false });
    wallet.getCurrentAddress({ markAsUsed: true }, { legacy: false });
    expect(wallet.getCurrentAddress({}, { legacy: false })).toMatchObject({
      address: ct(2),
      info: 'GAP_LIMIT_REACHED',
    });
  });

  it('fails clearly when the server has no unused shielded address', async () => {
    (walletApi.getShieldedNewAddresses as jest.Mock).mockResolvedValue({
      ...buildShieldedNewAddressesResponse([]),
    });
    const wallet = await readyWallet();
    expect(() => wallet.getCurrentAddress({}, { legacy: false })).toThrow(
      /no unused shielded address/
    );
  });

  it('refuses the shielded chain in single-address mode', async () => {
    const wallet = await readyWallet({ singleAddress: true });
    expect(() => wallet.getCurrentAddress({}, { legacy: false })).toThrow(/single-address mode/);
    expect(() => wallet.getNextAddress({ legacy: false })).toThrow(/single-address mode/);
  });

  it('lists the shielded addresses', async () => {
    const wallet = await readyWallet();
    const rows = [];
    for await (const row of wallet.getAllAddresses({ legacy: false })) {
      rows.push(row);
    }
    expect(rows.map(r => r.address)).toEqual([ct(0), ct(1)]);
    expect(rows[0]).toMatchObject({ spendAddress: spend(0), transactions: 2 });
    expect(walletApi.getAddresses).not.toHaveBeenCalled();
  });

  it('gets the shielded address at an index', async () => {
    (walletApi.getShieldedAddresses as jest.Mock).mockResolvedValue({
      success: true,
      addresses: [buildShieldedAddressRow(1)],
    });
    const wallet = await readyWallet();
    await expect(wallet.getAddressAtIndex(1, { legacy: false })).resolves.toBe(ct(1));
    expect(walletApi.getShieldedAddresses).toHaveBeenCalledWith(wallet, 1);
  });

  it('builds the spend-chain path for a shielded index', async () => {
    const wallet = await readyWallet();
    await expect(wallet.getAddressPathForIndex(7, { legacy: false })).resolves.toBe(
      "m/44'/280'/2'/0/7"
    );
    await expect(wallet.getAddressPathForIndex(7)).resolves.toBe("m/44'/280'/0'/0/7");
  });

  it('refuses every shielded address method on a legacy-only wallet', async () => {
    const wallet = await readyWallet({ shielded: false });
    await expect(wallet.getAddressAtIndex(0, { legacy: false })).rejects.toThrow(
      ShieldedNotEnabledError
    );
    await expect(wallet.getAddressPathForIndex(0, { legacy: false })).rejects.toThrow(
      ShieldedNotEnabledError
    );
    await expect(wallet.getAllAddresses({ legacy: false }).next()).rejects.toThrow(
      ShieldedNotEnabledError
    );
    expect(() => wallet.getNextAddress({ legacy: false })).toThrow(ShieldedNotEnabledError);
  });
});

describe('address lookups accept shielded addresses', () => {
  const ct = (i: number) => shieldedFixtureAddresses[i].shieldedBase58;
  const spend = (i: number) => shieldedFixtureAddresses[i].spendBase58;

  it('checks ownership of the on-chain spend address', async () => {
    const wallet = await readyWallet();
    const checkSpy = jest.spyOn(walletApi, 'checkAddressesMine').mockResolvedValue({
      success: true,
      addresses: { [spend(0)]: true, [legacyFixtureAddress]: false },
    });
    await expect(wallet.checkAddressesMine([ct(0), legacyFixtureAddress])).resolves.toEqual({
      [ct(0)]: true,
      [legacyFixtureAddress]: false,
    });
    expect(checkSpy).toHaveBeenCalledWith(wallet, [spend(0), legacyFixtureAddress]);
    await expect(wallet.isAddressMine(ct(0))).resolves.toBe(true);
  });

  it('looks up details and index by the spend address', async () => {
    const wallet = await readyWallet();
    const detailsSpy = jest.spyOn(walletApi, 'getAddressDetails').mockResolvedValue({
      success: true,
      data: { address: spend(1), index: 1, transactions: 0, seqnum: 0 },
    });
    await expect(wallet.getAddressIndex(ct(1))).resolves.toBe(1);
    expect(detailsSpy).toHaveBeenCalledWith(wallet, spend(1));
  });

  it('passes malformed addresses through for the server to reject', async () => {
    const wallet = await readyWallet();
    const checkSpy = jest
      .spyOn(walletApi, 'checkAddressesMine')
      .mockResolvedValue({ success: true, addresses: {} });
    await wallet.checkAddressesMine(['not-an-address']);
    expect(checkSpy).toHaveBeenCalledWith(wallet, ['not-an-address']);
  });
});

describe('balance and history', () => {
  it('returns the merged balance by default', async () => {
    const wallet = await readyWallet();
    const body = buildSplitBalanceResponse();
    jest.spyOn(walletApi, 'getBalances').mockResolvedValue({
      success: true,
      balances: [
        {
          ...body.balances[0],
          token: { ...body.balances[0].token, version: TokenVersion.NATIVE },
          balance: { unlocked: 3500n, locked: 0n },
        },
      ],
    });
    const splitSpy = jest.spyOn(walletApi, 'getSplitBalances');
    const [balance] = await wallet.getBalance('00');
    expect(balance.balance).toEqual({ unlocked: 3500n, locked: 0n });
    expect(splitSpy).not.toHaveBeenCalled();
  });

  it('returns the split balance on request', async () => {
    const wallet = await readyWallet();
    const getSpy = jest.spyOn(walletApi, 'getSplitBalances').mockResolvedValue({
      success: true,
      balances: [
        {
          ...buildSplitBalanceResponse().balances[0],
          token: { id: '00', name: 'Hathor', symbol: 'HTR', version: TokenVersion.NATIVE },
          balance: {
            unlocked: { transparent: 1000n, shielded: 2500n, total: 3500n },
            locked: { transparent: 0n, shielded: 0n, total: 0n },
          },
        },
      ],
    });
    const [balance] = await wallet.getBalance('00', { split: true });
    expect(getSpy).toHaveBeenCalledWith(wallet, '00');
    expect(balance.balance.unlocked).toEqual({ transparent: 1000n, shielded: 2500n, total: 3500n });
  });

  it('maps the history shielded fields', async () => {
    const wallet = await readyWallet();
    jest.spyOn(walletApi, 'getHistory').mockResolvedValue({
      success: true,
      history: [
        {
          txId: 'tx1',
          balance: 150n,
          timestamp: 1,
          voided: false,
          version: 1,
          tx_kind: 'mixed',
          balanceBreakdown: { transparent: 50n, shielded: 100n },
        },
        { txId: 'tx2', balance: 1n, timestamp: 2, voided: false, version: 1 },
      ],
    });
    const history = await wallet.getTxHistory();
    expect(history[0]).toEqual({
      txId: 'tx1',
      balance: 150n,
      timestamp: 1,
      voided: false,
      version: 1,
      txKind: 'mixed',
      balanceBreakdown: { transparent: 50n, shielded: 100n },
    });
    expect(history[1]).toEqual({
      txId: 'tx2',
      balance: 1n,
      timestamp: 2,
      voided: false,
      version: 1,
    });
  });
});

describe('utxo kind', () => {
  const emptyOutputs = { success: true, txOutputs: [] };

  it('getUtxos asks for transparent utxos by default', async () => {
    const wallet = await readyWallet();
    const spy = jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue(emptyOutputs);
    await wallet.getUtxos();
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'transparent' });
  });

  it('getUtxos asks for shielded utxos on request', async () => {
    const wallet = await readyWallet();
    const spy = jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue({
      success: true,
      txOutputs: [
        {
          ...buildShieldedTxOutputEntry(),
          value: 150n,
          authorities: 0n,
        } as unknown as Utxo,
      ],
    });
    const result = await wallet.getUtxos({ shielded: true });
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'shielded' });
    expect(result.utxos[0]).toMatchObject({
      amount: 150n,
      address: shieldedFixtureAddresses[1].spendBase58,
    });
  });

  it('getUtxosForAmount only selects transparent utxos', async () => {
    const wallet = await readyWallet();
    const spy = jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue({
      success: true,
      txOutputs: [
        { ...buildShieldedTxOutputEntry(), value: 150n, authorities: 0n } as unknown as Utxo,
      ],
    });
    await expect(wallet.getUtxosForAmount(10n)).rejects.toThrow();
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'transparent' });
  });

  it('getUtxoFromId accepts either kind', async () => {
    const wallet = await readyWallet();
    const spy = jest.spyOn(walletApi, 'getTxOutputs').mockResolvedValue(emptyOutputs);
    await wallet.getUtxoFromId('tx', 1);
    expect(spy.mock.calls[0][1]).not.toHaveProperty('kind');
  });
});

describe('websocket refresh', () => {
  const txWith = (extra: Partial<WsTransaction>): WsTransaction => ({
    tx_id: 'tx',
    nonce: 0,
    timestamp: 0,
    signal_bits: 0,
    version: 1,
    weight: 1,
    parents: [],
    inputs: [],
    outputs: [],
    ...extra,
  });

  it('refreshes when a shielded output pays a listed shielded address', async () => {
    const wallet = await readyWallet();
    (walletApi.getShieldedNewAddresses as jest.Mock).mockClear();
    const spend = shieldedFixtureAddresses[1].spendBase58;
    await wallet.onNewTx(
      txWith({ shielded_outputs: [{ mode: 1, decoded: { address: spend } }], addresses: [spend] })
    );
    expect(walletApi.getShieldedNewAddresses).toHaveBeenCalledTimes(1);
  });

  it('refreshes when only the involved addresses name a listed spend address', async () => {
    const wallet = await readyWallet();
    (walletApi.getShieldedNewAddresses as jest.Mock).mockClear();
    await wallet.onNewTx(txWith({ addresses: [shieldedFixtureAddresses[2].spendBase58] }));
    expect(walletApi.getShieldedNewAddresses).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for an unrelated transaction', async () => {
    const wallet = await readyWallet();
    (walletApi.getShieldedNewAddresses as jest.Mock).mockClear();
    const emitted = jest.fn();
    wallet.on('new-tx', emitted);
    await wallet.onNewTx(
      txWith({
        shielded_outputs: [
          { mode: 1, decoded: { address: shieldedFixtureAddresses[5].spendBase58 } },
        ],
        addresses: [shieldedFixtureAddresses[5].spendBase58],
      })
    );
    expect(walletApi.getShieldedNewAddresses).not.toHaveBeenCalled();
    expect(emitted).toHaveBeenCalledTimes(1);
  });
});
