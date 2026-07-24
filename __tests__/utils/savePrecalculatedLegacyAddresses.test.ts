/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import walletUtils from '../../src/utils/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import { savePrecalculatedLegacyAddresses } from '../../src/utils/storage';
import { IPrecalculatedAddress } from '../../src/types';

describe('savePrecalculatedLegacyAddresses', () => {
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

  const entries: IPrecalculatedAddress[] = [
    { bip32AddressIndex: 0, base58: 'addrA' },
    { bip32AddressIndex: 1, base58: 'addrB' },
    { bip32AddressIndex: 2, base58: 'addrC' },
  ];

  it('persists each entry at its declared BIP32 index', async () => {
    const storage = await makeStorage();
    await savePrecalculatedLegacyAddresses(storage, entries);

    for (const entry of entries) {
      const stored = await storage.getAddressAtIndex(entry.bip32AddressIndex);
      expect(stored).not.toBeNull();
      expect(stored!.base58).toBe(entry.base58);
    }
  });

  /**
   * Regression: `saveAddress` throws on a duplicate base58, so re-injecting the
   * same pre-calculated list over already-populated storage — a wallet
   * `stop()` (which keeps addresses by default) followed by `start()` — used to
   * throw 'Already have this address' before startup could complete.
   */
  it('is idempotent: re-injecting the same list over populated storage is a no-op', async () => {
    const storage = await makeStorage();
    await savePrecalculatedLegacyAddresses(storage, entries);
    await expect(savePrecalculatedLegacyAddresses(storage, entries)).resolves.not.toThrow();

    // Still exactly the injected set — the second pass wrote nothing new.
    expect(await storage.store.addressCount()).toBe(entries.length);
    for (const entry of entries) {
      const stored = await storage.getAddressAtIndex(entry.bip32AddressIndex);
      expect(stored!.base58).toBe(entry.base58);
    }
  });

  it('skips only the indexes already present, still persisting the new ones', async () => {
    const storage = await makeStorage();
    await savePrecalculatedLegacyAddresses(storage, entries.slice(0, 2));

    await savePrecalculatedLegacyAddresses(storage, [
      ...entries,
      { bip32AddressIndex: 3, base58: 'addrD' },
    ]);

    expect(await storage.store.addressCount()).toBe(4);
    expect((await storage.getAddressAtIndex(3))!.base58).toBe('addrD');
  });

  /**
   * The guard is keyed on the BIP32 index, not on the base58, precisely so a
   * genuine disagreement between the injected list and what storage already
   * holds stays loud instead of being silently skipped.
   */
  it('throws when an index is already stored under a different address', async () => {
    const storage = await makeStorage();
    await savePrecalculatedLegacyAddresses(storage, entries);

    await expect(
      savePrecalculatedLegacyAddresses(storage, [{ bip32AddressIndex: 0, base58: 'somethingElse' }])
    ).rejects.toThrow(/index 0/);
  });

  it('accepts an empty list', async () => {
    const storage = await makeStorage();
    await expect(savePrecalculatedLegacyAddresses(storage, [])).resolves.not.toThrow();
    expect(await storage.store.addressCount()).toBe(0);
  });
});
