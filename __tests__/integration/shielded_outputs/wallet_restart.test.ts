/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group F — Persistence of shielded state across wallet restart.
 *
 * When a wallet is stopped and restarted (new storage instance, same seed),
 * it must:
 *   - Recover the shielded balance it had before the restart;
 *   - Keep shielded UTXOs spendable (no re-decode mismatch);
 *   - Recover FullShielded balances the same way;
 *   - Recover across several sequential shielded receives.
 *
 * Restart pattern mirrors the one in core.test.ts that exercises this flow
 * end-to-end: stop with cleanStorage+cleanAddresses, then start a brand-new
 * HathorWallet from the same seed with scanPolicy set to the gap-limit
 * config so the sync can discover the shielded outputs at non-zero indices.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateConnection,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { getGapLimitConfig } from '../utils/core.util';
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

async function reloadFromSeed(words: string): Promise<HathorWallet> {
  const wallet = new HathorWallet({
    seed: words,
    connection: generateConnection(),
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    scanPolicy: getGapLimitConfig(),
  });
  await wallet.start();
  await waitForWalletReady(wallet);
  return wallet;
}

describe('shielded outputs — Group F: Wallet restart persistence', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('F.27 — AmountShielded balance recovered after restart', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

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
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    await walletB.stop({ cleanStorage: true, cleanAddresses: true });

    const walletB2 = await reloadFromSeed(walletDataB.words);
    expect((await walletB2.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);
    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('F.28 — Shielded UTXO remains spendable after restart', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

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
    await waitUntilNextTimestamp(walletA, tx!.hash!);

    // Restart B with clean storage so the sync has to re-decode the shielded
    // outputs from the fullnode's history.
    await walletB.stop({ cleanStorage: true, cleanAddresses: true });
    const walletB2 = await reloadFromSeed(walletDataB.words);
    expect((await walletB2.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    // Give B2 transparent HTR for AS fees on the outgoing tx.
    const legacyB = await walletB2.getAddressAtIndex(5, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB2, legacyB, 10n);

    // Spend the recovered shielded UTXOs.
    const sa0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB2.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 20n,
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
    await waitForTxReceived(walletB2, tx2!.hash!);
    await waitForTxReceived(walletA, tx2!.hash!);
    const aDelta = await walletA.getTxBalance((await walletA.getTx(tx2!.hash!))!);
    expect(aDelta[NATIVE_TOKEN_UID]).toBe(35n);
    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('F.29 — FullShielded balance recovered after restart', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    await walletB.stop({ cleanStorage: true, cleanAddresses: true });
    const walletB2 = await reloadFromSeed(walletDataB.words);
    expect((await walletB2.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);
    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('F.30 — Many shielded txs: all recovered after restart', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 500n);

    // Send 3 sequential shielded txs, interleaving AS and FS.
    let total = 0n;
    for (let i = 0; i < 3; i++) {
      const s0 = await walletB.getAddressAtIndex(i * 2, { legacy: false });
      const s1 = await walletB.getAddressAtIndex(i * 2 + 1, { legacy: false });
      const mode =
        i % 2 === 0 ? ShieldedOutputMode.AMOUNT_SHIELDED : ShieldedOutputMode.FULLY_SHIELDED;
      const tx = await walletA.sendManyOutputsTransaction([
        { address: s0, value: 10n, token: NATIVE_TOKEN_UID, shielded: mode },
        { address: s1, value: 5n, token: NATIVE_TOKEN_UID, shielded: mode },
      ]);
      await waitForTxReceived(walletA, tx!.hash!);
      await waitForTxReceived(walletB, tx!.hash!);
      await waitUntilNextTimestamp(walletA, tx!.hash!);
      total += 15n;
    }
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(total);

    await walletB.stop({ cleanStorage: true, cleanAddresses: true });
    const walletB2 = await reloadFromSeed(walletDataB.words);
    expect((await walletB2.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(total);
    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  /**
   * F.13 — Sparse-decoded UTXOs survive a wallet restart with the
   * commitment-match recovery path.
   *
   * Scenario: walletA sends an FS tx with outputs to BOTH walletB AND
   * itself in the same tx. walletA's wallet stores the change as a
   * sparse-decoded UTXO (only one of the parent's two shielded outputs
   * is owned). After restart, the wallet re-syncs history; the saveUtxo
   * loop must reach the commitment-match fallback because the cached
   * tx.outputs entry from re-decode is freshly produced (and so does
   * carry `onChainIndex`), but a wallet upgrading from a pre-fix
   * persisted store WOULDN'T have that field — the fallback walks
   * tx.shielded_outputs by commitment to recover the right index.
   *
   * Pinning the post-restart spend ensures the fallback path is exercised
   * and the recovered UTXO is truly spendable.
   */
  it('F.13 — sparse-decode UTXO is spendable after restart', async () => {
    const walletDataA = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletA = await generateWalletHelper({
      seed: walletDataA.words,
      preCalculatedAddresses: walletDataA.addresses,
    });
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
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, splitTx!.hash!);
    await waitUntilNextTimestamp(walletA, splitTx!.hash!);

    await walletA.stop({ cleanStorage: true, cleanAddresses: true });
    const walletA2 = await reloadFromSeed(walletDataA.words);

    // After restart, balance includes both transparent change and FS change.
    const balA2 = await walletA2.getBalance(NATIVE_TOKEN_UID);
    expect(balA2[0].balance.unlocked).toBeGreaterThanOrEqual(60n);

    // Force-spend through the FS UTXO: send more than transparent change.
    const transparentChange = balA2[0].balance.unlocked - 20n;
    const sendAmount = transparentChange + 10n;
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const finalTx = await walletA2.sendTransaction(addrC, sendAmount);
    expect(finalTx).not.toBeNull();
    await waitForTxReceived(walletC, finalTx!.hash!);

    const balC = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balC[0].balance.unlocked).toBe(sendAmount);

    await walletA2.stop({ cleanStorage: true, cleanAddresses: true });
  });
});
