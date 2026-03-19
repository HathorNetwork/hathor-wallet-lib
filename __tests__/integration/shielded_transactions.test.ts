/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { ShieldedOutputMode } from '../../src/shielded/types';

describe('shielded transactions', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send and receive an AmountShielded output', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    // Fund wallet A
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Get wallet B's address and public key
    const addrB = await walletB.getAddressAtIndex(0);
    const pubkeyB = await walletB.storage.getAddressPubkey(0);

    // Send shielded output from A to B
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: addrB,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        recipientPubkey: pubkeyB,
      },
    ]);

    expect(tx).not.toBeNull();
    expect(tx!.hash).toBeDefined();

    // Wait for wallet B to receive and process
    await waitForTxReceived(walletB, tx!.hash!);

    // Verify wallet B's balance includes the shielded amount
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should send a FullShielded output', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    // Fund wallet A
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Get wallet B's address and public key
    const addrB = await walletB.getAddressAtIndex(0);
    const pubkeyB = await walletB.storage.getAddressPubkey(0);

    // Send FullShielded output from A to B
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: addrB,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
        recipientPubkey: pubkeyB,
      },
    ]);

    expect(tx).not.toBeNull();
    expect(tx!.hash).toBeDefined();

    // Wait for wallet B to receive and process
    await waitForTxReceived(walletB, tx!.hash!);

    // Verify wallet B's balance includes the shielded amount
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should send mixed transaction (transparent + shielded)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    // Fund wallet A
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    // Get recipient addresses and pubkeys
    const addrB = await walletB.getAddressAtIndex(0);
    const addrC = await walletC.getAddressAtIndex(0);
    const pubkeyC = await walletC.storage.getAddressPubkey(0);

    // Send mixed: transparent to B, shielded to C
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: addrB,
        value: 50n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: addrC,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        recipientPubkey: pubkeyC,
      },
    ]);

    expect(tx).not.toBeNull();

    // Wait for both wallets to receive
    await waitForTxReceived(walletB, tx!.hash!);
    await waitForTxReceived(walletC, tx!.hash!);

    // Verify balances
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);

    const balanceC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balanceC[0].balance.unlocked).toBe(30n);
  });

  it('should send shielded output to self', async () => {
    const walletA = await generateWalletHelper();

    // Fund wallet A
    const addrA0 = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA0, 100n);

    // Get another address from the same wallet with its pubkey
    const addrA1 = await walletA.getAddressAtIndex(1);
    const pubkeyA1 = await walletA.storage.getAddressPubkey(1);

    // Send shielded to self
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: addrA1,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        recipientPubkey: pubkeyA1,
      },
    ]);

    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    // Balance should remain consistent (100 total, minus any fees)
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    // The shielded output (40) + change (60) should equal original (100)
    expect(balanceA[0].balance.unlocked).toBe(100n);
  });

  it('should reject shielded output without recipientPubkey', async () => {
    const walletA = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const walletB = await generateWalletHelper();
    const addrB = await walletB.getAddressAtIndex(0);

    // Attempt to send shielded without pubkey should throw
    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: addrB,
          value: 50n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
          // recipientPubkey intentionally omitted
        },
      ])
    ).rejects.toThrow('recipientPubkey is required for shielded outputs');
  });
});
