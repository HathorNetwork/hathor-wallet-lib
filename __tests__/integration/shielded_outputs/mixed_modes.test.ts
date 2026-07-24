/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group E — Mixed AmountShielded + FullShielded modes in the same transaction
 * and in chains of transactions.
 *
 * Also includes the "FULL FULL" test: a transaction whose inputs mix
 * transparent + AmountShielded + FullShielded AND whose outputs mix
 * transparent + AmountShielded + FullShielded, spanning every supported mode
 * simultaneously.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import {
  NATIVE_TOKEN_UID,
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
} from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group E: Mixed AS/FS modes', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('E.22 — Same tx: 1 AmountShielded + 1 FullShielded (plus 1 AS for the 2-output rule)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb2 = await walletB.getAddressAtIndex(2, { legacy: false });

    // The ≥2 shielded-outputs rule counts AS+FS together.
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
      {
        address: sb2,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);
    await waitForTxReceived(walletB, tx!.hash!);

    // Receiver sees 30+20+10 credited.
    const balB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balB[0].balance.unlocked).toBe(60n);

    // Sender: 200 - 60 spent - 2*FEE_AS - 1*FEE_FS.
    const balA = await walletA.getBalance(NATIVE_TOKEN_UID);
    const expectedFee = 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT + FEE_PER_FULL_SHIELDED_OUTPUT;
    expect(balA[0].balance.unlocked).toBe(200n - 60n - expectedFee);
  });

  it('E.23 — AS-only outputs followed by FS-only outputs to same wallet yield the sum', async () => {
    // Sequential txs: first AS, then FS (spending the AS change). Both credits
    // must add up correctly on the receiver side.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(3, { legacy: false });

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
    await waitForTxReceived(walletA, tx2!.hash!);
    await waitForTxReceived(walletB, tx2!.hash!);

    const balB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balB[0].balance.unlocked).toBe(75n);
  });

  it('E.24 — Spend AS UTXO and FS UTXO in the same tx (mixed-mode shielded inputs)', async () => {
    // Regression: the UTXO selector must be willing to pick both AS and FS
    // shielded UTXOs in the same outgoing tx when the receiver needs funds
    // that span modes. The fullnode happily verifies such a tx.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 300n);

    // Stage: fund walletB with one AS UTXO (30) and one FS UTXO (20).
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const seed1 = await walletA.sendManyOutputsTransaction([
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
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, seed1!.hash!);
    await waitForTxReceived(walletB, seed1!.hash!);
    await waitUntilNextTimestamp(walletA, seed1!.hash!);

    // Also give B some transparent HTR so FS-input fees can be paid from it.
    const legacyB = await walletB.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, legacyB, 20n);

    // B spends: target 40 (forcing selector to pick both the 30 AS + 20 FS).
    const sa0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
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
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);
    await waitForTxReceived(walletA, tx2!.hash!);
    // A's per-tx delta for tx2 is what walletA received from the mixed-mode
    // spend: 25 + 15 = 40. Checking the per-tx delta rather than the wallet
    // total avoids entangling with earlier staging txs that walletA also owns.
    const aDelta = await walletA.getTxBalance((await walletA.getTx(tx2!.hash!))!);
    expect(aDelta[NATIVE_TOKEN_UID]).toBe(40n);
  });

  it('E.25 — Chain AS → FS → AS across three wallets', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    // A → B as AS.
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

    // Give B transparent HTR for FS-output fees (FS fees charged on outputs).
    const legacyB = await walletB.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, legacyB, 30n);

    // B → C as FS (spending AS UTXOs from tx1).
    const sc0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const sc1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sc0,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sc1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx2!.hash!);
    await waitForTxReceived(walletC, tx2!.hash!);
    await waitUntilNextTimestamp(walletB, tx2!.hash!);

    // Give C transparent HTR for AS-output fees.
    const legacyC = await walletC.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletC, legacyC, 30n);

    // C → A as AS (spending FS UTXOs from tx2).
    const sa0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const tx3 = await walletC.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletC, tx3!.hash!);
    await waitForTxReceived(walletA, tx3!.hash!);

    // Final sanity: A sees 25 more HTR via AS decryption after the round-trip.
    const aDelta = await walletA.getTxBalance((await walletA.getTx(tx3!.hash!))!);
    expect(aDelta[NATIVE_TOKEN_UID]).toBe(25n);
  });

  it('E.26 — FULL FULL: transparent + AS + FS inputs AND outputs in a single tx', async () => {
    // The "kitchen-sink" case. A single transaction with three distinct
    // input types AND three distinct output types:
    //   Inputs : 1 transparent + ≥1 AmountShielded + ≥1 FullShielded
    //   Outputs: 1 transparent + 1 AmountShielded + 1 FullShielded
    //            (AS + FS = 2 shielded outputs, satisfying the ≥2 rule)
    //
    // UTXO sizes are chosen so that NO two-pool combination covers the spend,
    // which forces the selector to draw from all three pools. After the send,
    // we snapshot the pre-tx UTXOs and verify at least one from each pool was
    // consumed, so a regression in the selector can't silently fall back to a
    // 2-pool pick.

    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, addrA, 500n);

    // Stage 1: give B two AmountShielded UTXOs totaling 15n (10 + 5).
    const sbAS0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbAS1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const txAS = await walletA.sendManyOutputsTransaction([
      {
        address: sbAS0,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sbAS1,
        value: 5n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, txAS!.hash!);
    await waitForTxReceived(walletB, txAS!.hash!);
    await waitUntilNextTimestamp(walletA, txAS!.hash!);

    // Stage 2: give B two FullShielded UTXOs totaling 15n (10 + 5).
    const sbFS0 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sbFS1 = await walletB.getAddressAtIndex(3, { legacy: false });
    const txFS = await walletA.sendManyOutputsTransaction([
      {
        address: sbFS0,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbFS1,
        value: 5n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, txFS!.hash!);
    await waitForTxReceived(walletB, txFS!.hash!);
    await waitUntilNextTimestamp(walletA, txFS!.hash!);

    // Stage 3: give B a single transparent UTXO of 20n.
    const legacyB = await walletB.getAddressAtIndex(10, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, legacyB, 20n);

    // Snapshot B's UTXOs by type before the FULL FULL send. Each UTXO is
    // tagged as transparent, AmountShielded, or FullShielded so we can later
    // check which pools the tx drew from.
    type UtxoKind = 'transparent' | 'amountShielded' | 'fullShielded';
    function classify(u: { shielded?: boolean; assetBlindingFactor?: string }): UtxoKind {
      if (!u.shielded) return 'transparent';
      return u.assetBlindingFactor !== undefined ? 'fullShielded' : 'amountShielded';
    }
    const preMap = new Map<string, UtxoKind>();
    for await (const u of walletB.storage.selectUtxos({ token: NATIVE_TOKEN_UID })) {
      preMap.set(`${u.txId}:${u.index}`, classify(u));
    }
    const preCounts = { transparent: 0, amountShielded: 0, fullShielded: 0 };
    for (const kind of preMap.values()) preCounts[kind] += 1;
    expect(preCounts).toEqual({ transparent: 1, amountShielded: 2, fullShielded: 2 });

    // FULL FULL spend:
    //   outputs = 15 (T) + 10 (AS) + 10 (FS) = 35n
    //   fees    = 1*FEE_AS + 1*FEE_FS        =  3n
    //   total   = 38n
    //
    // Pool totals: T=20, AS=15, FS=15; all pairwise sums ≤ 35 < 38. Only the
    // full three-pool sum (50n) covers 38n, so the selector MUST pick from
    // transparent, AmountShielded, and FullShielded inputs simultaneously.
    const addrADest = await walletA.getAddressAtIndex(5, { legacy: true });
    const saAS = await walletA.getAddressAtIndex(6, { legacy: false });
    const saFS = await walletA.getAddressAtIndex(7, { legacy: false });
    const fullfull = await walletB.sendManyOutputsTransaction([
      { address: addrADest, value: 15n, token: NATIVE_TOKEN_UID },
      {
        address: saAS,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: saFS,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(fullfull).not.toBeNull();
    await waitForTxReceived(walletB, fullfull!.hash!);
    await waitForTxReceived(walletA, fullfull!.hash!);

    // Assert the tx actually used at least one input from each of the three
    // pools by resolving each stored input against the pre-tx snapshot.
    const stored = await walletB.getTx(fullfull!.hash!);
    const spentByKind = { transparent: 0, amountShielded: 0, fullShielded: 0 };
    for (const input of stored!.inputs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = `${(input as any).tx_id ?? (input as any).txId}:${input.index}`;
      const kind = preMap.get(key);
      if (kind) spentByKind[kind] += 1;
    }
    expect(spentByKind.transparent).toBeGreaterThanOrEqual(1);
    expect(spentByKind.amountShielded).toBeGreaterThanOrEqual(1);
    expect(spentByKind.fullShielded).toBeGreaterThanOrEqual(1);

    // Receiver A sees the full 35 HTR (15 transparent + 10 AS + 10 FS decoded).
    const aDelta = await walletA.getTxBalance((await walletA.getTx(fullfull!.hash!))!);
    expect(aDelta[NATIVE_TOKEN_UID]).toBe(35n);

    // Sender B's delta is negative (spent 35 + 3 fee).
    const bDelta = await walletB.getTxBalance((await walletB.getTx(fullfull!.hash!))!);
    expect(bDelta[NATIVE_TOKEN_UID]).toBeLessThan(0n);
  });

  it('E.27 — FS→FS send when wallet has 0 transparent HTR must work (FIX-30)', async () => {
    // TODO_FIX_30: a tx whose only inputs are FullShielded HTR has
    // transparent_inputs=0; any HTR fee or transparent change would make
    // the fullnode's transparent balance check fail with "invalid surplus
    // of HTR". Fix expectation: either (a) the wallet force-selects a
    // transparent HTR UTXO to cover the fee, or (b) hathor-core's
    // is_shielded skip correctly zeroes the check and the tx is accepted.
    //
    // Setup:
    //   1. Inject 100 HTR into walletA (transparent).
    //   2. walletA self-sends 96 HTR as two FS outputs (48 each), paying
    //      4 HTR of FS fees transparent → walletA has 0 transparent HTR
    //      and 96 HTR in two FS UTXOs.
    //   3. walletA FS→FS sends 50 HTR to walletB (2 FS outputs, 4 HTR fee).
    //      All inputs are FS. Must NOT be rejected by the fullnode.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Fund walletA's FS pool: 96 HTR into 2 FS outputs (48+48), costing
    // 4 HTR of FS fees paid transparent. After this walletA holds exactly
    // 0 transparent HTR.
    const saA0 = await walletA.getAddressAtIndex(1, { legacy: false });
    const saA1 = await walletA.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletA.sendManyOutputsTransaction([
      {
        address: saA0,
        value: 48n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA1,
        value: 48n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletA, shieldTx!.hash!);

    // Sanity: walletA has 0 transparent HTR, 96 HTR FS.
    const htrBal = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(htrBal[0].balance.unlocked).toBe(96n);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyTransparentHtr: any[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const u of walletA.storage.selectUtxos({ token: NATIVE_TOKEN_UID })) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anyTransparentHtr.push(u as any);
    }
    for (const u of anyTransparentHtr) {
      expect(u.shielded).toBe(true);
    }

    // FS→FS send of 50 HTR to walletB. All inputs are FS (walletA has no
    // transparent HTR). Outputs = 50 FS + 42 FS change = 92; inputs = 96;
    // deficit 4 = fee. Transparent side is 0 in / 0 out / 4 fee → is_shielded
    // skip must apply.
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sendTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB1,
        value: 42n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(sendTx).not.toBeNull();
    await waitForTxReceived(walletA, sendTx!.hash!);
    await waitForTxReceived(walletB, sendTx!.hash!);

    const balB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balB[0].balance.unlocked).toBe(92n);
  });

  it('E.28 — FS → FS → FS across three wallets (FIX-18 surjection domain)', async () => {
    // TODO_FIX_18: spending a received FullShielded UTXO to create new FS
    // outputs requires the surjection-proof domain to contain the input's
    // on-chain `asset_commitment` (blinded generator), NOT the unblinded
    // `derive_asset_tag(token_uid)`. If the wallet passes ZERO_TWEAK for a
    // shielded input's blinding factor, the fullnode's verifier reconstructs
    // a different generator than the one the wallet signed against and the
    // proof fails — tx rejected.
    //
    // walletA → walletB (FS): walletB now owns an FS UTXO with a non-zero
    //                         asset_blinding_factor.
    // walletB → walletC (FS): walletB must pass that abf into
    //                         createShieldedOutputs so the surjection proof
    //                         uses the blinded generator the fullnode sees.
    // walletC receives and decrypts correctly.
    //
    // E.25 tests AS→FS→AS which indirectly exercises this, but that middle
    // hop spends AS inputs (unblinded generator is correct for AS). This
    // test pins the specifically-FS-input case.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    // A → B as FS. walletB now owns 2 FS HTR UTXOs with random asset
    // blinding factors (that's what FullShielded means).
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, tx1!.hash!);
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // Give B transparent HTR for the second hop's FS fees.
    const legacyB = await walletB.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, legacyB, 30n);

    // B → C as FS, spending FS UTXOs from tx1. This is the surjection-
    // domain-sensitive hop: the proof must use walletB's FS-UTXO asset
    // commitment (blinded) as the domain, reconstructed from the input's
    // asset_blinding_factor stored alongside the UTXO at receive time.
    const scC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const scC1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: scC0,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: scC1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx2!.hash!);
    await waitForTxReceived(walletC, tx2!.hash!);

    // C decrypted correctly → received 20 + 15 = 35 HTR via the FS outputs.
    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(35n);
  });
});
