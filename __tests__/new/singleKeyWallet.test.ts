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
import { ITxSignatureData, IStorage, SCANNING_POLICY } from '../../src/types';
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

  test('privateKey without publicKey throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          preCalculatedAddresses: [expectedAddress],
        })
    ).toThrow(/publicKey/);
  });

  test('privateKey without preCalculatedAddresses throws', () => {
    expect(
      () =>
        new HathorWallet({
          ...baseOpts,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
        })
    ).toThrow(/preCalculatedAddresses/);
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
    ).toThrow(/cannot combine privateKey/);
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
    ).toThrow(/cannot combine privateKey/);
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
    ).toThrow(/cannot combine privateKey/);
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
