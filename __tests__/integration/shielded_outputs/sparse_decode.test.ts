/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group N — Sparse-shielded-decode regression.
 *
 * Bug (fixed): when a wallet processes a tx and decodes only SOME of the
 * tx's shielded outputs (because the rest belong to other wallets), the
 * decoded entries get appended to `tx.outputs` and the saveUtxo loop
 * iterates `tx.outputs.entries()` to record each UTXO's index. The
 * entries() position is the entry's position in the MUTATED array, but the
 * on-chain absolute index the fullnode uses to resolve the spent output
 * is `transparent_count + shielded_array_idx`. When all shielded outputs
 * are owned, those numbers coincide; when only some are owned, they drift,
 * and saveUtxo records the wrong index for the owned shielded UTXOs.
 * Spending later sends `input.index = wrong_value`, the fullnode resolves
 * to a different output (someone else's) with a different pubkey hash,
 * and the input script's OP_EQUALVERIFY fails:
 *   `full validation failed: Failed to verify if elements are equal`
 *
 * The shipped FS / AS test suites all happen to satisfy "wallet owns every
 * shielded output of every tx it decodes" (sender == recipient self-sends,
 * or sends-without-self-change), so the buggy positional indexing produces
 * the right number by coincidence and no test ever fired the regression.
 *
 * The minimum trigger pattern is: a single tx that has shielded outputs
 * going to TWO different wallets — one address belongs to the sender (or
 * to the wallet under test) and the other does not. That wallet's history
 * sync sparse-decodes only the owned output, mis-indexes it, and a
 * subsequent spend of that UTXO fails on-chain.
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
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

