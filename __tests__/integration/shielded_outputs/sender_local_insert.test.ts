/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group L — Sender-side local insert populates shielded_outputs in storage.
 *
 * Regression for the bug where `convertTransactionToHistoryTx` dropped
 * `tx.shieldedOutputs` entirely, producing a history tx with
 * `outputs: []` and no `shielded_outputs` field. The locally-pushed history
 * tx was then saved to storage before any websocket delivery, and
 * `processNewTx` skipped decryption (shieldedCount=0). The bug was masked
 * in other tests by the Docker fullnode's websocket re-delivering the tx
 * with full `shielded_outputs`, which triggered `shieldedNewlyAvailable`
 * and a retry decrypt. On testnet fullnodes whose websocket events do not
 * carry shielded data, the bug is visible: the sender debits the input but
 * never credits back self-sent shielded outputs, and the per-tx UI balance
 * is stuck at -input_value until a full reload.
 *
 * These tests pin the invariant directly at the conversion layer so the
 * bug can't recur regardless of websocket behavior.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import transactionUtils from '../../../src/utils/transaction';
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

describe('shielded outputs — Group L: sender-side local insert', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * L.1 — `convertTransactionToHistoryTx` must emit `shielded_outputs`
   *
   * Pure unit-level check at the conversion boundary: build a shielded tx
   * (without pushing it to the fullnode, so websocket cannot influence
   * anything) and verify the resulting history tx carries every shielded
   * output from the source Transaction. If this assertion ever fails, the
   * sender-side local self-insert regresses to writing bare storage and
   * the downstream decryption gate will silently skip outputs.
   */
  it('L.1 — convertTransactionToHistoryTx emits shielded_outputs for AmountShielded', async () => {
    const walletA: HathorWallet = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddr0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await walletA.getAddressAtIndex(1, { legacy: false });

    // Build + sign WITHOUT pushing — this gives us the final Transaction object
    // that `sendTransaction.ts` would have passed to convertTransactionToHistoryTx.
    const sendTx = await walletA.sendManyOutputsSendTransaction([
      {
        address: shieldedAddr0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    const tx = await sendTx.run('sign-tx');
    // run('sign-tx') stops before mining, so tx.hash is still null. Compute it
    // from the signed structure directly — convertTransactionToHistoryTx
    // requires a non-null hash to build its output (the mined nonce would
    // change the hash, but for this unit-style assertion we only care that
    // the conversion function accepts the Transaction and emits shielded_outputs).
    tx.updateHash();
    expect(tx.shieldedOutputs.length).toBe(2);

    const historyTx = await transactionUtils.convertTransactionToHistoryTx(tx, walletA.storage);

    // Primary invariant: shielded_outputs array is present and has the right count.
    expect(historyTx.shielded_outputs).toBeDefined();
    expect(historyTx.shielded_outputs!.length).toBe(2);

    for (let i = 0; i < 2; i += 1) {
      const so = historyTx.shielded_outputs![i];
      const orig = tx.shieldedOutputs[i];

      // Mode must match the source ShieldedOutput — AmountShielded here.
      expect(so.mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      // Hex encoding round-trips back to the same bytes the rewind will use.
      expect(so.commitment).toBe(orig.commitment.toString('hex'));
      expect(so.range_proof).toBe(orig.rangeProof.toString('hex'));
      expect(so.script).toBe(orig.script.toString('hex'));
      expect(so.token_data).toBe(orig.tokenData);
      expect(so.ephemeral_pubkey).toBe(orig.ephemeralPubkey.toString('hex'));
      // AmountShielded outputs have no asset_commitment / surjection_proof.
      expect(so.asset_commitment).toBeUndefined();
      expect(so.surjection_proof).toBeUndefined();
      // Decoded address must parse from the P2PKH script so processShieldedOutputs
      // can look up addressInfo and derive the scan privkey.
      expect(so.decoded?.address).toBeDefined();
      expect(typeof so.decoded!.address).toBe('string');
    }
  });

  it('L.2 — convertTransactionToHistoryTx emits shielded_outputs for FullShielded', async () => {
    const walletA: HathorWallet = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddr0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await walletA.getAddressAtIndex(1, { legacy: false });

    const sendTx = await walletA.sendManyOutputsSendTransaction([
      {
        address: shieldedAddr0,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    const tx = await sendTx.run('sign-tx');
    // run('sign-tx') stops before mining, so tx.hash is still null. Compute it
    // from the signed structure directly — convertTransactionToHistoryTx
    // requires a non-null hash to build its output (the mined nonce would
    // change the hash, but for this unit-style assertion we only care that
    // the conversion function accepts the Transaction and emits shielded_outputs).
    tx.updateHash();
    expect(tx.shieldedOutputs.length).toBe(2);

    const historyTx = await transactionUtils.convertTransactionToHistoryTx(tx, walletA.storage);

    expect(historyTx.shielded_outputs).toBeDefined();
    expect(historyTx.shielded_outputs!.length).toBe(2);

    for (let i = 0; i < 2; i += 1) {
      const so = historyTx.shielded_outputs![i];
      const orig = tx.shieldedOutputs[i];

      // FullShielded: mode=2 and both asset_commitment + surjection_proof present.
      // Without these, processShieldedOutputs would take the AmountShielded branch
      // and the rewind would fail against a blinded generator.
      expect(so.mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(so.asset_commitment).toBeDefined();
      expect(so.asset_commitment).toBe(orig.assetCommitment!.toString('hex'));
      expect(so.surjection_proof).toBeDefined();
      expect(so.surjection_proof).toBe(orig.surjectionProof!.toString('hex'));
      expect(so.commitment).toBe(orig.commitment.toString('hex'));
      expect(so.range_proof).toBe(orig.rangeProof.toString('hex'));
      expect(so.ephemeral_pubkey).toBe(orig.ephemeralPubkey.toString('hex'));
      expect(so.decoded?.address).toBeDefined();
    }
  });

  /**
   * L.3 — end-to-end sender-side invariant: after `sendManyOutputsTransaction`
   * resolves and the first `new-tx` event fires (which can be either the
   * locally-pushed self-insert or a websocket re-delivery, whichever happens
   * first), storage MUST contain `shielded_outputs` for the new tx. Before the
   * fix, if the local self-insert won the race, storage was left bare and the
   * wallet never decrypted the self-sent outputs.
   */
  it('L.3 — self-send FullShielded: storage has shielded_outputs after send resolves', async () => {
    const walletA: HathorWallet = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddr0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await walletA.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddr0,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    expect(tx!.hash).toBeDefined();

    await waitForTxReceived(walletA, tx!.hash!);

    const storedTx = await walletA.storage.getTx(tx!.hash!);
    expect(storedTx).not.toBeNull();
    // Storage must have shielded_outputs either way — from the local self-insert
    // (with the fix) or from websocket re-delivery (when the fullnode cooperates).
    // Before the fix, if the local self-insert saved first and the websocket
    // later delivered a bare form (as observed on the testnet fullnode), storage
    // would be stuck with no shielded_outputs and the per-tx balance would be
    // wrong until a full reload.
    expect(storedTx!.shielded_outputs).toBeDefined();
    expect(storedTx!.shielded_outputs!.length).toBe(2);
    expect(storedTx!.shielded_outputs![0].mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
    expect(storedTx!.shielded_outputs![1].mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
  });

  /**
   * L.4 — `convertTransactionToHistoryTx` must stamp `type: 'shielded'`
   * on inputs that spend shielded outputs.
   *
   * Regression: before the fix, the sender-local insert produced inputs
   * indistinguishable from transparent ones (no `type` field, value/
   * token/decoded all populated from the spent shielded output). The
   * primary symptom was that `getShieldedUnblindingForTx` early-skipped
   * every input on a self-sent tx (`input.type !== 'shielded'`),
   * so the share-unblinding URL the mobile wallet built carried only
   * `outputs[]` and the explorer rendered all inputs as Confidential.
   */
  it('L.4 — convertTransactionToHistoryTx tags type=shielded on inputs spending shielded UTXOs', async () => {
    const walletA: HathorWallet = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Step 1: create shielded UTXOs the wallet owns and drain the
    // transparent funds. The minimum-2 rule (introduced when the send
    // pipeline tightened — see sendTransaction.ts:498) requires two
    // shielded outputs; the values are sized to consume the full 100n
    // injected above (49 + 49 + 2n fee = 100n), so step 2 has nothing
    // but shielded UTXOs to pick from. Without draining transparent,
    // the UTXO selector prefers transparent inputs in step 2 and the
    // shielded-input assertion at the bottom of this test fails.
    const shieldedAddr0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const fundShieldedTx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddr0,
        value: 49n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 49n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(fundShieldedTx).not.toBeNull();
    await waitForTxReceived(walletA, fundShieldedTx!.hash!);

    // Step 2: build a second tx that spends the shielded UTXOs we just
    // created. `sign-tx` stops before mining so we can inspect the
    // history-tx shape from the signed structure directly, before any
    // websocket delivery has a chance to overwrite it. Two shielded
    // outputs for the same protocol minimum reason as step 1.
    const shieldedAddr2 = await walletA.getAddressAtIndex(2, { legacy: false });
    const shieldedAddr3 = await walletA.getAddressAtIndex(3, { legacy: false });
    const spendTx = await walletA.sendManyOutputsSendTransaction([
      {
        address: shieldedAddr2,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr3,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    const tx = await spendTx.run('sign-tx');
    tx.updateHash();

    const historyTx = await transactionUtils.convertTransactionToHistoryTx(tx, walletA.storage);

    // At least one input must be flagged as shielded — the one
    // referencing the shielded UTXO from step 1.
    const shieldedInputs = historyTx.inputs.filter(
      i => (i as { type?: string }).type === 'shielded'
    );
    expect(shieldedInputs.length).toBeGreaterThanOrEqual(1);

    // Each shielded input must still reference its parent so
    // `getShieldedUnblindingForTx` can perform the parent-opening lookup.
    for (const input of shieldedInputs) {
      expect(input.tx_id).toBeDefined();
      expect(typeof input.index).toBe('number');
    }
  });

  /**
   * L.5 — `convertTransactionToHistoryTx` must survive a UTXO record
   *        racing with WebSocket-driven `processNewTx` deletion.
   *
   * Reproduces the headless-wallet log error
   *   "Index (1) outside of transaction output array bounds (5) and no
   *    stored UTXO recovery for tx_id=…"
   *
   * which fires when these two paths interleave (real symptom against a
   * local fullnode with sub-millisecond broadcast):
   *
   *   1. handlePushTx pushes a shielded-spending tx; pushTx resolves.
   *   2. handlePushTx kicks off `convertTransactionToHistoryTx` as a
   *      fire-and-forget IIFE — NOT awaited before the HTTP response is
   *      returned (sendTransaction.ts:835).
   *   3. Meanwhile, the fullnode re-delivers the same tx over the
   *      WebSocket; `onNewTx` → `processNewTx` runs, sees the shielded
   *      input, and DELETES the spent UTXO from storage.
   *   4. The IIFE then reaches `storage.getUtxo({txId, index})`, finds
   *      nothing, and throws.
   *
   * The fix lives in `convertTransactionToHistoryTx`: when
   * `findSpentOutput` returns a decoded shielded entry on the parent,
   * read value/token/decoded directly from that entry — the parent-tx
   * record survives WS-driven UTXO deletion, so the local-insert path
   * stays correct regardless of who wins the race.
   *
   * We simulate the race by deleting the spent UTXO from storage
   * immediately after `sign-tx` returns (i.e. before the local-insert
   * step in real code). Before the fix this throws; after the fix the
   * conversion succeeds and emits a properly-tagged shielded input.
   */
  it('L.5 — convertTransactionToHistoryTx survives concurrent UTXO deletion (WS-race)', async () => {
    const walletA: HathorWallet = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Same shape as L.4: fund shielded UTXOs and drain transparent, so
    // the spend tx is forced to pick at least one shielded input.
    const shieldedAddr0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const fundShieldedTx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddr0,
        value: 49n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 49n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(fundShieldedTx).not.toBeNull();
    await waitForTxReceived(walletA, fundShieldedTx!.hash!);

    const shieldedAddr2 = await walletA.getAddressAtIndex(2, { legacy: false });
    const shieldedAddr3 = await walletA.getAddressAtIndex(3, { legacy: false });
    const spendTx = await walletA.sendManyOutputsSendTransaction([
      {
        address: shieldedAddr2,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr3,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    const tx = await spendTx.run('sign-tx');
    tx.updateHash();

    // Simulate the WS-driven UTXO deletion winning the race against the
    // sender-local insert. For every input that references a shielded
    // UTXO this wallet owns, delete the UTXO record from the store.
    // This leaves the parent tx (and its decoded shielded output entry)
    // in storage, exactly like `processNewTx` would after running
    // `store.deleteUtxo` on the spent input.
    let deletedAtLeastOne = false;
    for (const input of tx.inputs) {
      const utxo = await walletA.storage.getUtxo({ txId: input.hash, index: input.index });
      if (utxo?.shielded) {
        await walletA.storage.store.deleteUtxo(utxo);
        deletedAtLeastOne = true;
      }
    }
    expect(deletedAtLeastOne).toBe(true);

    // With the fix in place, the conversion succeeds: it reads from the
    // parent's stored output entry instead of the now-deleted UTXO.
    // Without the fix, this throws "...no stored UTXO recovery for
    // tx_id=…".
    const historyTx = await transactionUtils.convertTransactionToHistoryTx(tx, walletA.storage);

    const shieldedInputs = historyTx.inputs.filter(
      i => (i as { type?: string }).type === 'shielded'
    );
    expect(shieldedInputs.length).toBeGreaterThanOrEqual(1);

    // The reconstructed fields must come from the parent's spent output
    // entry: value and token must both be present and non-trivial
    // (defensive against a buggy fallback that emits 0n / empty string).
    for (const input of shieldedInputs) {
      expect(input.tx_id).toBeDefined();
      expect(typeof input.index).toBe('number');
      expect((input as { value?: bigint }).value).toBeDefined();
      expect((input as { value?: bigint }).value).not.toBe(0n);
      expect((input as { token?: string }).token).toBeDefined();
      expect((input as { token?: string }).token).not.toBe('');
    }
  });
});
