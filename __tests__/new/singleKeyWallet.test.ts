/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import bitcore, { Address as BitcoreAddress } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import HathorWallet from '../../src/new/wallet';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import {
  ITxSignatureData,
  IStorage,
  SCANNING_POLICY,
  WalletType,
  HistorySyncMode,
} from '../../src/types';
import { getSupportedSyncMode } from '../../src/utils/storage';
import { P2PKH_ACCT_PATH } from '../../src/constants';
import walletUtils from '../../src/utils/wallet';
import { verifyMessage } from '../../src/utils/crypto';
import versionApi from '../../src/api/version';
import Transaction from '../../src/models/transaction';

// ---------------------------------------------------------------------------
// Shared fixture: derive (seed, rawPriv, pubKey, address) once.
// ---------------------------------------------------------------------------

const SEED =
  'avocado spot town typical traffic vault danger century property shallow divorce festival spend attack anchor afford rotate green audit adjust fade wagon depart level';
const NETWORK_NAME = 'testnet';

const network = new Network(NETWORK_NAME);

// Mirror the derivation used internally by `generateAccessDataFromSeed`:
// m/44'/280'/0'/0 (change path), then bitcore's `.deriveChild(0)` for addr 0.
const rootXpriv = new Mnemonic(SEED).toHDPrivateKey('', network.bitcoreNetwork);
const changeXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
const addr0HDKey = changeXpriv.deriveChild(0);

const rawPrivHex = addr0HDKey.privateKey.toString('hex');
const pubKeyHex = addr0HDKey.publicKey.toString('hex');
const expectedAddress = new BitcoreAddress(addr0HDKey.publicKey, network.bitcoreNetwork).toString();

const PIN = '123456';
const PASSWORD = 'test-password';

// ---------------------------------------------------------------------------
// Mocked connection sufficient for HathorWallet constructor + start().
// ---------------------------------------------------------------------------

function makeMockedConnection() {
  const handlers: Record<string, unknown> = {};
  return {
    getState: jest.fn().mockReturnValue(0), // ConnectionState.CLOSED
    startControlHandlers: jest.fn(),
    on: jest.fn((event: string, cb: unknown) => {
      handlers[event] = cb;
    }),
    off: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    removeMetricsHandlers: jest.fn(),
    subscribeAddress: jest.fn(),
    unsubscribeAddress: jest.fn(),
    getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
    getCurrentNetwork: jest.fn().mockReturnValue(NETWORK_NAME),
    network: NETWORK_NAME,
  };
}

/**
 * Build a single-key HathorWallet with storage pre-populated (bypassing the
 * full `start()` sequence). Symmetric with how other unit tests in this file
 * manually wire the storage state.
 */
async function buildPopulatedSingleKeyWallet(opts?: {
  pin?: string;
}): Promise<{ wallet: HathorWallet; storage: IStorage }> {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork(NETWORK_NAME);

  await storage.setScanningPolicyData({ policy: SCANNING_POLICY.SINGLE_ADDRESS });

  const accessData = walletUtils.generateAccessDataFromPrivateKey(rawPrivHex, pubKeyHex, {
    pin: opts?.pin ?? PIN,
  });
  await storage.saveAccessData(accessData);
  await storage.saveAddress({
    base58: expectedAddress,
    bip32AddressIndex: 0,
    publicKey: pubKeyHex,
  });

  const wallet = new HathorWallet({
    connection: makeMockedConnection() as never,
    storage,
    privateKey: rawPrivHex,
    publicKey: pubKeyHex,
    preCalculatedAddresses: [expectedAddress],
    pinCode: opts?.pin ?? PIN,
    password: PASSWORD,
  });

  return { wallet, storage };
}

// ---------------------------------------------------------------------------
// 1. Construction validation
// ---------------------------------------------------------------------------

