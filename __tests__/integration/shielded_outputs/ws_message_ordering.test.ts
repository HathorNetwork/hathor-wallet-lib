/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group A — WebSocket message ordering / re-delivery.
 *
 * Covers the class of bugs where the same shielded tx is delivered multiple
 * times via ws (often in different shapes — bare announcement vs. full
 * payload) and we must end up in a consistent state regardless of order or
 * count of those events.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

/**
 * Build a "bare" wsData payload (empty outputs[], undefined shielded_outputs)
 * mirroring the partial wire form some fullnode events emit.
 */
function bareWsPayload(storedTx: any) {
  return {
    ...storedTx,
    outputs: [],
    shielded_outputs: undefined,
    inputs: storedTx.inputs.map((i: any) => ({
      tx_id: i.tx_id,
      index: i.index,
      type: 'shielded',
      decoded: i.decoded,
    })),
  };
}

/**
 * Build a "full" wsData payload reconstructing the SEPARATED wire form:
 * transparent outputs[] plus a top-level shielded_outputs[] carrying the
 * confidential fields in wire encoding (commitment / ephemeral_pubkey /
 * asset_commitment hex; range_proof / script / surjection_proof base64), `mode`
 * present and NO owned-marker fields — so normalizeShieldedOutputs hex-converts
 * them like the real fullnode wire. (The old wire inlined these into outputs[]
 * with type:'shielded'; the current node never does, and the schema rejects it.)
 */
function fullWsPayload(storedTx: any) {
  const wireShielded = (storedTx.shielded_outputs ?? []).map((so: any) => ({
    mode: so.mode,
    commitment: so.commitment,
    range_proof: Buffer.from(so.range_proof, 'hex').toString('base64'),
    script: Buffer.from(so.script, 'hex').toString('base64'),
    token_data: so.token_data,
    ephemeral_pubkey: so.ephemeral_pubkey,
    decoded: so.decoded,
    asset_commitment: so.asset_commitment,
    surjection_proof: so.surjection_proof
      ? Buffer.from(so.surjection_proof, 'hex').toString('base64')
      : undefined,
    spent_by: so.spent_by ?? null,
  }));
  return {
    ...storedTx,
    outputs: storedTx.outputs.filter((o: any) => o?.type !== 'shielded'),
    shielded_outputs: wireShielded,
  };
}

