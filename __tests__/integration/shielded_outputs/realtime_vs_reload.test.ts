/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group R — Real-time vs reload invariant.
 *
 * The core invariant: after receiving a tx via the real-time websocket, the
 * per-tx balance delta (and wallet balance) observed by the receiver must
 * equal the delta observed by a fresh wallet reloaded from the same seed.
 * That invariant must hold for any combination of input types (transparent,
 * AmountShielded, FullShielded) and output types, because the same stored tx
 * must round-trip through both delivery modes to the same state.
 *
 * Previous bugs that these tests guard against:
 *   - onNewTx's final addTx(newTx) clobbering processHistory's decoded state
 *     on two-phase ws delivery (bare announce → full payload).
 *   - processShieldedOutputs silently skipping outputs whose decoded.address
 *     isn't yet in the wallet's cache, leaving the stored tx with outputs=[].
 *   - Missing safety-net retry when initial decryption silently fails.
 *
 * Each scenario follows the same shape:
 *   1. Build wallets (walletA funder, walletB subject-under-test with a
 *      deterministic seed so we can reload it).
 *   2. Position walletB with whatever prerequisite UTXOs the scenario needs.
 *   3. Execute the scenario's target tx and wait for real-time receipt.
 *   4. Record the per-tx delta and wallet balance observed in real-time.
 *   5. Stop walletB with cleanStorage so the reload path exercises the full
 *      sync+decrypt cycle (same code a force-close/reopen in mobile hits).
 *   6. Reload from the seed and record the post-reload delta and balance.
 *   7. Assert equality token-by-token.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitTxConfirmed,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { getGapLimitConfig } from '../utils/core.util';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

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

/**
 * Capture real-time balance+delta for a tx on a given wallet, then reload the
 * wallet from seed and capture the same data again. Asserts equality for every
 * token key in either snapshot. Returns the snapshots so individual tests can
 * also assert concrete values.
 */
async function assertRealtimeMatchesReload(
  walletB: HathorWallet,
  walletBSeed: string,
  txHash: string,
  tokensToCheck: string[]
): Promise<void> {
  // Real-time snapshots.
  const storedRealtime = await walletB.getTx(txHash);
  expect(storedRealtime).not.toBeNull();
  const deltaRealtime = await walletB.getTxBalance(storedRealtime!);
  const balanceRealtime: Record<string, bigint> = {};
  for (const uid of tokensToCheck) {
    balanceRealtime[uid] = (await walletB.getBalance(uid))[0].balance.unlocked;
  }

  // Reload. cleanStorage forces the full sync+decrypt cycle.
  await walletB.stop({ cleanStorage: true, cleanAddresses: true });
  const walletB2 = await reloadFromSeed(walletBSeed);

  // Post-reload snapshots.
  const storedReload = await walletB2.getTx(txHash);
  expect(storedReload).not.toBeNull();
  const deltaReload = await walletB2.getTxBalance(storedReload!);
  const balanceReload: Record<string, bigint> = {};
  for (const uid of tokensToCheck) {
    balanceReload[uid] = (await walletB2.getBalance(uid))[0].balance.unlocked;
  }

  // Every token the delta mentions must appear in both snapshots with the
  // same value. Missing keys are treated as 0n so that either snapshot
  // omitting a token is equivalent to showing 0.
  const tokenKeys = new Set([...Object.keys(deltaRealtime), ...Object.keys(deltaReload)]);
  for (const token of tokenKeys) {
    expect(deltaReload[token] ?? 0n).toBe(deltaRealtime[token] ?? 0n);
  }
  for (const uid of tokensToCheck) {
    expect(balanceReload[uid]).toBe(balanceRealtime[uid]);
  }

  await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
}

