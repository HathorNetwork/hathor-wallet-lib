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
import { WalletError } from '../../src/errors';
import { IWalletAccessData } from '../../src/types';
import type { IShieldedCryptoProvider } from '../../src/shielded/types';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../src/constants';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  buildShieldedNewAddressesResponse,
} from '../__mock_helpers__/shielded-ws.fixtures';

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
