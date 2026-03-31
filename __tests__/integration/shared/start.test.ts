/* eslint-disable jest/no-conditional-expect -- Adapter validations must be conditional */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { EventEmitter } from 'events';
import type { AddressInfoObject } from '../../../src/wallet/types';
import type { ConcreteWalletType, FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { deriveXpubFromSeed, getRandomInt } from '../utils/core.util';
import { loggers } from '../utils/logger.util';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { WalletAddressMode } from '../../../src';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] start — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  // --- Validation tests ---

  describe('mandatory parameter validation', () => {
    let wallet: FuzzyWalletType;

    afterEach(async () => {
      if (wallet) {
        try {
          await adapter.stopWallet(wallet);
        } catch (e) {
          loggers.test!.warn('Failed to stop wallet during cleanup', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });

    it('should reject when pinCode is not provided', async () => {
      const built = adapter.buildWalletInstance();
      wallet = built.wallet;

      // Both facades throw an error mentioning "pin" (case-insensitive)
      await expect(
        adapter.startWallet(wallet, {
          pinCode: undefined,
          password: adapter.defaultPassword,
        })
      ).rejects.toThrow(/pin/i);
    });

    it('should reject when password is not provided for seed wallet', async () => {
      const built = adapter.buildWalletInstance();
      wallet = built.wallet;

      // Both facades throw an error mentioning "password" (case-insensitive)
      await expect(
        adapter.startWallet(wallet, {
          pinCode: adapter.defaultPinCode,
          password: undefined,
        })
      ).rejects.toThrow(/password/i);
    });
  });

  // --- Successful start tests ---

  describe('successful start', () => {
    it('should start a wallet with no history', async () => {
      const walletData = adapter.getPrecalculatedWallet();
      const built = adapter.buildWalletInstance({
        seed: walletData.words,
        preCalculatedAddresses: walletData.addresses,
      });
      const { wallet } = built;

      try {
        await adapter.startWallet(wallet, {
          pinCode: adapter.defaultPinCode,
          password: adapter.defaultPassword,
        });

        // Fullnode's start() is non-blocking, so the wallet should still be
        // in a non-ready state here. Service's start() blocks until ready,
        // so this branch is skipped — testing false→true would be a race.
        if (adapter.capabilities.requiresExplicitWaitReady) {
          expect((wallet as ConcreteWalletType).isReady()).toBe(false);
          await adapter.waitForReady(wallet);
        }

        expect((wallet as ConcreteWalletType).isReady()).toBe(true);

        // Verify correct network
        expect(wallet.getNetwork()).toBe(adapter.networkName);

        // Fullnode's getCurrentAddress() is async, service's is sync.
        // Awaiting works for both (await on a non-Promise is a no-op).
        const currentAddress = (await wallet.getCurrentAddress()) as AddressInfoObject;
        expect(currentAddress.index).toBeDefined();
        expect(currentAddress.address).toEqual(walletData.addresses[currentAddress.index]);

        // Verify empty history
        const txHistory = await wallet.getTxHistory({});
        expect(txHistory).toHaveLength(0);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should start with a transaction history', async () => {
      const walletData = adapter.getPrecalculatedWallet();
      const injectAddress = walletData.addresses[0];
      const injectValue = BigInt(getRandomInt(10, 1));

      // Inject funds BEFORE the wallet starts
      const txHash = await adapter.injectFundsBeforeStart(injectAddress, injectValue);

      const built = adapter.buildWalletInstance({
        seed: walletData.words,
        preCalculatedAddresses: walletData.addresses,
      });
      const { wallet } = built;

      try {
        await adapter.startWallet(wallet, {
          pinCode: adapter.defaultPinCode,
          password: adapter.defaultPassword,
        });

        // Same false→true transition check as "no history" test (see comment there)
        if (adapter.capabilities.requiresExplicitWaitReady) {
          expect((wallet as ConcreteWalletType).isReady()).toBe(false);
          await adapter.waitForReady(wallet);
        }

        expect((wallet as ConcreteWalletType).isReady()).toBe(true);

        // Verify the injected tx appears in history
        const txHistory = await wallet.getTxHistory({});
        expect(txHistory).toHaveLength(1);
        expect(txHistory[0].txId).toEqual(txHash);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should emit state events during startup', async () => {
      const { loading, ready } = adapter.capabilities.stateEventValues;
      const events: Array<string | number> = [];
      const built = adapter.buildWalletInstance();
      const { wallet } = built;

      // Attach state listener before start
      (wallet as unknown as EventEmitter).on('state', (state: string | number) => {
        events.push(state);
      });

      try {
        await adapter.startWallet(wallet, {
          pinCode: adapter.defaultPinCode,
          password: adapter.defaultPassword,
        });

        if (adapter.capabilities.requiresExplicitWaitReady) {
          await adapter.waitForReady(wallet);
        }

        // Both facades should emit a loading-like state followed by a ready state
        expect(events).toContain(loading);
        expect(events).toContain(ready);

        // Loading must come before ready
        const loadingIdx = events.indexOf(loading);
        const readyIdx = events.indexOf(ready);
        expect(loadingIdx).toBeLessThan(readyIdx);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });
  });

  // --- Readonly (xpub) tests ---

  // eslint-disable-next-line jest/valid-title -- conditional gating via capability flag
  const readonlyDescribe = adapter.capabilities.supportsXpubReadonly ? describe : describe.skip;

  readonlyDescribe('readonly wallet (xpub)', () => {
    it('should start an xpub wallet in readonly mode', async () => {
      const walletData = adapter.getPrecalculatedWallet();
      const xpub = deriveXpubFromSeed(walletData.words);

      // Pass seed alongside xpub so adapters that require backend pre-registration
      // (e.g. wallet-service) can create the wallet before starting in readonly mode.
      const { wallet, storage } = await adapter.createWallet({
        seed: walletData.words,
        xpub,
        preCalculatedAddresses: walletData.addresses,
      });

      try {
        expect((wallet as ConcreteWalletType).isReady()).toBe(true);
        await expect(storage.isReadonly()).resolves.toBe(true);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should report zero balance on a fresh readonly wallet', async () => {
      const walletData = adapter.getPrecalculatedWallet();
      const xpub = deriveXpubFromSeed(walletData.words);

      const { wallet } = await adapter.createWallet({
        seed: walletData.words,
        xpub,
        preCalculatedAddresses: walletData.addresses,
      });

      try {
        await expect(wallet.getBalance(NATIVE_TOKEN_UID)).resolves.toStrictEqual([
          expect.objectContaining({
            token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
            balance: { unlocked: 0n, locked: 0n },
            transactions: 0,
          }),
        ]);
        await expect(wallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 0n);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should reflect injected funds in balance', async () => {
      const walletData = adapter.getPrecalculatedWallet();
      const xpub = deriveXpubFromSeed(walletData.words);

      const { wallet } = await adapter.createWallet({
        seed: walletData.words,
        xpub,
        preCalculatedAddresses: walletData.addresses,
      });

      try {
        await expect(wallet.getAddressMode()).resolves.toEqual(WalletAddressMode.MULTI);
        const addr = await wallet.getAddressAtIndex(1);
        expect(addr).toBeDefined();
        await adapter.injectFunds(wallet, addr!, 1n);

        await expect(wallet.getBalance(NATIVE_TOKEN_UID)).resolves.toMatchObject([
          expect.objectContaining({
            token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
            balance: { unlocked: 1n, locked: 0n },
            transactions: expect.any(Number),
          }),
        ]);
        await expect(wallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 1n);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });
  });

  // --- Stop lifecycle tests ---

  describe('stop', () => {
    it('should not be ready after stop', async () => {
      const { wallet } = await adapter.createWallet();
      expect((wallet as ConcreteWalletType).isReady()).toBe(true);

      await adapter.stopWallet(wallet);
      expect((wallet as ConcreteWalletType).isReady()).toBe(false);
    });

    it('should tolerate stopping a wallet that was never started', async () => {
      const { wallet } = adapter.buildWalletInstance();
      await expect(adapter.stopWallet(wallet)).resolves.not.toThrow();
    });

    it('should tolerate being stopped twice', async () => {
      const { wallet } = await adapter.createWallet();
      await adapter.stopWallet(wallet);
      await expect(adapter.stopWallet(wallet)).resolves.not.toThrow();
    });
  });
});