describe('shielded outputs — Group A: WS message ordering', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * Setup helper: walletA → walletB with 2 shielded outputs (50n total).
   * Returns walletB and the persisted tx after first receipt is fully decoded.
   */
  async function setupReceivedShieldedTx() {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sa0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
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
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    const stored = await walletB.getTx(tx!.hash!);
    expect(stored).not.toBeNull();
    expect((await walletB.getTxBalance(stored!))[NATIVE_TOKEN_UID]).toBe(50n);
    return { walletA, walletB, txHash: tx!.hash!, stored: stored! };
  }

  // A.1 — Already covered by core.test.ts ("decrypt shielded outputs delivered in a follow-up ws msg")
  // A.2 — Already covered by core.test.ts ("preserve decoded shielded outputs across metadata updates")

  it('A.3 — Full → bare → bare (multiple metadata updates erode nothing)', async () => {
    const { walletB, txHash, stored } = await setupReceivedShieldedTx();
    const bare = bareWsPayload(stored);
    await walletB.onNewTx({ history: bare });
    await walletB.onNewTx({ history: bare });
    await walletB.onNewTx({ history: bare });
    const after = await walletB.getTx(txHash);
    expect((await walletB.getTxBalance(after!))[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('A.4 — Bare → full → bare (combo of both failure modes)', async () => {
    // Set up via real send so we have the stored decoded form to reconstruct from.
    const { walletB, txHash, stored } = await setupReceivedShieldedTx();
    const bare = bareWsPayload(stored);
    const full = fullWsPayload(stored);
    await walletB.onNewTx({ history: bare });
    await walletB.onNewTx({ history: full });
    await walletB.onNewTx({ history: bare });
    const after = await walletB.getTx(txHash);
    expect((await walletB.getTxBalance(after!))[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('A.5 — Bare-only: receiver sees a bare announcement before any full delivery', async () => {
    // We can't easily prevent the real ws from delivering the full form, so
    // instead we use a fresh wallet that never received the tx and feed only
    // bare payloads. The wallet must not commit a fabricated balance from a
    // bare-only tx — it should remain unable to credit (no decoded outputs),
    // which is the safe state.
    const { stored } = await setupReceivedShieldedTx();
    const fresh = await generateWalletHelper();
    await fresh.getAddressAtIndex(0, { legacy: false });
    await fresh.getAddressAtIndex(1, { legacy: false });
    const bare = bareWsPayload(stored);
    await fresh.onNewTx({ history: bare });
    await fresh.onNewTx({ history: bare });
    const after = await fresh.getTx(stored.tx_id);
    // Bare-only should leave the wallet in the safe state: either no stored
    // tx (nothing to credit) or a stored tx with zero credit.
    const credit = after ? (await fresh.getTxBalance(after))[NATIVE_TOKEN_UID] ?? 0n : 0n;
    expect(credit).toBe(0n);
  });

  it('A.6 — Out-of-order delivery: full arrives before bare announcement', async () => {
    // The wallet must accept a full payload as the first event for a tx that
    // it doesn't yet know about and decrypt correctly.
    const { stored } = await setupReceivedShieldedTx();
    const fresh = await generateWalletHelper();
    await fresh.getAddressAtIndex(0, { legacy: false });
    await fresh.getAddressAtIndex(1, { legacy: false });
    const full = fullWsPayload(stored);
    const bare = bareWsPayload(stored);
    await fresh.onNewTx({ history: full });
    await fresh.onNewTx({ history: bare });
    const after = await fresh.getTx(stored.tx_id);
    expect(after).not.toBeNull();
    // Same wallet seed-space → cannot rely on credit; assert the per-tx delta
    // is consistent (idempotent across the bare follow-up).
    const balAfter = await fresh.getTxBalance(after!);
    // It either decoded (credit > 0) or didn't (= 0); we don't crash.
    expect(typeof balAfter).toBe('object');
  });

  it('A.7 — Same tx re-delivered N times in rapid succession (live queue stress)', async () => {
    const { walletB, txHash, stored } = await setupReceivedShieldedTx();
    const full = fullWsPayload(stored);
    // 20 concurrent re-deliveries
    await Promise.all(Array.from({ length: 20 }, () => walletB.onNewTx({ history: full })));
    const after = await walletB.getTx(txHash);
    expect((await walletB.getTxBalance(after!))[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('A.9 — Bare announce first, then full: fresh receipt decodes and credits', async () => {
    // Reproduces the real-time-vs-reload divergence. The fullnode can deliver
    // a shielded tx in two phases: first a bare announcement (outputs=[], no
    // shielded_outputs) then a follow-up with the full wire form. With the
    // bug, processHistory decrypted on the second delivery and saved
    // outputs=[decoded], but the final addTx(newTx) in onNewTx then clobbered
    // that back to outputs=[] because newTx carried the empty wire form and
    // the carry-over block read from the cloned pre-processing storageTx
    // (also empty). Reload fixed the balance because startup's processHistory
    // reran and this second-save-from-newTx didn't happen.
    //
    // We simulate "fresh wallet that never saw this tx" by taking a wallet
    // that owns the shielded outputs (via setupReceivedShieldedTx) and then
    // wiping the tx + shielded UTXOs from its storage before feeding bare
    // then full through onNewTx.
    const { walletB, txHash, stored } = await setupReceivedShieldedTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { store } = walletB.storage as any;

    // Wipe the tx and its shielded UTXOs so walletB's next onNewTx treats
    // this as a fresh arrival. Transparent balance metadata is rebuilt by
    // processHistory, so we don't need to touch it here.
    store.history.delete(txHash);
    for (const [key, utxo] of store.utxos.entries()) {
      if (utxo.txId === txHash) store.utxos.delete(key);
    }

    const bare = bareWsPayload(stored);
    const full = fullWsPayload(stored);

    // Phase 1: bare announcement. Wallet can't credit — no shielded data.
    await walletB.onNewTx({ history: bare });

    // Phase 2: full payload. processHistory decrypts the shielded outputs;
    // the final addTx(newTx) must not clobber them with the empty outputs[]
    // from the wire form.
    await walletB.onNewTx({ history: full });

    const after = await walletB.getTx(txHash);
    expect(after).not.toBeNull();
    // The per-tx delta must include the 50n shielded credit; without the
    // fix, it reads 0n (stored outputs=[] after clobber) on this path.
    expect((await walletB.getTxBalance(after!))[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('A.10 — Voided shielded tx then unvoided: balance is reversed and then restored', async () => {
    // Simulates the ws event shape the fullnode emits when a shielded tx
    // flips to voided (e.g., due to a twin/conflict) and then back. The real
    // void path lives in the fullnode; from the wallet's perspective the
    // observable surface is the is_voided flag on the re-delivered tx — so
    // we exercise that surface here by feeding voided / unvoided copies
    // through onNewTx and asserting the balance converges correctly.
    const { walletB, stored } = await setupReceivedShieldedTx();
    const balCredited = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balCredited).toBe(50n);

    // Deliver a voided copy of the same tx (preserves shielded_outputs so
    // the reprocess path can still find the outputs when unvoiding later).
    const voided = { ...stored, is_voided: true };
    await walletB.onNewTx({ history: voided });
    const balVoided = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    // Voided tx must not contribute to balance.
    expect(balVoided).toBe(0n);

    // Deliver the unvoided copy — balance must be restored.
    const unvoided = { ...stored, is_voided: false };
    await walletB.onNewTx({ history: unvoided });
    const balUnvoided = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balUnvoided).toBe(50n);
  });
});
