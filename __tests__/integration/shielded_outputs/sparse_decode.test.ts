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
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

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
   * on-chain absolute index (`outputs.length + shielded_slot`), which is
   * at/past `origTx.outputs.length` because outputs[] is transparent-only
   * and the shielded outputs live in `origTx.shielded_outputs[]` (the wallet
   * owns only one of the parent's two shielded outputs, but the full ordered
   * list is present, owned + non-owned).
   *
   * The input must resolve arithmetically via `resolveSpentOutput` to
   * `shielded_outputs[index - outputs.length]` — the genuine spent slot. A
   * positional `origTx.outputs[index]` (or any non-arithmetic lookup) would
   * mis-resolve or fall through un-enriched; the balance input loop then
   * skips it (`input.token === undefined`) and the FS UTXO's value is never
   * debited — walletA's balance stays inflated by exactly that value.
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

  it("N.7 — sender spends a shielded UTXO whose on-chain index falls INSIDE the wallet's outputs[] range (recipient's confidential output sits at a LOWER on-chain idx, shifting the wallet's decoded entries down by 1)", async () => {
    // Reproduces the mobile-wallet bug observed by a real user.
    //
    // Setup: walletA sends a tx with three AmountShielded outputs in this order:
    //   [recipient B, walletA self#1, walletA self#2]
    //
    // The recipient's confidential output therefore lands at the LOWEST shielded
    // on-chain index. WalletA decodes only its own two outputs — the recipient's
    // entry is undecryptable for walletA (value stays undefined), but the FULL
    // ordered shielded list is kept in tx.shielded_outputs[].
    //
    // For the resulting parent tx the layout becomes (T = outputs.length = 1):
    //   on-chain idx 0: transparent change                       (outputs[0])
    //   on-chain idx 1 = T+0: shielded to B      (shielded_outputs[0], not owned)
    //   on-chain idx 2 = T+1: shielded self#1    (shielded_outputs[1], value 50)
    //   on-chain idx 3 = T+2: shielded self#2    (shielded_outputs[2], value 40)
    //
    // Now walletA sends everything to walletC, consuming all three UTXOs as inputs.
    // The spending tx's inputs reference the parent at on-chain indices 0, 2, 3.
    //
    // The trap is the input that references on-chain idx 2 (walletA self#1):
    //   - input.index = 2, T = parent.outputs.length = 1
    //   - idx >= T → resolveSpentOutput returns shielded_outputs[idx - T] =
    //     shielded_outputs[1] = self#1 (value 50). CORRECT.
    //   - A naive positional `origTx.outputs[2]` is undefined (outputs has length
    //     1), and the old sparse-append model returned the WRONG appended entry
    //     (self#2, value 40) — a 10-HTR phantom remainder. The arithmetic resolver
    //     lands on the genuine slot regardless of how many slots are owned.
    //
    // The assertion below catches this directly: a transparent send (no fee) of
    // `sendAmount` MUST decrement walletA's balance by exactly `sendAmount`. With
    // the bug the decrement is `sendAmount - 10`.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 200n);

    // Distinct shielded addresses for the two self-outputs so saveAddress
    // doesn't collapse them; B's recipient address is on its own chain.
    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(5, { legacy: false });
    const sa2 = await walletA.getAddressAtIndex(6, { legacy: false });

    // Order matters: recipient FIRST so its confidential output occupies
    // shielded_outputs[0] — the on-chain index that the walletA can't decode.
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa2,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    const balABefore = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    // walletA's HTR balance: 200 - 30 (to B) - 50 (A self#1) - 40 (A self#2) - 3 fee = 77 transparent
    // + 50 + 40 = 167 total.
    expect(balABefore).toBe(167n);

    // Send essentially everything to walletC. With 167 total and 1 left as
    // transparent change, the wallet has to consume ALL three UTXOs as
    // inputs — including the bug-triggering walletA self#1 UTXO at parent
    // on-chain idx 2.
    const sendAmount = 166n;
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const finalTx = await walletA.sendTransaction(addrC, sendAmount);
    expect(finalTx).not.toBeNull();
    await waitForTxReceived(walletA, finalTx!.hash!);
    await waitForTxReceived(walletC, finalTx!.hash!);

    // On-chain ground truth: walletC received exactly `sendAmount` (transparent send, no fee).
    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(sendAmount);

    // Regression assertion. balanceBefore - balanceAfter MUST equal sendAmount.
    // With the bug, the A self#1 input enrichment fetches A self#2's value (40)
    // via positional fallback instead of A self#1's actual value (50), so
    // token-meta is debited 10 short → balanceAfter is 11 instead of 1 →
    // (balanceBefore - balanceAfter) = 156 instead of 166.
    const balAAfter = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balABefore - balAAfter).toBe(sendAmount);
  });

  it('N.8 — wallet state survives a processHistory reload after sparse-decode + spend', async () => {
    // Reload-from-history is what runs on every fresh wallet boot, on every
    // safety-net retry (wallet.ts:1818-1834), and any time the wallet calls
    // `storage.processHistory()` to rebuild metadata from scratch. The loop
    // iterates every stored tx in chronological order and re-runs
    // processNewTx, and it also has its own per-tx UTXO-cleanup safety-net
    // loop that resolved spent outputs via positional lookup. With the old
    // positional code, that loop could either over-delete (when the
    // positional entry happened to be the wallet's other decoded shielded
    // output) or fail to delete (when the positional entry was undefined),
    // leaving the spent UTXO behind. Result: the next send either fails
    // validation ("input already spent") or double-debits token-meta.
    //
    // This test exercises the full reload-then-send cycle on a sparse-
    // decode-shaped wallet and asserts that the wallet's balance counter
    // is identical pre- and post-reload AND that a follow-up send succeeds.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 200n);

    // Recipient first → its confidential output sits at the lowest shielded
    // on-chain index, shifting walletA's two decoded entries DOWN.
    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(7, { legacy: false });
    const sa2 = await walletA.getAddressAtIndex(8, { legacy: false });
    const splitTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa2,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(splitTx).not.toBeNull();
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitForTxReceived(walletB, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    // First spend: amount > transparent change + smaller shielded UTXO so
    // the selector has to pick the larger sparse-decoded shielded UTXO too.
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const firstSendAmount = 160n;
    const firstTx = await walletA.sendTransaction(addrC, firstSendAmount);
    expect(firstTx).not.toBeNull();
    await waitForTxReceived(walletA, firstTx!.hash!);
    await waitForTxReceived(walletC, firstTx!.hash!);

    const balBeforeReload = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balBeforeReload).toBe(167n - firstSendAmount);

    // Force a processHistory rebuild. This rewinds wallet metadata and
    // replays every stored tx through processNewTx + the safety-net
    // input-cleanup loop. The helper must keep the state coherent across
    // this rebuild.
    await walletA.storage.processHistory(DEFAULT_PIN_CODE);

    const balAfterReload = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balAfterReload).toBe(balBeforeReload);
    // Guard the next assertions: balAfterReload must be > 0 by construction
    // (we sent 160 out of 167) but be loud if some upstream change ever
    // breaks that assumption.
    expect(balAfterReload).toBeGreaterThan(0n);

    // Follow-up send must succeed (proves no phantom UTXO leaked through
    // the reload and no UTXO got mis-flagged as spent). Drain the wallet
    // entirely so the assertion is unambiguous.
    const secondTx = await walletA.sendTransaction(addrC, balAfterReload);
    expect(secondTx).not.toBeNull();
    await waitForTxReceived(walletA, secondTx!.hash!);
    await waitForTxReceived(walletC, secondTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(firstSendAmount + balAfterReload);

    const balAFinal = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balAFinal).toBe(0n);
  });
});