describe('singleKeyWallet — construction validation', () => {
  const baseOpts = {
    connection: makeMockedConnection() as never,
    pinCode: PIN,
    password: PASSWORD,
  };

  test('privateKey + publicKey + preCalculatedAddresses constructs cleanly', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
          preCalculatedAddresses: [expectedAddress],
        })
    ).not.toThrow();
  });

  test('privateKey without publicKey is accepted (publicKey derived internally)', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          preCalculatedAddresses: [expectedAddress],
        })
    ).not.toThrow();
  });

  test('privateKey without preCalculatedAddresses is accepted (address derived on start)', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
        })
    ).not.toThrow();
  });

  test('privateKey alone is accepted (both publicKey and address derived)', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
        })
    ).not.toThrow();
  });

  test('privateKey + seed throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
          preCalculatedAddresses: [expectedAddress],
          seed: SEED,
        })
    ).toThrow(/exactly one/i);
  });

  test('privateKey + xpriv throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
          preCalculatedAddresses: [expectedAddress],
          xpriv: rootXpriv.xprivkey,
        })
    ).toThrow(/exactly one/i);
  });

  test('privateKey + xpub throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
          preCalculatedAddresses: [expectedAddress],
          xpub: rootXpriv.xpubkey,
        })
    ).toThrow(/exactly one/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Start & access data
// ---------------------------------------------------------------------------

describe('singleKeyWallet — start & access data', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('start() populates single-key access data and preserves single address', async () => {
    jest.spyOn(versionApi, 'getVersion').mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ network: NETWORK_NAME });
    });

    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.config.setNetwork(NETWORK_NAME);

    const wallet = new HathorWallet({
      connection: makeMockedConnection() as never,
      storage,
      privateKey: rawPrivHex,
      publicKey: pubKeyHex,
      preCalculatedAddresses: [expectedAddress],
      pinCode: PIN,
      password: PASSWORD,
    });

    await wallet.start({ pinCode: PIN, password: PASSWORD });

    const accessData = await storage.getAccessData();
    expect(accessData).not.toBeNull();
    expect(accessData!.singleKeyMode).toBe(true);
    expect(accessData!.singleKeyPublicKey).toBe(pubKeyHex);
    expect(accessData!.singleKeyPrivateKey).toBeDefined();
    expect(accessData!.xpubkey).toBeUndefined();
    expect(accessData!.mainKey).toBeUndefined();
    expect(accessData!.words).toBeUndefined();

    // Exactly one address at index 0
    const addr0 = await storage.getAddressAtIndex(0);
    expect(addr0).not.toBeNull();
    expect(addr0!.base58).toBe(expectedAddress);
    expect(addr0!.bip32AddressIndex).toBe(0);

    const addr1 = await storage.getAddressAtIndex(1);
    expect(addr1).toBeNull();

    // Scan policy defaults to SINGLE_ADDRESS
    const policy = await storage.getScanningPolicy();
    expect(policy).toBe(SCANNING_POLICY.SINGLE_ADDRESS);
  });

  test('start() without preCalculatedAddresses derives the single address from publicKey', async () => {
    jest.spyOn(versionApi, 'getVersion').mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ network: NETWORK_NAME });
    });

    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.config.setNetwork(NETWORK_NAME);

    // No preCalculatedAddresses: start() must derive index 0 from
    // publicKey + the connection's network internally via getAddressFromPubkey.
    const wallet = new HathorWallet({
      connection: makeMockedConnection() as never,
      storage,
      privateKey: rawPrivHex,
      publicKey: pubKeyHex,
      pinCode: PIN,
      password: PASSWORD,
    });

    await wallet.start({ pinCode: PIN, password: PASSWORD });

    const addr0 = await storage.getAddressAtIndex(0);
    expect(addr0).not.toBeNull();
    expect(addr0!.base58).toBe(expectedAddress);
    expect(addr0!.bip32AddressIndex).toBe(0);
    expect(addr0!.publicKey).toBe(pubKeyHex);
  });

  test('start() with privateKey only (no publicKey, no preCalculatedAddresses) works end-to-end', async () => {
    jest.spyOn(versionApi, 'getVersion').mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ network: NETWORK_NAME });
    });

    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.config.setNetwork(NETWORK_NAME);

    // privateKey alone — publicKey is derived in the constructor, address is
    // derived in start(). The caller doesn't have to pre-compute anything.
    const wallet = new HathorWallet({
      connection: makeMockedConnection() as never,
      storage,
      privateKey: rawPrivHex,
      pinCode: PIN,
      password: PASSWORD,
    });

    await wallet.start({ pinCode: PIN, password: PASSWORD });

    const accessData = await storage.getAccessData();
    expect(accessData!.singleKeyPublicKey).toBe(pubKeyHex);

    const addr0 = await storage.getAddressAtIndex(0);
    expect(addr0).not.toBeNull();
    expect(addr0!.base58).toBe(expectedAddress);
    expect(addr0!.publicKey).toBe(pubKeyHex);
  });
});

// ---------------------------------------------------------------------------
// 3. Key material retrieval
// ---------------------------------------------------------------------------

