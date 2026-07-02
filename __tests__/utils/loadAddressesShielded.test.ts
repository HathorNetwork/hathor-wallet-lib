/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import walletUtils from '../../src/utils/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import { loadAddresses, savePrecalculatedShieldedAddresses } from '../../src/utils/storage';
import * as addressUtils from '../../src/utils/address';
import { IPrecalculatedShieldedAddress } from '../../src/types';

describe('loadAddresses — shielded chain derivation lifecycle', () => {
  // Shielded address derivation is pure-JS EC math that jest's vm sandbox slows
  // down dramatically, and loadAddresses re-walks from index 0 on every
  // sync/reload. These tests pin the two mechanisms that keep that affordable:
  // (1) an index already in storage is NEVER re-derived, and (2) injected
  // pre-calculated pairs are indistinguishable from live-derived ones.
  const PIN = '0000';
  const seed = walletUtils.generateWalletWords();
  const accessData = walletUtils.generateAccessDataFromSeed(seed, {
    pin: PIN,
    password: PIN,
    networkName: 'testnet',
  });

  async function makeStorage(): Promise<Storage> {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(accessData);
    return storage;
  }

  /**
   * Build injection entries from the same derivation the wallet uses live.
   * Uses the storage's configured network (the global config default), so the
   * entries match what loadAddresses would derive for the same storage.
   */
  function deriveEntries(count: number, storage: Storage): IPrecalculatedShieldedAddress[] {
    const networkName = storage.config.getNetwork().name;
    const entries: IPrecalculatedShieldedAddress[] = [];
    for (let i = 0; i < count; i++) {
      const { shieldedAddress, spendAddress } = addressUtils.deriveShieldedAddressPair(
        accessData.scanXpubkey!,
        accessData.spendXpubkey!,
        i,
        networkName
      );
      entries.push({
        bip32AddressIndex: i,
        shieldedBase58: shieldedAddress.base58,
        spendBase58: spendAddress.base58,
        scanPubkey: shieldedAddress.publicKey!,
        spendPubkey: spendAddress.publicKey!,
      });
    }
    return entries;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives each index once and skips re-derivation on re-loads', async () => {
    const storage = await makeStorage();
    const deriveSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

    const first = await loadAddresses(0, 5, storage);
    expect(deriveSpy).toHaveBeenCalledTimes(5);
    // 5 legacy + 5 spend-derived P2PKH addresses returned for subscription.
    expect(first).toHaveLength(10);

    deriveSpy.mockClear();
    const saveSpy = jest.spyOn(storage, 'saveAddress');
    const second = await loadAddresses(0, 5, storage);
    // Re-walks (every sync/reload restarts at index 0) must not re-derive
    // nor re-save — and must return the exact same list, including the paired
    // spend base58s, so subscriptions stay identical.
    expect(deriveSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(second).toEqual(first);
  }, 30000);

  it('injected pre-calculated pairs skip derivation and match live-derived state', async () => {
    // Reference: live derivation.
    const liveStorage = await makeStorage();
    const liveList = await loadAddresses(0, 4, liveStorage);

    // Same wallet, but with the pairs injected up front (what the wallet start
    // does with preCalculatedShieldedAddresses).
    const injectedStorage = await makeStorage();
    await savePrecalculatedShieldedAddresses(injectedStorage, deriveEntries(4, injectedStorage));

    const deriveSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');
    const injectedList = await loadAddresses(0, 4, injectedStorage);
    expect(deriveSpy).not.toHaveBeenCalled();
    expect(injectedList).toEqual(liveList);

    // The stored records must be byte-identical to live derivation on BOTH
    // chains — the receive pipeline reads bip32AddressIndex/addressType off
    // these records, so any shape drift would break decryption.
    for (let i = 0; i < 4; i++) {
      const liveShielded = await liveStorage.getAddressAtIndex(i, { legacy: false });
      const injectedShielded = await injectedStorage.getAddressAtIndex(i, { legacy: false });
      expect(injectedShielded).toEqual(liveShielded);
      const liveSpend = await liveStorage.store.getAddress(liveShielded!.ctMappingAddress!);
      const injectedSpend = await injectedStorage.store.getAddress(
        injectedShielded!.ctMappingAddress!
      );
      expect(injectedSpend).toEqual(liveSpend);
    }
  }, 30000);

  it('re-injection over existing storage is a no-op (wallet restart)', async () => {
    const storage = await makeStorage();
    const entries = deriveEntries(3, storage);
    await savePrecalculatedShieldedAddresses(storage, entries);
    // A wallet restart without cleanStorage re-runs the start() injection over
    // the same storage — saveAddress throws on duplicates, so this must guard.
    await expect(savePrecalculatedShieldedAddresses(storage, entries)).resolves.toBeUndefined();
  }, 30000);

  it('derives live past the injected window (fallback stays exercised)', async () => {
    const storage = await makeStorage();
    await savePrecalculatedShieldedAddresses(storage, deriveEntries(2, storage));
    const deriveSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

    await loadAddresses(0, 4, storage);
    // Indexes 0-1 injected (skipped), 2-3 derived live.
    expect(deriveSpy).toHaveBeenCalledTimes(2);
    const info = await storage.getAddressAtIndex(3, { legacy: false });
    expect(info?.addressType).toBe('shielded');
    expect(info?.ctMappingAddress).toBeTruthy();
  }, 30000);

  it('wallets without shielded keys never touch the shielded chain', async () => {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData({
      ...accessData,
      scanXpubkey: undefined,
      spendXpubkey: undefined,
    });
    const deriveSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

    const list = await loadAddresses(0, 3, storage);
    expect(deriveSpy).not.toHaveBeenCalled();
    // Legacy-only: one address per index, no shielded entries.
    expect(list).toHaveLength(3);
    expect(await storage.getAddressAtIndex(0, { legacy: false })).toBeNull();
  }, 30000);
});
