/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group I — Edge cases for shielded-output construction.
 *
 * Covers inputs the wallet (or fullnode) should reject before they hit the
 * wire, and unusual but valid shapes (e.g., many shielded outputs in one tx).
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

describe('shielded outputs — Group I: Edge cases', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('I.36 — Single shielded output is rejected (< 2 shielded rule)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });

    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: sb0,
          value: 30n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow();
  });

  it('I.37 — Zero-amount shielded output is rejected', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });

    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: sb0,
          value: 0n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
        {
          address: sb1,
          value: 10n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow();
  });

  it('I.38 — Many shielded outputs in a single tx', async () => {
    // Stress test the batch shielded-output path. We don't go huge because
    // range proofs are CPU-heavy — 6 outputs is enough to exercise the batch
    // path without timing out the test in CI.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    const outputs = [];
    for (let i = 0; i < 6; i++) {
      const sb = await walletB.getAddressAtIndex(i, { legacy: false });
      outputs.push({
        address: sb,
        value: 5n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      });
    }
    const tx = await walletA.sendManyOutputsTransaction(outputs);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    const bal = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(bal).toBe(30n);
  });

  it('I.39 — Shielded output to non-existent address format is rejected', async () => {
    const walletA = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    // Use a transparent base58 address where a shielded is required.
    const legacy = await walletA.getAddressAtIndex(1, { legacy: true });
    const sa2 = await walletA.getAddressAtIndex(2, { legacy: false });

    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: legacy,
          value: 20n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
        {
          address: sa2,
          value: 10n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow();
  });
});