describe('singleKeyWallet — key material retrieval', () => {
  test('getSingleKeyPrivateKey(correctPin) returns raw hex', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    const hex = await storage.getSingleKeyPrivateKey(PIN);
    expect(hex).toBe(rawPrivHex);
  });

  test('getSingleKeyPrivateKey(wrongPin) throws', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    await expect(storage.getSingleKeyPrivateKey('wrong-pin')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Direct-derivation guards
// ---------------------------------------------------------------------------

describe('singleKeyWallet — direct derivation guards', () => {
  test('getAddressPrivKey(pin, 0) returns a raw bitcore PrivateKey', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    const key = (await wallet.getAddressPrivKey(PIN, 0)) as bitcore.PrivateKey;
    // Raw PrivateKey — must NOT be an HDPrivateKey (HDPrivateKeys expose xprivkey).
    expect((key as unknown as { xprivkey?: string }).xprivkey).toBeUndefined();
    expect(key).toBeInstanceOf(bitcore.PrivateKey);
    expect(key.toString()).toBe(rawPrivHex);
  });

  test('getAddressPrivKey(pin, 1) throws', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    await expect(wallet.getAddressPrivKey(PIN, 1)).rejects.toThrow(/index 0/);
  });

  test('getPrivateKeyFromAddress(singleAddress, pin) returns raw key', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    const key = (await wallet.getPrivateKeyFromAddress(expectedAddress, {
      pinCode: PIN,
    })) as bitcore.PrivateKey;
    expect(key).toBeInstanceOf(bitcore.PrivateKey);
    expect(key.toString()).toBe(rawPrivHex);
  });

  test('getPrivateKeyFromAddress(otherAddress, pin) throws', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    // Any address not in storage should throw 'does not belong'
    await expect(
      wallet.getPrivateKeyFromAddress('WY1URKUnqCTyiixW1Dw29vmeG99hNN4EW6', {
        pinCode: PIN,
      })
    ).rejects.toThrow(/does not belong/);
  });
});

// ---------------------------------------------------------------------------
// 5. Parity with HD wallet at index 0 (load-bearing)
// ---------------------------------------------------------------------------

