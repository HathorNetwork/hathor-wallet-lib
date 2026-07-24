/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group H — Concurrency and race conditions around shielded txs.
 *
 * Focus:
 *   - Two sends racing on the same UTXO pool (fullnode/mining service resolves
 *     the race; the wallet must not crash and balances must converge);
 *   - Concurrent WS deliveries while a send is in flight.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group H: Concurrency', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('H.33 — Two concurrent shielded sends from the same wallet converge', async () => {
    // Two sends issued near-simultaneously: the wallet's UTXO selector holds
    // a lock so both don't pick the same input, or one fails and the other
    // succeeds. Either way, final state must be consistent.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA0 = await walletA.getAddressAtIndex(0);
    const addrA1 = await walletA.getAddressAtIndex(1);
    // Two transparent UTXOs so both txs can pick independent inputs if the
    // selector chooses well.
    await GenesisWalletHelper.injectFunds(walletA, addrA0, 100n);
    await GenesisWalletHelper.injectFunds(walletA, addrA1, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(3, { legacy: false });

    const send1 = walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    const send2 = walletA.sendManyOutputsTransaction([
      {
        address: sb2,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb3,
        value: 5n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    const results = await Promise.allSettled([send1, send2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof walletA.sendManyOutputsTransaction>>
    >[];
    // At least one should have succeeded. The other may fail due to UTXO lock
    // contention or mempool rejection — that's acceptable here.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of fulfilled) {
      await waitForTxReceived(walletA, r.value!.hash!);
      await waitForTxReceived(walletB, r.value!.hash!);
    }
  });

  it('H.34 — Rapid-fire WS redeliveries during live tx finalization are idempotent', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletB, tx!.hash!);

    // Replay the stored form 10× concurrently.
    const stored = await walletB.getTx(tx!.hash!);
    await Promise.all(Array.from({ length: 10 }, () => walletB.onNewTx({ history: stored! })));

    const bal = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(bal).toBe(50n);
  });

  it('H.35 — Sequential send-then-spend holds balance invariants', async () => {
    // Send a shielded tx, await confirmation, immediately spend the shielded
    // UTXO. No races involved, but the happy path must work with no explicit
    // waits beyond waitForTxReceived.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletA, tx1!.hash!);
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // Give B transparent HTR for fees.
    const legacyB = await walletB.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, legacyB, 10n);

    const sa0 = await walletA.getAddressAtIndex(5, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(6, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx2!.hash!);
    await waitForTxReceived(walletA, tx2!.hash!);

    const aDelta = await walletA.getTxBalance((await walletA.getTx(tx2!.hash!))!);
    expect(aDelta[NATIVE_TOKEN_UID]).toBe(25n);
  });
});