describe('shielded outputs — Group R: Real-time vs reload invariant', () => {
  jest.setTimeout(600_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('R.1 — T → T: pure transparent tx (baseline)', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const tx = await walletA.sendTransaction(addrB, 40n);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  it('R.2 — T → AS: transparent input, AmountShielded outputs', async () => {
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
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  it('R.3 — T → FS: transparent input, FullShielded outputs', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);
    // FS outputs need a custom token (native token can't be hidden via FS in
    // the current protocol rules); create one on walletA first.
    const tokenResp = await createTokenHelper(walletA, 'FSTok', 'FST', 500n, {
      address: await walletA.getAddressAtIndex(1, { legacy: true }),
    });
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 100n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sb1,
        value: 50n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [
      NATIVE_TOKEN_UID,
      tokenResp.hash,
    ]);
  });

  it('R.4 — T → AS+FS: mixed shielded output modes in one tx', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);
    const tokenResp = await createTokenHelper(walletA, 'MixTok', 'MXT', 500n, {
      address: await walletA.getAddressAtIndex(1, { legacy: true }),
    });
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 200n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [
      NATIVE_TOKEN_UID,
      tokenResp.hash,
    ]);
  });

  it('R.5 — T → T+AS: transparent + AmountShielded outputs together', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const sb0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      { address: addrB, value: 10n, token: NATIVE_TOKEN_UID },
      {
        address: sb0,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  it('R.6 — AS → T: unshielding HTR (shielded input, transparent output)', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 100n);
    // Shield most of the HTR onto walletB's own shielded addresses.
    const sb0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletB, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletB, shieldTx!.hash!);
    // Unshielding send: transparent output funded by the shielded UTXOs.
    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    const tx = await walletB.sendTransaction(addrA, 60n);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  it('R.7 — AS → AS: shielded self-send (the ws-real-time failure scenario)', async () => {
    // Reproduces the real-time vs reload divergence observed on mobile: a
    // tx spending a shielded UTXO and creating several shielded outputs back
    // to the same wallet. Real-time getTxBalance was returning
    // -input_value (no credit for the decoded shielded outputs), while
    // reload returned the correct near-zero self-send delta.
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 200n);
    // First shield some HTR onto walletB's own shielded addresses.
    const sb0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletB, shieldTx!.hash!);
    // Self-send: spend a shielded UTXO, create 3 shielded outputs on walletB.
    const sb2 = await walletB.getAddressAtIndex(3, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(4, { legacy: false });
    const sb4 = await walletB.getAddressAtIndex(5, { legacy: false });
    // We cannot avoid also selecting a transparent HTR UTXO for the AS fee,
    // so the tx will include a transparent input too — but the critical
    // coverage is a SHIELDED input being spent by walletB itself.
    const tx = await walletB.sendManyOutputsTransaction([
      {
        address: sb2,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb3,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb4,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    // Walletwide: this is a self-send. The delta must be close to 0 (only fee).
    // Reload must agree.
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  it('R.8 — AS → T+AS: shielded input, mixed transparent + shielded outputs', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 200n);
    const sb0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 60n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletB, shieldTx!.hash!);
    // Outgoing: one transparent output + 2 AS change back to walletB (min 2).
    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    const sb2 = await walletB.getAddressAtIndex(3, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(4, { legacy: false });
    const tx = await walletB.sendManyOutputsTransaction([
      { address: addrA, value: 30n, token: NATIVE_TOKEN_UID },
      {
        address: sb2,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb3,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  it('R.9 — FS → FS: FullShielded input and outputs (custom-token self-send)', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 200n);
    const tokenResp = await createTokenHelper(walletB, 'FSSelf', 'FSS', 500n, {
      address: await walletB.getAddressAtIndex(1, { legacy: true }),
    });
    // Shield most of the custom-token supply onto walletB's shielded addrs
    // (2 outputs min by protocol rule against trivial commitment matching).
    const sb0 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(3, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 300n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sb1,
        value: 100n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletB, shieldTx!.hash!);
    // FS self-send: spend the FS UTXOs, create two FS outputs back to walletB.
    const sb2 = await walletB.getAddressAtIndex(4, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(5, { legacy: false });
    const tx = await walletB.sendManyOutputsTransaction([
      {
        address: sb2,
        value: 250n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sb3,
        value: 150n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [
      NATIVE_TOKEN_UID,
      tokenResp.hash,
    ]);
  });

  it('R.11 — FS chain: 5 consecutive FS self-sends (mobile reproduction)', async () => {
    // Reproduces the mobile scenario: user repeatedly sends shielded txs
    // that spend the previous tx's shielded UTXO and create new shielded
    // outputs back to their own wallet. Mobile hits "asset commitment
    // verification failed" somewhere along this chain. This test walks the
    // exact chain and asserts every tx decodes.
    //
    // Uses HTR (not a custom token) because the fullnode's
    // `_update_token_info_from_inputs` currently skips shielded inputs when
    // validating custom-token balance, so a chain of FS→FS for a custom
    // token gets rejected at the fullnode ("no inputs for token X"). The
    // mobile reproduction uses HTR anyway.
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 1000n);
    // Seed FS UTXOs (HTR).
    const sbSeed0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sbSeed1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const seedTx = await walletB.sendManyOutputsTransaction([
      {
        address: sbSeed0,
        value: 500n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbSeed1,
        value: 400n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, seedTx!.hash!);
    await waitUntilNextTimestamp(walletB, seedTx!.hash!);

    // Chain N self-sends. Each spends a shielded UTXO and creates two more.
    // Addresses are picked from a rolling index so no collisions with seeds.
    const N = 5;
    let nextIdx = 10;
    let lastHash = seedTx!.hash!;
    for (let step = 0; step < N; step += 1) {
      const outAddr0 = await walletB.getAddressAtIndex(nextIdx, { legacy: false });
      nextIdx += 1;
      const outAddr1 = await walletB.getAddressAtIndex(nextIdx, { legacy: false });
      nextIdx += 1;
      const tx = await walletB.sendManyOutputsTransaction([
        {
          address: outAddr0,
          value: 100n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
        {
          address: outAddr1,
          value: 50n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
      ]);
      expect(tx).not.toBeNull();
      await waitForTxReceived(walletB, tx!.hash!);
      await waitUntilNextTimestamp(walletB, tx!.hash!);
      // Real-time decode check for THIS step. In the separated model the
      // decoded shielded outputs live in shielded_outputs[] (value written in
      // place for the owned slots), not appended into outputs[].
      const stored = await walletB.getTx(tx!.hash!);
      expect(stored).not.toBeNull();
      const decodedShieldedInOutputs = (stored!.shielded_outputs ?? []).filter(
        so => so.value !== undefined
      ).length;
      if (decodedShieldedInOutputs < 2) {
        throw new Error(
          `Step ${step + 1} (tx ${tx!.hash}): expected 2 decoded shielded outputs, ` +
            `got ${decodedShieldedInOutputs} — FS decryption failed.`
        );
      }
      lastHash = tx!.hash!;
    }
    // Final reload-equivalence check on the last tx.
    await assertRealtimeMatchesReload(walletB, walletDataB.words, lastHash, [NATIVE_TOKEN_UID]);
  });

  it('R.10 — AS+T → AS+T: mixed input types, mixed output types', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 200n);
    const sb0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletB, shieldTx!.hash!);
    // Spending a quantity that exceeds the transparent remainder will force
    // the selector to pick from both the transparent and shielded UTXOs.
    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    const sb2 = await walletB.getAddressAtIndex(3, { legacy: false });
    const sb3 = await walletB.getAddressAtIndex(4, { legacy: false });
    const tx = await walletB.sendManyOutputsTransaction([
      { address: addrA, value: 130n, token: NATIVE_TOKEN_UID },
      {
        address: sb2,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb3,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await assertRealtimeMatchesReload(walletB, walletDataB.words, tx!.hash!, [NATIVE_TOKEN_UID]);
  });

  /**
   * R.12 — Receive shielded HTR, wait for first_block confirmation, then
   * unshield. Reproduces the mobile bug where `processMetadataChanged`
   * (triggered by the WS metadata update on first_block) overwrote the
   * shielded UTXO with a record stripped of `shielded:true` and
   * `blindingFactor`. Subsequent unshielding then built a tx with no
   * `UnshieldBalanceHeader` and the fullnode rejected it with
   * "full-unshield tx (shielded inputs, no shielded outputs) must carry
   * an unshield balance header".
   *
   * Existing R.* tests don't catch this because they spend the shielded
   * UTXO inside the same second they receive it — before the fullnode's
   * confirmation update has had time to fire. Here we explicitly
   * `waitTxConfirmed` between the receive and the spend so the metadata
   * update is guaranteed to have arrived and been processed.
   */
  it('R.12 — confirmed shielded receive can still unshield (processMetadataChanged regression)', async () => {
    const walletDataB = precalculationHelpers.test!.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const walletA = await generateWalletHelper();

    // walletB receives 100 HTR transparent, then shields it onto its own
    // shielded addresses. The shielding tx itself doesn't trigger the bug
    // (it's a SEND, not a receive of a shielded output it now owns), but
    // it does create the shielded UTXOs we need.
    const addrB0 = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB0, 100n);
    const sb0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletB, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletB, shieldTx!.hash!);

    // Critical step: WAIT FOR FIRST_BLOCK. This is what every other R.*
    // test omits. Once first_block is set on the fullnode, the WS
    // metadata update fires, onNewTx routes it to processMetadataChanged,
    // and that's the call that re-saves the shielded UTXO. Without the
    // fix the re-save corrupts it.
    await waitTxConfirmed(walletB, shieldTx!.hash!, 30000);

    // Give the WS a beat to push the metadata update to the wallet and
    // for processMetadataChanged to finish writing through to storage.
    // 500ms is plenty against a privnet that mines blocks ~1s apart.
    // eslint-disable-next-line no-promise-executor-return
    await new Promise(r => setTimeout(r, 500));

    // Unshielding send: shielded UTXOs in, transparent output out. This
    // is the exact `prepareTxData` path where excessBlindingFactor is
    // computed iff `blindedInputsArr.length > 0`, which in turn requires
    // `utxo.shielded === true` on the picked UTXOs. If the metadata
    // update corrupted that flag, the fullnode rejects.
    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    const tx = await walletB.sendTransaction(addrA, 40n);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    // Recipient receives the unshielded HTR.
    await waitForTxReceived(walletA, tx!.hash!);
    expect((await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(40n);
  });
});