describe('singleKeyWallet — parity with HD wallet at index 0', () => {
  test('single-key address matches HD-derived address at index 0', () => {
    // By construction the raw key was derived from m/44'/280'/0'/0/0 of the
    // test seed. This asserts the fixture itself is consistent.
    const viaHD = new BitcoreAddress(addr0HDKey.publicKey, network.bitcoreNetwork).toString();
    expect(viaHD).toBe(expectedAddress);
  });

  test('signMessageWithAddress on single-key wallet verifies against the single address', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    const message = 'hello single-key';
    const signature = await wallet.signMessageWithAddress(message, 0, PIN);
    expect(verifyMessage(message, signature, expectedAddress)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. External signer wiring
// ---------------------------------------------------------------------------

describe('singleKeyWallet — external signer wiring', () => {
  test('setExternalTxSigningMethod registers a signer and getTxSignatures routes through it', async () => {
    const { wallet, storage } = await buildPopulatedSingleKeyWallet();

    const dummySignatureData: ITxSignatureData = {
      inputSignatures: [],
      ncCallerSignature: null,
    };

    const signer = jest.fn().mockResolvedValue(dummySignatureData);
    wallet.setExternalTxSigningMethod(signer);

    expect(wallet.isSignedExternally).toBe(true);
    expect(await wallet.isReadonly()).toBe(false);

    // Call through storage.getTxSignatures — this is what signTransaction uses.
    const tx = new Transaction([], []);
    const result = await storage.getTxSignatures(tx, PIN);
    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer.mock.calls[0][0]).toBe(tx);
    expect(signer.mock.calls[0][1]).toBe(storage);
    expect(signer.mock.calls[0][2]).toBe(PIN);
    expect(result).toEqual(dummySignatureData);
  });

  test('clearing the external signer flips isSignedExternally back to false', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();

    wallet.setExternalTxSigningMethod(jest.fn());
    expect(wallet.isSignedExternally).toBe(true);

    wallet.setExternalTxSigningMethod(null);
    expect(wallet.isSignedExternally).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Scan policy invariants
// ---------------------------------------------------------------------------

describe('singleKeyWallet — scan policy invariants', () => {
  test('hasTxOutsideFirstAddress() returns false unconditionally', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    expect(await wallet.hasTxOutsideFirstAddress()).toBe(false);
  });

  test('enableSingleAddressMode() is idempotent for single-key wallets', async () => {
    const { wallet, storage } = await buildPopulatedSingleKeyWallet();
    // Policy is already SINGLE_ADDRESS; calling again must not throw or flip it.
    await wallet.enableSingleAddressMode();
    const policy = await storage.getScanningPolicy();
    expect(policy).toBe(SCANNING_POLICY.SINGLE_ADDRESS);
  });
});

// ---------------------------------------------------------------------------
// 8. Storage helper: getAddressPrivKeyForIndex
// ---------------------------------------------------------------------------

describe('Storage.getAddressPrivKeyForIndex — single-key wallets', () => {
  test('returns a bitcore.PrivateKey for index 0', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    const key = await storage.getAddressPrivKeyForIndex(PIN, 0);
    expect(key).toBeInstanceOf(bitcore.PrivateKey);
    // raw key — must NOT be an HDPrivateKey
    expect((key as unknown as { xprivkey?: string }).xprivkey).toBeUndefined();
    expect((key as bitcore.PrivateKey).toString()).toBe(rawPrivHex);
  });

  test('throws AddressError for index !== 0', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    await expect(storage.getAddressPrivKeyForIndex(PIN, 1)).rejects.toThrow(/index 0/);
  });

  test('throws for wrong pin', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    await expect(storage.getAddressPrivKeyForIndex('wrong-pin', 0)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Constructor: "exactly one" key-input rule
// ---------------------------------------------------------------------------

describe('HathorWallet constructor — exactly one key input', () => {
  function baseOpts() {
    return {
      connection: makeMockedConnection() as never,
      preCalculatedAddresses: [expectedAddress],
      pinCode: PIN,
      password: PASSWORD,
    };
  }

  test('zero key inputs throws', () => {
    expect(() => new HathorWallet({ ...baseOpts() })).toThrow(/exactly one/i);
  });

  test('seed + xpub throws (HD double-input)', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts(),
          seed: SEED,
          xpub: rootXpriv.hdPublicKey.toString(),
        })
    ).toThrow(/exactly one/i);
  });

  test('xpriv + xpub throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts(),
          xpriv: rootXpriv.toString(),
          xpub: rootXpriv.hdPublicKey.toString(),
        })
    ).toThrow(/exactly one/i);
  });

  test('seed + xpriv still throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts(),
          seed: SEED,
          xpriv: rootXpriv.toString(),
        })
    ).toThrow(/exactly one/i);
  });
});

