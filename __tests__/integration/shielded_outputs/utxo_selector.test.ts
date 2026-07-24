/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group B — UTXO selector correctness for shielded UTXOs.
 *
 * Failures here cause failed sends ("input has already been spent") or, in
 * the worst case, accidental double-spend attempts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group B: UTXO selector', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  async function countShieldedUtxos(wallet: any) {
    let n = 0;
    for await (const _u of wallet.storage.selectUtxos({
      token: NATIVE_TOKEN_UID,
      shielded: true,
    })) {
      n++;
    }
    return n;
  }

  it('B.9 — Spend exact-value shielded UTXO leaves no leftover for that UTXO', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    expect(await countShieldedUtxos(walletB)).toBe(2);

    // Self-send that exactly consumes the 30n UTXO into 28n + 1n change (with 2n fee).
    const sa2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sa3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sa2,
        value: 27n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa3,
        value: 1n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);
    // Started with 2 (30, 20); spent one 30, created 2 (27, 1). Should be 3.
    expect(await countShieldedUtxos(walletB)).toBe(3);
  });

  it('B.10 — Spend two shielded UTXOs in same tx: both deleted, not just one', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    expect(await countShieldedUtxos(walletB)).toBe(2);

    // Send 48n that will require BOTH 25n UTXOs (50 total - 2n fee = 48n out).
    const sa2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sa3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sa2,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa3,
        value: 8n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);
    // Both 25n UTXOs from tx1 should be gone; only 2 new from tx2 remain.
    expect(await countShieldedUtxos(walletB)).toBe(2);
  });

  it('B.11 — Mixed transparent + shielded inputs in same tx', async () => {
    // Setup: walletA gives walletB transparent HTR + 2 shielded UTXOs.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    // Transparent funding of walletB
    const addrB0 = await walletB.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletB, addrB0, 50n);
    // Shielded funding of walletB
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const txFund = await walletA.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, txFund!.hash!);

    // Now walletB sends a shielded tx requiring more than just shielded UTXOs;
    // selector should mix transparent + shielded inputs as needed.
    const sa2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sa3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx = await walletB.sendManyOutputsTransaction([
      {
        address: sa2,
        value: 60n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa3,
        value: 28n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
  });

  it('B.13 — Three sequential self-sends without reload', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 60n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx1!.hash!);

    // Self-send 1: spends 60 → 30 + 28 (fee 2)
    const sa2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sa3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sa2,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa3,
        value: 28n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);

    // Self-send 2: spends one of the new shielded UTXOs (28 or 30).
    const sa4 = await walletB.getAddressAtIndex(4, { legacy: false });
    const sa5 = await walletB.getAddressAtIndex(5, { legacy: false });
    const tx3 = await walletB.sendManyOutputsTransaction([
      {
        address: sa4,
        value: 14n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa5,
        value: 12n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx3).not.toBeNull();
    await waitForTxReceived(walletB, tx3!.hash!);

    // Self-send 3: spends another (and must not pick spent UTXOs from tx2/tx3).
    const sa6 = await walletB.getAddressAtIndex(6, { legacy: false });
    const sa7 = await walletB.getAddressAtIndex(7, { legacy: false });
    const tx4 = await walletB.sendManyOutputsTransaction([
      {
        address: sa6,
        value: 6n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa7,
        value: 4n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx4).not.toBeNull();
    await waitForTxReceived(walletB, tx4!.hash!);
  });

  it('B.14 — Send essentially all shielded balance leaves no fabricated UTXO', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx1!.hash!);

    // Send essentially all 50n; protocol min 2 outputs, fee 2.
    const sa2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sa3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sa2,
        value: 47n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa3,
        value: 1n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);
    // Both tx1 UTXOs spent; 2 new shielded UTXOs created.
    expect(await countShieldedUtxos(walletB)).toBe(2);
  });

  it('B.12 — Send that fails pre-broadcast must not permanently delete shielded UTXOs', async () => {
    // If a send fails before (or during) tx-mining, the wallet must not
    // destroy UTXOs it had tentatively selected — otherwise a user hitting
    // "Send" on a bad transaction would lose the balance. We exercise this
    // by seeding walletB with shielded UTXOs, attempting a send that is
    // guaranteed to fail during the build phase (amount > available), and
    // asserting both the available shielded UTXO count and the balance are
    // preserved for a subsequent successful send.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const seed = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, seed!.hash!);

    // Give B a tiny transparent UTXO for AS fees but deliberately target
    // more value than is available, forcing the build to throw.
    const legacyB = await walletB.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, legacyB, 5n);

    const utxosBefore = await countShieldedUtxos(walletB);
    const balBefore = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(utxosBefore).toBe(2);
    expect(balBefore).toBe(55n);

    const sa0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(1, { legacy: false });
    await expect(
      walletB.sendManyOutputsTransaction([
        {
          address: sa0,
          value: 999999n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
        {
          address: sa1,
          value: 1n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow();

    // Post-failure: UTXO pool and balance must be intact.
    const utxosAfter = await countShieldedUtxos(walletB);
    const balAfter = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(utxosAfter).toBe(utxosBefore);
    expect(balAfter).toBe(balBefore);

    // And a follow-up legitimate send must succeed using those same UTXOs.
    const ok = await walletB.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(ok).not.toBeNull();
    await waitForTxReceived(walletB, ok!.hash!);
  });
});
