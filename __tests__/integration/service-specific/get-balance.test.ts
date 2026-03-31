/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade getBalance() tests.
 *
 * Tests for service-only behavior: no-arg getBalance() (returns all tokens),
 * not-ready wallet rejection, and skipped empty-wallet bugs.
 *
 * Shared getBalance() tests live in `shared/get-balance.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { buildWalletInstance, emptyWallet } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapter = new ServiceWalletTestAdapter();

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] getBalance', () => {
  let wallet: HathorWalletServiceWallet;

  afterEach(async () => {
    if (wallet) {
      try {
        await wallet.stop({ cleanStorage: true });
      } catch {
        // Wallet may already be stopped
      }
    }
  });

  it('should return balance for a funded wallet using no-arg getBalance()', async () => {
    const { wallet: w } = await adapter.createWallet();
    wallet = w as unknown as HathorWalletServiceWallet;

    const addr = await w.getAddressAtIndex(0);
    await adapter.injectFunds(w, addr!, 1n);

    const balances = await wallet.getBalance();
    expect(Array.isArray(balances)).toBe(true);
    expect(balances.length).toBeGreaterThanOrEqual(1);

    const htrBalance = balances.find(b => b.token.id === NATIVE_TOKEN_UID);
    expect(htrBalance).toBeDefined();
    expect(typeof htrBalance?.balance).toBe('object');
  });

  // FIXME(wallet-service): getBalance() on an empty wallet should return a single
  // entry with 0 balance for the native token, but currently returns an empty array.
  // Ref: https://github.com/HathorNetwork/hathor-wallet-lib/issues/397
  it.skip('should return balance array for empty wallet', async () => {
    ({ wallet } = buildWalletInstance({ words: emptyWallet.words }));
    await wallet.start({ pinCode: adapter.defaultPinCode, password: adapter.defaultPassword });

    const balances = await wallet.getBalance();

    expect(Array.isArray(balances)).toBe(true);
    expect(balances.length).toStrictEqual(1);

    const htrBalance = balances.find(b => b.token.id === NATIVE_TOKEN_UID);
    expect(htrBalance).toBeDefined();
    expect(htrBalance?.balance).toBe(0n);
  });

  // FIXME(wallet-service): getBalance(tokenUid) on an empty wallet should return
  // a single entry with 0 balance, but currently returns an empty array.
  // Ref: https://github.com/HathorNetwork/hathor-wallet-lib/issues/397
  it.skip('should return balance for specific token when token parameter is provided', async () => {
    ({ wallet } = buildWalletInstance({ words: emptyWallet.words }));
    await wallet.start({ pinCode: adapter.defaultPinCode, password: adapter.defaultPassword });

    const balances = await wallet.getBalance(NATIVE_TOKEN_UID);

    expect(Array.isArray(balances)).toBe(true);
    expect(balances.length).toStrictEqual(1);
    expect(balances[0]).toEqual(
      expect.objectContaining({
        token: expect.objectContaining({
          id: NATIVE_TOKEN_UID,
          name: expect.any(String),
          symbol: expect.any(String),
        }),
        balance: expect.objectContaining({
          unlocked: 0n,
          locked: 0n,
        }),
        tokenAuthorities: expect.objectContaining({
          unlocked: expect.objectContaining({
            mint: false,
            melt: false,
          }),
          locked: expect.objectContaining({
            mint: false,
            melt: false,
          }),
        }),
        transactions: 0,
        lockExpires: expect.anything(),
      })
    );
  });

  it('should throw error when wallet is not ready', async () => {
    const { wallet: notReadyWallet } = buildWalletInstance({ words: emptyWallet.words });
    await expect(notReadyWallet.getBalance()).rejects.toThrow('Wallet not ready');
  });
});