describe('Storage.getAddressPrivKeyForIndex — HD wallets (raw PrivateKey)', () => {
  async function buildHDWallet(): Promise<{ storage: IStorage }> {
    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.config.setNetwork(NETWORK_NAME);
    const accessData = walletUtils.generateAccessDataFromSeed(SEED, {
      pin: PIN,
      password: PASSWORD,
      networkName: NETWORK_NAME,
    });
    await storage.saveAccessData(accessData);
    return { storage };
  }

  test('returns a raw bitcore.PrivateKey for index 0', async () => {
    const { storage } = await buildHDWallet();
    const key = await storage.getAddressPrivKeyForIndex(PIN, 0);
    expect(key).toBeInstanceOf(bitcore.PrivateKey);
    // Must be raw — NOT an HDPrivateKey wrapper
    expect((key as unknown as { xprivkey?: string }).xprivkey).toBeUndefined();
    // The HD derivation at index 0 of the test seed must match the fixture's rawPrivHex
    expect(key.toString()).toBe(rawPrivHex);
  });

  test('returns a raw bitcore.PrivateKey for index N (N > 0)', async () => {
    const { storage } = await buildHDWallet();
    const key = await storage.getAddressPrivKeyForIndex(PIN, 5);
    expect(key).toBeInstanceOf(bitcore.PrivateKey);
    expect((key as unknown as { xprivkey?: string }).xprivkey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10. changeEncryptionPin re-encrypts singleKeyPrivateKey
// ---------------------------------------------------------------------------

describe('changeEncryptionPin — single-key wallets', () => {
  test('re-encrypts singleKeyPrivateKey with the new pin', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet({ pin: PIN });
    const accessData = await storage.getAccessData();
    expect(accessData).not.toBeNull();

    const OLD_PIN = PIN;
    const NEW_PIN = '654321';

    const newAccessData = walletUtils.changeEncryptionPin(accessData!, OLD_PIN, NEW_PIN);

    expect(newAccessData.singleKeyMode).toBe(true);
    expect(newAccessData.singleKeyPrivateKey).toBeDefined();
    // The encrypted blob must differ from the old one (different IV/ciphertext)
    expect(newAccessData.singleKeyPrivateKey).not.toEqual(accessData!.singleKeyPrivateKey);

    await storage.saveAccessData(newAccessData);
    // Decrypting with the new pin must yield the original raw key
    const decryptedHex = await storage.getSingleKeyPrivateKey(NEW_PIN);
    expect(decryptedHex).toBe(rawPrivHex);
    // Old pin must fail
    await expect(storage.getSingleKeyPrivateKey(OLD_PIN)).rejects.toThrow();
  });

  test('still throws "No data to change" for empty access data', () => {
    const empty = {
      walletType: WalletType.P2PKH,
      walletFlags: 0,
    } as unknown as Parameters<typeof walletUtils.changeEncryptionPin>[0];

    expect(() => walletUtils.changeEncryptionPin(empty, '1', '2')).toThrow(/No data to change/);
  });
});

// ---------------------------------------------------------------------------
// 11. getTxSignatures local-signs single-key wallets without external signer
// ---------------------------------------------------------------------------

describe('Storage.getTxSignatures — single-key wallets (local-sign fallback)', () => {
  test('signs locally with the raw key when no external signer is registered', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    // No signer registered — falls back to the local raw-key path. Per
    // r4mmer's review: external signer is the right escape hatch for
    // Web3Auth (key not exposed), not a hard requirement for every
    // single-key wallet.
    const tx = new Transaction([], []);
    const result = await storage.getTxSignatures(tx, PIN);
    expect(result.inputSignatures).toEqual([]);
    expect(result.ncCallerSignature).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Storage.getAddressPubkey — xpubkey-missing guard
// ---------------------------------------------------------------------------

describe('Storage.getAddressPubkey — single-key wallets', () => {
  test('returns the cached public key for index 0', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    const pubkey = await storage.getAddressPubkey(0);
    expect(pubkey).toBe(pubKeyHex);
  });

  test('throws a clear error if pubkey is not cached and wallet has no xpub', async () => {
    // Construct a single-key wallet but DELIBERATELY save the address without
    // caching its publicKey, to exercise the fallback path.
    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.config.setNetwork(NETWORK_NAME);
    await storage.setScanningPolicyData({
      policy: SCANNING_POLICY.SINGLE_ADDRESS,
    });
    const accessData = walletUtils.generateAccessDataFromPrivateKey(rawPrivHex, pubKeyHex, {
      pin: PIN,
    });
    await storage.saveAccessData(accessData);
    await storage.saveAddress({
      base58: expectedAddress,
      bip32AddressIndex: 0,
      // publicKey intentionally omitted
    });

    await expect(storage.getAddressPubkey(0)).rejects.toThrow(/no xpub|single-key/i);
  });
});

// ---------------------------------------------------------------------------
// 13. getSupportedSyncMode excludes XPUB_STREAM_WS for single-key wallets
// ---------------------------------------------------------------------------

describe('getSupportedSyncMode — single-key wallets', () => {
  test('excludes XPUB_STREAM_WS', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    const modes = await getSupportedSyncMode(storage);
    expect(modes).not.toContain(HistorySyncMode.XPUB_STREAM_WS);
    expect(modes).toContain(HistorySyncMode.MANUAL_STREAM_WS);
    expect(modes).toContain(HistorySyncMode.POLLING_HTTP_API);
  });
});

// ---------------------------------------------------------------------------
// 14. HD-only methods reject single-key wallets
// ---------------------------------------------------------------------------

describe('HathorWallet HD-only methods — single-key wallets reject', () => {
  let wallet: HathorWallet;

  beforeEach(async () => {
    ({ wallet } = await buildPopulatedSingleKeyWallet());
  });

  test('setGapLimit throws', async () => {
    await expect(wallet.setGapLimit(20)).rejects.toThrow(/single-key|not supported/i);
  });

  test('indexLimitLoadMore throws', async () => {
    await expect(wallet.indexLimitLoadMore(10)).rejects.toThrow(/single-key|not supported/i);
  });

  test('indexLimitSetEndIndex throws', async () => {
    await expect(wallet.indexLimitSetEndIndex(5)).rejects.toThrow(/single-key|not supported/i);
  });

  test('enableMultiAddressMode throws', async () => {
    await expect(wallet.enableMultiAddressMode()).rejects.toThrow(/single-key|not supported/i);
  });

  test('getAddressAtIndex(0) returns the single address', async () => {
    const addr = await wallet.getAddressAtIndex(0);
    expect(addr).toBe(expectedAddress);
  });

  test('getAddressAtIndex(1) throws', async () => {
    await expect(wallet.getAddressAtIndex(1)).rejects.toThrow(/single-key|index 0/i);
  });

  test('getNextAddress throws', async () => {
    await expect(wallet.getNextAddress()).rejects.toThrow(/single-key|derive|not supported/i);
  });
});

// ---------------------------------------------------------------------------
// 16. HD wallets in SINGLE_ADDRESS policy keep derivation capability
// (regression guard against r4mmer's PR1093 comment about hasTxOutsideFirstAddress
// and getAddressAtIndex being over-broad)
// ---------------------------------------------------------------------------

describe('HD wallet in SINGLE_ADDRESS policy — derivation capability preserved', () => {
  async function buildHDSingleAddressWallet(): Promise<{ storage: IStorage }> {
    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.config.setNetwork(NETWORK_NAME);
    await storage.setScanningPolicyData({ policy: SCANNING_POLICY.SINGLE_ADDRESS });
    const accessData = walletUtils.generateAccessDataFromSeed(SEED, {
      pin: PIN,
      password: PASSWORD,
      networkName: NETWORK_NAME,
    });
    await storage.saveAccessData(accessData);
    return { storage };
  }

  test('canDeriveAddresses() returns true (has xpub)', async () => {
    const { storage } = await buildHDSingleAddressWallet();
    expect(await storage.canDeriveAddresses()).toBe(true);
  });

  test('getSupportedSyncMode still includes XPUB_STREAM_WS', async () => {
    const { storage } = await buildHDSingleAddressWallet();
    const modes = await getSupportedSyncMode(storage);
    expect(modes).toContain(HistorySyncMode.XPUB_STREAM_WS);
  });

  test('access data without canDeriveAddresses flag falls back to !!xpubkey', async () => {
    // Backward-compat check: stored access data created before the flag
    // existed should still report derivation capability via the xpubkey
    // fallback in Storage.canDeriveAddresses().
    const { storage } = await buildHDSingleAddressWallet();
    const accessData = await storage.getAccessData();
    expect(accessData).not.toBeNull();
    const stripped = { ...accessData!, canDeriveAddresses: undefined } as never;
    await storage.saveAccessData(stripped);
    expect(await storage.canDeriveAddresses()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. generateAccessDataFromPrivateKey validates pubkey/privkey match
// (responds to CodeRabbit review on src/utils/wallet.ts:715-727)
// ---------------------------------------------------------------------------

describe('generateAccessDataFromPrivateKey — pubkey/privkey match', () => {
  test('throws when publicKey does not match the key derived from privateKey', () => {
    // Derive a DIFFERENT keypair to use as the mismatched public key.
    const otherHDKey = changeXpriv.deriveChild(1);
    const otherPubKeyHex = otherHDKey.publicKey.toString('hex');

    expect(() =>
      walletUtils.generateAccessDataFromPrivateKey(rawPrivHex, otherPubKeyHex, { pin: PIN })
    ).toThrow(/does not match/i);
  });

  test('accepts the matching pair', () => {
    expect(() =>
      walletUtils.generateAccessDataFromPrivateKey(rawPrivHex, pubKeyHex, { pin: PIN })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 15. HathorWalletServiceWallet rejects single-key wallets
// ---------------------------------------------------------------------------

describe('HathorWalletServiceWallet — single-key rejection', () => {
  test('constructor throws when privateKey is provided', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const HathorWalletServiceWallet = require('../../src/wallet/wallet').default;
    expect(() => {
      // eslint-disable-next-line no-new
      new HathorWalletServiceWallet({
        requestPassword: jest.fn(),
        network,
        seed: SEED,
        privateKey: rawPrivHex,
      } as never);
    }).toThrow(/single-key|not supported|HathorWallet/i);
  });
});

// ---------------------------------------------------------------------------
// 16. checkPin works against singleKeyPrivateKey
// ---------------------------------------------------------------------------

describe('Storage.checkPin — single-key wallets', () => {
  test('returns true for the correct pin', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    await expect(storage.checkPin(PIN)).resolves.toBe(true);
  });

  test('returns false for the wrong pin', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet();
    await expect(storage.checkPin('0000')).resolves.toBe(false);
  });
});
