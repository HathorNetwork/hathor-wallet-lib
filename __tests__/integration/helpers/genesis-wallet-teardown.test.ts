/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Jest gives each test file its own module registry, so each file starts its own genesis wallet,
 * and every file runs in the same process. A genesis wallet left running keeps syncing every
 * genesis transaction the later files send, so the helper must be able to stop it, and its
 * teardown helpers must not start a new one.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from './genesis-wallet.helper';

describe('GenesisWalletHelper teardown', () => {
  it('should stop the running genesis wallet and start a new one on the next use', async () => {
    const first = await GenesisWalletHelper.getSingleton();
    await GenesisWalletHelper.stop();
    expect(first.hWallet.state).toBe(HathorWallet.CLOSED);

    const second = await GenesisWalletHelper.getSingleton();
    expect(second).not.toBe(first);
    expect(second.hWallet.isReady()).toBe(true);
  });

  it('should do nothing when no genesis wallet is running', async () => {
    await GenesisWalletHelper.stop();
    await expect(GenesisWalletHelper.stop()).resolves.toBeUndefined();
  });

  it('should not start a genesis wallet just to clear its listeners', async () => {
    await GenesisWalletHelper.stop();
    const start = jest.spyOn(GenesisWalletHelper.prototype, 'start');
    try {
      await GenesisWalletHelper.clearListeners();
      expect(start).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
    }
  });
});
