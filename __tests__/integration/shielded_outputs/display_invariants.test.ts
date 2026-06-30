/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group G — Invariants for what is shown to users about shielded txs.
 *
 * These protect against regressions in the tx-history/summary display layer,
 * where bugs typically look like:
 *   - per-tx deltas disagreeing with the summed wallet balance;
 *   - shielded txs missing from the history listing;
 *   - shielded amounts leaking into the (transparent) UTXO list.
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

describe('shielded outputs — Group G: Display invariants', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('G.30 — Sum of per-tx deltas equals the wallet balance', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    // Create a shielded receive on B.
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
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // Also a FullShielded receive.
    const sb2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx2 = await walletA.sendManyOutputsTransaction([
      {
        address: sb2,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sb3,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx2!.hash!);

    // Now sum the per-tx deltas B sees and compare with its total balance.
    const history = await walletB.getTxHistory();
    let sum = 0n;
    for (const entry of history) {
      const storedTx = await walletB.getTx(entry.txId);
      const delta = await walletB.getTxBalance(storedTx!);
      sum += (delta[NATIVE_TOKEN_UID] ?? 0n) as bigint;
    }
    const bal = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(sum).toBe(bal);
  });

  it('G.31 — Shielded receives appear in getTxHistory', async () => {
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

    const history = await walletB.getTxHistory();
    const found = history.find(h => h.txId === tx!.hash);
    expect(found).toBeDefined();
    expect((found!.balance as bigint) > 0n).toBe(true);
  });

  it('G.32 — Sender history: shielded-only tx is negative (fee) even with no transparent change', async () => {
    // If the sender spends every transparent sat as change (none lost), the
    // per-tx delta is still negative by the shielded fee. The history entry
    // must reflect that — no "zero tx" displayed.
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
    await waitForTxReceived(walletA, tx!.hash!);
    const delta = await walletA.getTxBalance((await walletA.getTx(tx!.hash!))!);
    expect((delta[NATIVE_TOKEN_UID] as bigint) < 0n).toBe(true);
  });

  it('G.33 — UTXOs returned by wallet.getUtxos do not double-count shielded + transparent', async () => {
    // The getUtxos API should not include shielded commitments as transparent
    // UTXOs — it would inflate the apparent balance.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    await walletA.sendManyOutputsTransaction([
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

    // Listing transparent UTXOs should be empty for walletB — its only
    // incoming value is shielded.
    const utxos = (await walletB.getUtxos()) as unknown as {
      utxos: { amount: bigint; tokenId: string }[];
      total_amount_available: bigint;
    };
    const summed = utxos.utxos
      .filter(u => u.tokenId === NATIVE_TOKEN_UID)
      .reduce((a, u) => a + BigInt(u.amount), 0n);
    // Transparent UTXO total should not contain the 50 HTR shielded amount.
    expect(summed).toBe(0n);
  });
});
