/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../src/new/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import versionApi from '../../src/api/version';
import { IPrecalculatedAddress, IPrecalculatedShieldedAddress } from '../../src/types';
import { ConnectionState } from '../../src/wallet/types';

/**
 * End-to-end wiring for the `preCalculatedAddresses` option.
 *
 * `normalizePreCalculatedAddresses` and `savePrecalculatedLegacyAddresses` are
 * each covered on their own, but the reshaping BETWEEN them lives inline in
 * `start()` and nothing exercised it. These tests drive a real wallet through a
 * real `start()` so a regression in that wiring — inverting the `.filter`,
 * dropping `bip32AddressIndex` from the mapped object, or letting the spread
 * order overwrite it — fails here.
 */
describe('start() with pre-calculated addresses', () => {
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  function makeConn() {
    return {
      network: 'testnet',
      getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
      getState: jest.fn().mockReturnValue(ConnectionState.CLOSED),
      startControlHandlers: jest.fn(),
      on: jest.fn(),
      start: jest.fn(),
      getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
    };
  }

  async function startWith(preCalculatedAddresses: IPrecalculatedAddress[]) {
    const storage = new Storage(new MemoryStore());
    jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
      resolve({ network: 'testnet' });
    });

    const hWallet = new HathorWallet({
      seed,
      storage,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: makeConn() as any,
      password: '456',
      pinCode: '123',
      preCalculatedAddresses,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hWallet as any).getTokenData = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hWallet as any).setState = jest.fn();

    await hWallet.start({ pinCode: '123', password: '456' });
    return { hWallet, storage };
  }

  // A whole IPrecalculatedShieldedAddress, exactly as the repo's own fixtures
  // are typed (`Record<string, IPrecalculatedShieldedAddress[]>`). It carries a
  // `bip32AddressIndex` of its own, which must NOT override the entry's.
  const shieldedFixture: IPrecalculatedShieldedAddress = {
    bip32AddressIndex: 7,
    shieldedBase58: 'shielded-for-index-0',
    spendBase58: 'spend-for-index-0',
    scanPubkey: '02aa',
    spendPubkey: '03bb',
  };

  const entries: IPrecalculatedAddress[] = [
    { bip32AddressIndex: 0, base58: 'legacy-index-0', shielded: shieldedFixture },
    { bip32AddressIndex: 1, base58: 'legacy-index-1' },
  ];

  it('persists the legacy chain for every entry', async () => {
    const { storage } = await startWith(entries);

    expect((await storage.getAddressAtIndex(0))!.base58).toBe('legacy-index-0');
    expect((await storage.getAddressAtIndex(1))!.base58).toBe('legacy-index-1');
  });

  it('persists the shielded pair only for the entry that carries one', async () => {
    const { storage } = await startWith(entries);

    const shielded0 = await storage.getAddressAtIndex(0, { legacy: false });
    expect(shielded0).not.toBeNull();
    expect(shielded0!.base58).toBe('shielded-for-index-0');
    expect(shielded0!.ctMappingAddress).toBe('spend-for-index-0');
    expect(await storage.isAddressMine('spend-for-index-0')).toBe(true);

    // Index 1 has no shielded block, so nothing is injected on that chain.
    expect(await storage.getAddressAtIndex(1, { legacy: false })).toBeNull();
  });

  /**
   * Regression: the mapped object used to spread `entry.shielded` AFTER
   * `bip32AddressIndex`, so a `bip32AddressIndex` structurally present on the
   * shielded block won the assignment. `Omit<…, 'bip32AddressIndex'>` removes it
   * from the type but not from the value, and excess-property checks only fire
   * on fresh literals — so assigning a whole `IPrecalculatedShieldedAddress`
   * (what the repo's fixtures are) compiled clean and silently filed index 0's
   * pair under index 7.
   */
  it('files the shielded pair under the entry index, not one nested in the pair', async () => {
    const { storage } = await startWith(entries);

    // The fixture declares bip32AddressIndex 7; the entry declares 0.
    expect(shieldedFixture.bip32AddressIndex).toBe(7);
    expect(await storage.getAddressAtIndex(7, { legacy: false })).toBeNull();

    const shielded0 = await storage.getAddressAtIndex(0, { legacy: false });
    expect(shielded0!.bip32AddressIndex).toBe(0);
  });
});
