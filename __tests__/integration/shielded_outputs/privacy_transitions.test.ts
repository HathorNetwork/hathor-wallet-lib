/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group P — Privacy mode transitions across input/output sets.
 *
 * Existing FS / AS suites cover homogeneous flows (T→T, T→A, T→F, A→A,
 * F→F, F→T, A→T). The remaining structural cells of the input × output
 * matrix are mode-mixing transitions: outputs that combine T+A or T+F or
 * A+F in one tx, inputs that combine A+F, and the privacy-upgrade /
 * privacy-downgrade transitions A→F and F→A. They exercise paths in
 * `createShieldedOutputs`, surjection-proof domain construction, and the
 * unshield-balance / shielded-balance dispatch that no other test reaches.
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

describe('shielded outputs — Group P: privacy-mode transitions', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * P.1 — `T → A+F` mixed shielded outputs in one tx. Sender has only
   * transparent HTR and produces both an AS and an FS output to the
   * recipient. Tests `createShieldedOutputs` building outputs of two
   * different modes in a single batch.
   */
  it('P.1 — T → A+F: one tx with both AS and FS outputs', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sbB1,
        value: 35n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);
    await waitForTxReceived(walletB, tx!.hash!);

    const balB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balB[0].balance.unlocked).toBe(60n);
  });

  /**
   * P.2 — `A → F`: privacy upgrade. Recipient who received AS HTR
   * upgrades it by sending FS to themselves (or another wallet). Spends
   * an AS UTXO and produces FS outputs.
   */
  it('P.2 — A → F: privacy upgrade (spend AS, emit FS)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    // Move A's HTR into AS UTXOs at B's address.
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const seedTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sbB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, seedTx!.hash!);
    await waitUntilNextTimestamp(walletA, seedTx!.hash!);

    // B (which holds AS HTR) needs transparent HTR for FS output fees.
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 30n);

    // B upgrades by sending FS to C.
    const sbC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const sbC1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const upgradeTx = await walletB.sendManyOutputsTransaction([
      {
        address: sbC0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbC1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(upgradeTx).not.toBeNull();
    await waitForTxReceived(walletB, upgradeTx!.hash!);
    await waitForTxReceived(walletC, upgradeTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(45n);
  });

  /**
   * P.3 — `F → A`: privacy downgrade. Symmetric to P.2 but the other
   * direction. Spends FS UTXOs and emits AS outputs.
   */
  it('P.3 — F → A: privacy downgrade (spend FS, emit AS)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const seedTx = await walletA.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletB, seedTx!.hash!);
    await waitUntilNextTimestamp(walletA, seedTx!.hash!);

    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 30n);

    const sbC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const sbC1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const downgradeTx = await walletB.sendManyOutputsTransaction([
      {
        address: sbC0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sbC1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(downgradeTx).not.toBeNull();
    await waitForTxReceived(walletB, downgradeTx!.hash!);
    await waitForTxReceived(walletC, downgradeTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(45n);
  });

  /**
   * P.4 — `F → A+T`: spend FS, emit AS + transparent in same tx. Mixed
   * output modes including a transparent destination.
   */
  it('P.4 — F → A+T: spend FS, mixed AS + transparent outputs', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();
    const walletD = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const seedTx = await walletA.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletB, seedTx!.hash!);
    await waitUntilNextTimestamp(walletA, seedTx!.hash!);

    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 30n);

    const sbC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const sbC1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const addrD = await walletD.getAddressAtIndex(0, { legacy: true });
    const mixedTx = await walletB.sendManyOutputsTransaction([
      {
        address: sbC0,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sbC1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: addrD,
        value: 8n,
        token: NATIVE_TOKEN_UID,
      },
    ]);
    expect(mixedTx).not.toBeNull();
    await waitForTxReceived(walletB, mixedTx!.hash!);
    await waitForTxReceived(walletC, mixedTx!.hash!);
    await waitForTxReceived(walletD, mixedTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(25n);
    const balD = await walletD.getBalance(NATIVE_TOKEN_UID);
    expect(balD[0].balance.unlocked).toBe(8n);
  });

  /**
   * P.5 — `A+F → T`: full unshield from a wallet that holds BOTH AS and
   * FS HTR UTXOs. Excess-blinding-factor calc must mix shielded inputs
   * from both modes.
   */
  it('P.5 — A+F → T: mixed AS+FS shielded inputs unshielded transparently', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 200n);

    // Round 1: A → B, AS outputs (B gets 60 HTR as AS).
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const asTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 35n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sbB1,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, asTx!.hash!);
    await waitUntilNextTimestamp(walletA, asTx!.hash!);

    // Round 2: A → B, FS outputs (B also gets 50 HTR as FS).
    const sbB2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sbB3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const fsTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB2,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB3,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, fsTx!.hash!);
    await waitUntilNextTimestamp(walletA, fsTx!.hash!);

    // B now holds AS + FS HTR. Transparent unshield to C should pull
    // from BOTH AS and FS UTXO pools depending on selector heuristics.
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const unshieldTx = await walletB.sendTransaction(addrC, 80n);
    expect(unshieldTx).not.toBeNull();
    await waitForTxReceived(walletB, unshieldTx!.hash!);
    await waitForTxReceived(walletC, unshieldTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(80n);
  });
});
