/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade getBalance() tests.
 *
 * Tests that rely on fullnode-only APIs or behavior (e.g. no-arg getBalance()
 * rejection, nonexistent token returning a zero-balance entry).
 *
 * Shared getBalance() tests live in `shared/get-balance.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { getRandomInt } from '../utils/core.util';
import { createTokenHelper, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('[Fullnode] getBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should reject when tokenUid is not provided', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getBalance()).rejects.toThrow();
  });

  it('should return zero balance for a nonexistent token', async () => {
    const hWallet = await generateWalletHelper();

    const emptyBalance = await hWallet.getBalance(fakeTokenUid);
    expect(emptyBalance).toHaveLength(1);
    expect(emptyBalance[0]).toMatchObject({
      token: { id: fakeTokenUid },
      balance: { unlocked: 0n, locked: 0n },
      transactions: 0,
    });
  });

  it('should not show custom token balance on a different wallet', async () => {
    const hWallet = await generateWalletHelper();

    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const newTokenAmount = BigInt(getRandomInt(1000, 10));
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount
    );

    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const genesisTknBalance = await gWallet.getBalance(tokenUid);
    expect(genesisTknBalance).toHaveLength(1);
    expect(genesisTknBalance[0]).toMatchObject({
      token: { id: tokenUid },
      balance: { unlocked: 0n, locked: 0n },
      transactions: 0,
    });
  });
});
