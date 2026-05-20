/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared address-method tests.
 *
 * Validates address derivation and pointer behavior common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/addresses.test.ts`
 * - `service-specific/addresses.test.ts`
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

const ADDRESS_PATH_REGEX = /^m\/44'\/280'\/0'\/0\/\d+$/;

describe.each(adapters)('[Shared] addresses — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('getAllAddresses returns addresses in derivation-index order', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addresses = await adapter.getAllAddresses(wallet);

      expect(addresses.length).toBeGreaterThan(0);

      // Each entry should have a valid path and a non-empty address
      addresses.forEach(entry => {
        expect(typeof entry.address).toBe('string');
        expect(entry.address.length).toBeGreaterThan(0);
        expect(entry.addressPath).toMatch(ADDRESS_PATH_REGEX);
      });

      // Indices should be a strict ascending sequence starting at 0
      addresses.forEach((entry, position) => {
        expect(entry.index).toBe(position);
      });

      // The address at each index should match getAddressAtIndex
      for (let i = 0; i < addresses.length; i++) {
        const direct = await adapter.getAddressAtIndex(wallet, i);
        expect(direct).toBe(addresses[i].address);
      }
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('getCurrentAddress returns the same address on repeated calls', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const first = await adapter.getCurrentAddress(wallet);
      const second = await adapter.getCurrentAddress(wallet);

      expect(first.address).toBe(second.address);
      expect(first.index).toBe(second.index);
      expect(first.addressPath).toBe(second.addressPath);
      expect(first.addressPath).toMatch(ADDRESS_PATH_REGEX);

      // Should match the address at the same index
      const directAddress = await adapter.getAddressAtIndex(wallet, first.index);
      expect(directAddress).toBe(first.address);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('markAsUsed advances the current address', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const before = await adapter.getCurrentAddress(wallet);
      const marked = await adapter.getCurrentAddress(wallet, { markAsUsed: true });
      const after = await adapter.getCurrentAddress(wallet);

      // The marked call returns the address it just consumed
      expect(marked.address).toBe(before.address);
      expect(marked.index).toBe(before.index);

      // The next call returns the following address
      expect(after.index).toBe(before.index + 1);
      expect(after.address).not.toBe(before.address);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('getNextAddress advances the current address', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const currentBefore = await adapter.getCurrentAddress(wallet);
      const next = await adapter.getNextAddress(wallet);
      const currentAfter = await adapter.getCurrentAddress(wallet);

      expect(next.index).toBe(currentBefore.index + 1);
      expect(next.address).not.toBe(currentBefore.address);
      expect(currentAfter.address).toBe(next.address);
      expect(currentAfter.index).toBe(next.index);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('getAddressIndex returns the correct index and undefined for unknown addresses', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const target = await adapter.getAddressAtIndex(wallet, 2);
      const index = await adapter.getAddressIndex(wallet, target);
      expect(index).toBe(2);

      const unknown = await adapter.getAddressIndex(wallet, 'WUnknownAddressNotInThisWallet');
      expect(unknown).toBeUndefined();
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('getAddressAtIndex returns the expected address', async () => {
    const { wallet, addresses } = await adapter.createWallet();

    try {
      // The adapter exposes precalculated addresses for the wallet it just built;
      // each must match what the wallet returns for the same index.
      expect(addresses).toBeDefined();
      const expected = addresses!;

      for (let i = 0; i < expected.length; i++) {
        const address = await adapter.getAddressAtIndex(wallet, i);
        expect(address).toBe(expected[i]);
      }
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
