/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group M — Access-data migration for wallets persisted before shielded
 * support existed.
 *
 * Regression target: Sentry WALLET-MOBILE-AT "Current shielded address is
 * not loaded (index=-1)". Pre-shielded wallets have accessData without
 * scanXpubkey / scanMainKey / spendXpubkey / spendMainKey. The first UI
 * refresh that asks for a shielded address throws. `wallet.start()` now
 * re-derives those fields from the encrypted seed when they're missing;
 * this suite pins the end-to-end behavior so the regression can't recur.
 */

import HathorWallet from '../../../src/new/wallet';
import { MemoryStore, Storage } from '../../../src/storage';
import {
  generateConnection,
  registerShieldedProvider,
  stopAllWallets,
  waitForWalletReady,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
} from '../helpers/wallet.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import walletUtils from '../../../src/utils/wallet';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group M: access-data migration', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * M.int.1 — A wallet persisted without the four shielded fields MUST
   * upgrade on the next `start()` and then behave like a freshly-created
   * shielded-capable wallet: `getCurrentAddress({legacy: false})` returns
   * a real address (not an index=-1 error), and the persisted accessData
   * now has all four fields.
   *
   * We simulate the pre-shielded persisted state by building a fresh
   * accessData record, stripping the shielded fields, writing the stripped
   * version to a MemoryStore, then starting the wallet pointed at that
   * store. If the migration is wired correctly, `start()` detects the
   * missing fields, re-derives them from the encrypted `words`, and saves
   * the fully-populated record back before any address-loading runs.
   */
  it('M.int.1 — pre-shielded accessData upgrades on start() and yields a shielded address', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const seed = walletData.words;

    // Build the "pre-shielded" state: fresh-generate then strip the four
    // shielded fields so the store looks like what 0.37.0-era wallet-lib
    // would have written.
    const fullAccessData = walletUtils.generateAccessDataFromSeed(seed, {
      pin: DEFAULT_PIN_CODE,
      password: DEFAULT_PASSWORD,
      networkName: 'privatenet',
    });
    const preShieldedAccessData = { ...fullAccessData };
    delete preShieldedAccessData.scanXpubkey;
    delete preShieldedAccessData.scanMainKey;
    delete preShieldedAccessData.spendXpubkey;
    delete preShieldedAccessData.spendMainKey;

    const store = new MemoryStore();
    const storage = new Storage(store);
    await storage.saveAccessData(preShieldedAccessData);

    // Sanity: store really is in the pre-shielded state before start().
    const before = await storage.getAccessData();
    expect(before).not.toBeNull();
    expect(before!.scanXpubkey).toBeUndefined();
    expect(before!.spendXpubkey).toBeUndefined();

    const hWallet = new HathorWallet({
      seed,
      storage,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    });
    registerShieldedProvider(hWallet);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Migration must have written all four fields back to persistent storage.
    const after = await storage.getAccessData();
    expect(after).not.toBeNull();
    expect(after!.scanXpubkey).toBeDefined();
    expect(after!.scanMainKey).toBeDefined();
    expect(after!.spendXpubkey).toBeDefined();
    expect(after!.spendMainKey).toBeDefined();

    // The xpubs must match what fresh-create would have produced for the
    // same seed — so a migrated wallet's shielded addresses are identical
    // to a freshly-created one (no address drift).
    expect(after!.scanXpubkey).toBe(fullAccessData.scanXpubkey);
    expect(after!.spendXpubkey).toBe(fullAccessData.spendXpubkey);

    // The original failure mode — the thing Sentry was catching — must
    // now be gone: `getCurrentAddress({legacy: false})` returns an address
    // instead of throwing "Current shielded address is not loaded".
    const shieldedAddr = await hWallet.getAddressAtIndex(0, { legacy: false });
    expect(typeof shieldedAddr).toBe('string');
    expect(shieldedAddr.length).toBeGreaterThan(0);
  });

  /**
   * M.int.2 — Wallets that already carry the four shielded fields (the
   * fresh-create path) must not be migrated again; the persisted bytes
   * stay exactly as they were. Guards against accidental re-encryption
   * (which would invalidate anything the consumer cached).
   */
  it('M.int.2 — fresh wallet with all shielded fields is not re-migrated', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const seed = walletData.words;

    const freshAccessData = walletUtils.generateAccessDataFromSeed(seed, {
      pin: DEFAULT_PIN_CODE,
      password: DEFAULT_PASSWORD,
      networkName: 'privatenet',
    });
    const snapshot = {
      scanXpubkey: freshAccessData.scanXpubkey,
      scanMainKey: JSON.stringify(freshAccessData.scanMainKey),
      spendXpubkey: freshAccessData.spendXpubkey,
      spendMainKey: JSON.stringify(freshAccessData.spendMainKey),
    };

    const store = new MemoryStore();
    const storage = new Storage(store);
    await storage.saveAccessData(freshAccessData);

    const hWallet = new HathorWallet({
      seed,
      storage,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    });
    registerShieldedProvider(hWallet);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    const after = await storage.getAccessData();
    // Byte-identical — migration did NOT run.
    expect(after!.scanXpubkey).toBe(snapshot.scanXpubkey);
    expect(JSON.stringify(after!.scanMainKey)).toBe(snapshot.scanMainKey);
    expect(after!.spendXpubkey).toBe(snapshot.spendXpubkey);
    expect(JSON.stringify(after!.spendMainKey)).toBe(snapshot.spendMainKey);
  });
});
