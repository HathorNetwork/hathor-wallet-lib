/* eslint-disable jest/no-conditional-expect -- Adapter validations must be conditional */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared start() test factory.
 *
 * This file exports a factory function that registers tests common to both
 * HathorWallet (fullnode) and HathorWalletServiceWallet facades.
 * It is NOT a .test.ts file — Jest won't discover it directly.
 *
 * Usage:
 *   import { registerSharedStartTests } from '../shared/start.shared';
 *   registerSharedStartTests(adapter);
 */

import type { EventEmitter } from 'events';
import type { AddressInfoObject } from '../../../src/wallet/types';
import type { ConcreteWalletType, FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { getRandomInt } from '../utils/core.util';

// eslint-disable-next-line jest/no-export
export function registerSharedStartTests(adapter: IWalletTestAdapter) {
  describe(`[Shared] start — ${adapter.name}`, () => {
    // --- Validation tests ---

    describe('mandatory parameter validation', () => {
      let wallet: FuzzyWalletType;

      afterEach(async () => {
        if (wallet) {
          try {
            await adapter.stopWallet(wallet);
          } catch {
            // wallet might not have started
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
        ).rejects.toThrow(/[Pp]in/);
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
        ).rejects.toThrow(/[Pp]assword/);
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
  });
}
