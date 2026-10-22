/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group D — processHistory over a DIRTY store (the processTxQueue path).
 *
 * storage.processHistory() runs cleanMetadata() (wipes ALL utxos) then re-credits
 * each STORED tx, gated only on that tx's locally-stored spent_by. Both the
 * realtime path and processTxQueue (drains ws events buffered during sync,
 * wallet.ts:1660) call processHistory over the existing/dirty store — NOT a fresh
 * cleanStorage re-fetch (which is what realtime_vs_reload / wallet_restart
 * exercise). This pins that reprocessing a dirty store does NOT resurrect a spent
 * shielded UTXO. It is the targeted regression for removing the old per-tx
 * input-deletion loop from processHistory: the parent's spent_by is
 * reliably stamped (to_json_extended on both the address_history and ws paths),
 * and the wallet owns the parent output (so it receives that update), so the
 * surviving credit-gate (spent_by === null) is sufficient on its own.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group D: processHistory over a dirty store', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('D.1 — reprocessing a dirty store does not resurrect a spent shielded UTXO', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // walletA -> walletB: 50n shielded across 2 AmountShielded outputs.
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const recvTx = await walletA.sendManyOutputsTransaction([
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
    expect(recvTx).not.toBeNull();
    await waitForTxReceived(walletB, recvTx!.hash!);
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    // walletB spends its shielded 20n alone (unshield 20n back to walletA
    // transparent). The change is pinned transparent, which also turns off the
    // exact-match forcing: unpinned, the 20 matching 20n exactly would pull
    // the 30 in to force a shielded change, spending both UTXOs. Pinned, the
    // tx fully unshields the 20, with no change and no fee, and walletB keeps
    // the 30.
    const spendTx = await walletB.sendManyOutputsTransaction(
      [{ address: addrA, value: 20n, token: NATIVE_TOKEN_UID }],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );
    expect(spendTx).not.toBeNull();
    await waitForTxReceived(walletB, spendTx!.hash!);
    const balanceAfterSpend = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balanceAfterSpend).toBe(30n); // only the spent 20 left the balance

    // Reprocess history over the SAME (dirty) store — the processTxQueue path.
    // With the per-tx input-deletion loop removed, the spent shielded UTXO must
    // NOT be re-saved: the credit-gate skips it because the parent recv tx's
    // stored spent_by is non-null (the fullnode stamps it via to_json_extended).
    await walletB.storage.processHistory(walletB.pinCode ?? undefined);

    const balanceAfterReprocess = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    // No resurrection: reprocessing a dirty store leaves the balance unchanged.
    expect(balanceAfterReprocess).toBe(balanceAfterSpend);

    // And the spent UTXO is truly gone from selection: a follow-up send succeeds.
    // walletB holds only the shielded 30, so a resurrected 20 would be this
    // send's pick (the smallest UTXO that covers 5n), and that already-spent
    // input would fail full validation at the fullnode ('input already
    // spent'), rejecting this send.
    expect(balanceAfterReprocess).toBeGreaterThanOrEqual(10n);
    const followTx = await walletB.sendManyOutputsTransaction([
      { address: addrA, value: 5n, token: NATIVE_TOKEN_UID },
    ]);
    expect(followTx).not.toBeNull();
    await waitForTxReceived(walletB, followTx!.hash!);
  });
});
