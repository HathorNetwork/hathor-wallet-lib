/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade getBalance() tests.
 *
 * Tests that rely on fullnode-only APIs or helpers (e.g. {@link createTokenHelper},
 * direct sendTransaction without pinCode).
 *
 * Shared getBalance() tests live in `shared/get-balance.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { getRandomInt } from '../utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('[Fullnode] getBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should reject when tokenUid is not provided', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getBalance()).rejects.toThrow();
  });

  it('should not change balance after internal transfer', async () => {
    const hWallet = await generateWalletHelper();

    const injectedValue = BigInt(getRandomInt(10, 2));
    await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      injectedValue
    );

    const balanceBefore = await hWallet.getBalance(NATIVE_TOKEN_UID);

    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), 2n);
    await waitForTxReceived(hWallet, tx1.hash!);
    const balanceAfter = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(balanceAfter[0].balance).toEqual(balanceBefore[0].balance);
  });

  it('should get the balance for a custom token', async () => {
    const hWallet = await generateWalletHelper();

    // Validating results for a nonexistent token
    const emptyBalance = await hWallet.getBalance(fakeTokenUid);
    expect(emptyBalance).toHaveLength(1);
    expect(emptyBalance[0]).toMatchObject({
      token: { id: fakeTokenUid },
      balance: { unlocked: 0n, locked: 0n },
      transactions: 0,
    });

    // Creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const newTokenAmount = BigInt(getRandomInt(1000, 10));
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount
    );

    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0]).toMatchObject({
      balance: { unlocked: newTokenAmount, locked: 0n },
      transactions: expect.any(Number),
      // transactions: 1, // TODO: The amount of transactions is often 8 but should be 1. Ref #397
    });

    // Validating that a different wallet (genesis) has no access to this token
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
