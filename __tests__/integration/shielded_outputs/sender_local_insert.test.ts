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
});
