/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import walletUtils from '../../src/utils/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import { savePrecalculatedShieldedAddresses } from '../../src/utils/storage';
import { IPrecalculatedShieldedAddress } from '../../src/types';
import { AddressError } from '../../src/errors';

describe('savePrecalculatedShieldedAddresses', () => {
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

  function pair(suffix: string, bip32AddressIndex = 0): IPrecalculatedShieldedAddress {
    return {
      bip32AddressIndex,
      shieldedBase58: `shielded-${suffix}`,
      spendBase58: `spend-${suffix}`,
      scanPubkey: `02${suffix}`,
      spendPubkey: `03${suffix}`,
    };
  }

  it('persists both chain records for each entry', async () => {
    const storage = await makeStorage();
    await savePrecalculatedShieldedAddresses(storage, [pair('a')]);

    const stored = await storage.getAddressAtIndex(0, { legacy: false });
    expect(stored!.base58).toBe('shielded-a');
    expect(stored!.ctMappingAddress).toBe('spend-a');
    expect(await storage.isAddressMine('spend-a')).toBe(true);
  });

  it('is idempotent: re-injecting the same pair is a no-op', async () => {
    const storage = await makeStorage();
    await savePrecalculatedShieldedAddresses(storage, [pair('a')]);
    await expect(savePrecalculatedShieldedAddresses(storage, [pair('a')])).resolves.not.toThrow();

    expect(await storage.store.addressCount({ legacy: false })).toBe(1);
  });

  /**
   * Regression: this guarded on `isAddressMine(base58)` alone, so a pair that
   * disagreed with what storage already held at that index was not detected —
   * both addresses were new, so both saved, and the shielded index mapping was
   * overwritten while the previous record lingered unreachable. That is silent
   * corruption on the chain where a wrong `ctMappingAddress` costs address
   * history visibility, which is exactly what the legacy sibling throws over.
   */
  it('throws when an index already holds a different shielded address', async () => {
    const storage = await makeStorage();
    await savePrecalculatedShieldedAddresses(storage, [pair('a')]);

    await expect(savePrecalculatedShieldedAddresses(storage, [pair('b')])).rejects.toThrow(
      AddressError
    );
    // The original mapping is intact — nothing was overwritten.
    const stored = await storage.getAddressAtIndex(0, { legacy: false });
    expect(stored!.base58).toBe('shielded-a');
    expect(stored!.ctMappingAddress).toBe('spend-a');
  });

  it('throws when an index maps its shielded address to a different spend address', async () => {
    const storage = await makeStorage();
    await savePrecalculatedShieldedAddresses(storage, [pair('a')]);

    const relinked: IPrecalculatedShieldedAddress = {
      ...pair('a'),
      spendBase58: 'spend-somewhere-else',
    };
    await expect(savePrecalculatedShieldedAddresses(storage, [relinked])).rejects.toThrow(
      AddressError
    );
  });

  it('still fills in a missing half of a partially stored pair', async () => {
    const storage = await makeStorage();
    const entry = pair('a');
    // Only the shielded record exists; the spend half is missing.
    await storage.saveAddress({
      base58: entry.shieldedBase58,
      bip32AddressIndex: entry.bip32AddressIndex,
      publicKey: entry.scanPubkey,
      addressType: 'shielded',
      ctMappingAddress: entry.spendBase58,
    });
    expect(await storage.isAddressMine('spend-a')).toBe(false);

    await savePrecalculatedShieldedAddresses(storage, [entry]);
    expect(await storage.isAddressMine('spend-a')).toBe(true);
  });
});