describe('shielded outputs — Group N: sparse-shielded-decode regression', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * N.1 — Sender's FS change is spendable when the tx also outputs to a
   * different wallet. WalletA sends FS to walletB AND to its own shielded
   * address in the SAME tx. WalletA's storage, after processing the tx,
   * holds exactly one shielded UTXO (the change to itself) — but the parent
   * tx on-chain has TWO shielded outputs (B's + A's). WalletA must spend
   * its FS change later without OP_EQUALVERIFY firing.
   */
  it('N.1 — sender FS change is spendable after a partial-self-and-other FS send', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    // Fund A with transparent HTR.
    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    // A sends 30 HTR FS to B and 20 HTR FS back to itself in the same tx.
    // The on-chain layout is `transparent_change + shielded[B-out, A-out]`.
    // A's wallet, when it processes its own tx, can rewind only the A-out
    // shielded entry — the bug's sparse-decode trigger.
    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA = await walletA.getAddressAtIndex(2, { legacy: false });
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    // Sanity — A's HTR balance includes both the transparent change and
    // the FS-to-self change. Exact figure depends on the FS fee
    // (FEE_PER_FULL_SHIELDED_OUTPUT × 2 outputs).
    const balA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balA[0].balance.unlocked).toBeGreaterThanOrEqual(60n);

    // Spend an amount that forces the wallet to consume BOTH the
    // transparent change AND the FS change UTXO. That makes the FS UTXO
    // appear as an input to `walletC` send and exercises the on-chain
    // resolve_spent_output path that fails for mis-indexed shielded UTXOs.
    const transparentChange = balA[0].balance.unlocked - 20n;
    const sendAmount = transparentChange + 10n; // > transparent alone

    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const finalTx = await walletA.sendTransaction(addrC, sendAmount);
    expect(finalTx).not.toBeNull();
    await waitForTxReceived(walletA, finalTx!.hash!);
    await waitForTxReceived(walletC, finalTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(sendAmount);
  });

  /**
   * N.2 — Same trigger via AmountShielded instead of FullShielded. AS
   * outputs use the same on-chain script template as FS (P2PKH on the
   * spend-derived key) and live in the same `shielded_outputs` array, so
   * the indexing bug is mode-agnostic. This guards against a future change
   * that breaks AS while leaving FS green.
   */
  it('N.2 — sender AS change is spendable after a partial-self-and-other AS send', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA = await walletA.getAddressAtIndex(2, { legacy: false });
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: saA,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    const balA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balA[0].balance.unlocked).toBeGreaterThanOrEqual(60n);

    const transparentChange = balA[0].balance.unlocked - 20n;
    const sendAmount = transparentChange + 10n;

    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const finalTx = await walletA.sendTransaction(addrC, sendAmount);
    expect(finalTx).not.toBeNull();
    await waitForTxReceived(walletA, finalTx!.hash!);
    await waitForTxReceived(walletC, finalTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(sendAmount);
  });

  /**
   * N.3 — Sparse decode where the OWNED entry is a non-prefix subset of
   * the shielded outputs. WalletA sends shielded outputs to B (index 0),
   * back to itself (index 1), and to C (index 2). A only owns shielded[1].
   * On-chain absolute index for A's UTXO is `transparent_count + 1`,
   * which won't coincide with any plausible positional indexing if A's
   * decoded entry is appended as the only shielded entry. Pinned here so
   * any future regression that re-introduces positional indexing — even
   * for a "middle of the array" pattern — fails immediately.
   */
  it('N.3 — sender owns a middle shielded output (non-prefix sparse subset)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();
    const walletD = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 200n);

    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA = await walletA.getAddressAtIndex(3, { legacy: false });
    const sbC = await walletC.getAddressAtIndex(0, { legacy: false });
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbC,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitForTxReceived(walletC, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    const balA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balA[0].balance.unlocked).toBeGreaterThanOrEqual(40n);

    // Force-spend the FS-change UTXO: send more than the transparent
    // remainder so the wallet must include the FS UTXO as an input.
    const transparentChange = balA[0].balance.unlocked - 30n;
    const sendAmount = transparentChange + 15n;

    const addrD = await walletD.getAddressAtIndex(0, { legacy: true });
    const finalTx = await walletA.sendTransaction(addrD, sendAmount);
    expect(finalTx).not.toBeNull();
    await waitForTxReceived(walletA, finalTx!.hash!);
    await waitForTxReceived(walletD, finalTx!.hash!);

    const balD = await walletD.getBalance(NATIVE_TOKEN_UID);
    expect(balD[0].balance.unlocked).toBe(sendAmount);
  });

  /**
   * N.4 — Recipient also sees a sparse subset. WalletA sends FS to two
   * recipients (B and C) in the same tx. Each recipient owns ONE of the
   * two shielded outputs and must spend it correctly. The mirror of N.1
   * from the recipient side.
   */
  it('N.4 — recipient sparse-subset: each recipient spends only its own shielded output', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();
    const walletDest = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbC = await walletC.getAddressAtIndex(0, { legacy: false });
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbC,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitForTxReceived(walletC, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    // Each recipient sparse-decodes (owns 1 of 2 shielded outputs). Both
    // must spend cleanly.
    const addrDest = await walletDest.getAddressAtIndex(0, { legacy: true });
    const sendB = await walletB.sendTransaction(addrDest, 30n);
    expect(sendB).not.toBeNull();
    await waitForTxReceived(walletDest, sendB!.hash!);

    const sendC = await walletC.sendTransaction(addrDest, 25n);
    expect(sendC).not.toBeNull();
    await waitForTxReceived(walletDest, sendC!.hash!);

    const balDest = await walletDest.getBalance(NATIVE_TOKEN_UID);
    expect(balDest[0].balance.unlocked).toBe(55n);
  });

  /**
   * N.5 — Second-hop after sparse decode. After a sparse-decode receive,
   * the recipient FS-spends the UTXO into a NEW tx that ITSELF has sparse
   * shielded outputs (some to a third party, some change). Pin that the
   * indexing fix holds across multiple hops, not just the first send.
   */
  it('N.5 — second-hop FS send after a sparse-decode receive', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();
    const walletD = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    // Hop 1 — A sends sparse FS (one to B, one to A's own change addr).
    const sbB1 = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA1 = await walletA.getAddressAtIndex(2, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sbB1,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletA, tx1!.hash!);
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // Hop 2 — B sends sparse FS too (one to C, one back to B).
    const sbC2 = await walletC.getAddressAtIndex(0, { legacy: false });
    const sbB2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sbC2,
        value: 12n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB2,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);
    await waitForTxReceived(walletC, tx2!.hash!);
    await waitUntilNextTimestamp(walletB, tx2!.hash!);

    // Hop 3 — C unshields its FS receive (transparent send to D).
    const addrD = await walletD.getAddressAtIndex(0, { legacy: true });
    const tx3 = await walletC.sendTransaction(addrD, 12n);
    expect(tx3).not.toBeNull();
    await waitForTxReceived(walletC, tx3!.hash!);
    await waitForTxReceived(walletD, tx3!.hash!);

    const balD = await walletD.getBalance(NATIVE_TOKEN_UID);
    expect(balD[0].balance.unlocked).toBe(12n);
  });

  /**
   * N.6 — Sender's balance counter is correctly debited after spending a
   * sparse-decoded self-change UTXO.
   *
   * The N.1–N.5 tests above all assert recipient-side balance, which is
   * correct on-chain regardless of the sender's bookkeeping bug — the
   * fullnode resolves inputs by absolute index, signs are checked, and
   * the recipient gets what was sent. The bug this test pins is in the
   * SENDER's `processNewTx` input-enrichment loop: when walletA processes
   * the spending tx it just broadcast, the FS input cites the parent's
   * on-chain absolute index, which is past `origTx.outputs.length` for
   * sparse-decoded parents (the wallet only owns one of the parent's two
   * shielded outputs, so origTx.outputs holds just the transparent change
   * + the one decoded shielded entry — length 2, not 3).
   *
   * Without the `onChainIndex` lookup fallback at
   * `src/utils/storage.ts` (~ line 1204), that input falls through every
   * enrichment branch and reaches `continue` un-enriched. The balance
   * input loop then skips it (`input.token === undefined`) and the FS
   * UTXO's value is never debited — walletA's balance stays inflated by
   * exactly the spent FS UTXO's value.
   */
  it("N.6 — sender's balance correctly debits the sparse-decoded UTXO after spending", async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    // Same sparse-trigger setup as N.1: 30 FS to B, 20 FS back to self.
    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA = await walletA.getAddressAtIndex(2, { legacy: false });
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    const balABefore = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balABefore).toBeGreaterThanOrEqual(60n);

    // Force consumption of the FS-to-self UTXO by sending more than the
    // transparent change alone could cover.
    const transparentChange = balABefore - 20n;
    const sendAmount = transparentChange + 10n;

    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const finalTx = await walletA.sendTransaction(addrC, sendAmount);
    expect(finalTx).not.toBeNull();
    await waitForTxReceived(walletA, finalTx!.hash!);
    await waitForTxReceived(walletC, finalTx!.hash!);

    // On-chain ground truth: walletC received exactly `sendAmount`.
    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(sendAmount);

    // Regression assertion: walletA's balance counter dropped by EXACTLY
    // `sendAmount` (transparent send has no fee — recipient gets the full
    // amount, sender loses the same). If the FS input's enrichment had
    // failed, the FS UTXO value (20n) would not be debited and the delta
    // would be `sendAmount - 20n` instead.
    const balAAfter = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balABefore - balAAfter).toBe(sendAmount);
  });
});
