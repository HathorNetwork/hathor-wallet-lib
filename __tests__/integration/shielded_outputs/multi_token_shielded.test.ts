/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group Q — Multi-token shielded txs.
 *
 * Until now every shielded test exercises a single token per tx (HTR or
 * one custom). The surjection-proof domain construction only sees one
 * token UID, asset blinding factor pairs are uniform, and the balance
 * equation has a trivial single-generator structure. This group covers
 * txs that genuinely span MULTIPLE tokens at the shielded layer.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group Q: multi-token shielded txs', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * Q.1 — Single tx with FS HTR output AND FS custom-token output. The
   * surjection-proof domain spans two distinct token tags (HTR and the
   * custom token). The crypto provider must compute one balancing
   * blinding factor for HTR and one for the custom token; the proof
   * verifier on the fullnode must accept both.
   */
  it('Q.1 — FS HTR + FS custom-token in the same tx', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'MultiTok', 'MTT', 1000n, {
      address: mintAddr,
    });

    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sbB2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sbB3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB2,
        value: 200n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB3,
        value: 100n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);
    await waitForTxReceived(walletB, tx!.hash!);

    const balBHtr = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balBHtr[0].balance.unlocked).toBe(40n);
    const balBTok = await walletB.getBalance(tokenResp.hash);
    expect(balBTok[0].balance.unlocked).toBe(300n);
  });

  /**
   * Q.2 — A tx that BOTH spends and emits FS for two different tokens.
   * Spend FS HTR + FS custom token, emit transparent change of both. The
   * unshield-balance excess scalar must satisfy the HTR generator's
   * balance; the custom token's balance is checked per-generator.
   */
  it('Q.2 — multi-token unshield: spend FS HTR + FS token, emit transparent', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 200n);

    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'TwoTok', 'TWT', 1000n, {
      address: mintAddr,
    });

    // Move HTR + custom-token to walletB as FS.
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const sbB2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const sbB3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const seedTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 35n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB1,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB2,
        value: 400n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbB3,
        value: 200n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, seedTx!.hash!);
    await waitUntilNextTimestamp(walletA, seedTx!.hash!);

    // B unshields BOTH tokens to walletC in one tx.
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const tx = await walletB.sendManyOutputsTransaction([
      {
        address: addrC,
        value: 40n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: addrC,
        value: 350n,
        token: tokenResp.hash,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);
    await waitForTxReceived(walletC, tx!.hash!);

    const balCHtr = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balCHtr[0].balance.unlocked).toBe(40n);
    const balCTok = await walletC.getBalance(tokenResp.hash);
    expect(balCTok[0].balance.unlocked).toBe(350n);
  });

  // Helpers shared by Q.3–Q.5: count this wallet's UNLOCKED shielded
  // and transparent HTR UTXOs by value. The split is the same
  // private-vs-public split the mobile UI shows.
  // eslint-disable-next-line jest/no-export
  const sumHtrByPool = async (wallet: Awaited<ReturnType<typeof generateWalletHelper>>) => {
    let shielded = 0n;
    let transparent = 0n;
    // eslint-disable-next-line no-restricted-syntax
    for await (const u of wallet.storage.selectUtxos({
      token: NATIVE_TOKEN_UID,
      shielded: true,
      only_available_utxos: true,
    })) {
      if ((u.authorities ?? 0n) !== 0n) continue;
      shielded += u.value;
    }
    // eslint-disable-next-line no-restricted-syntax
    for await (const u of wallet.storage.selectUtxos({
      token: NATIVE_TOKEN_UID,
      shielded: false,
      only_available_utxos: true,
    })) {
      if ((u.authorities ?? 0n) !== 0n) continue;
      transparent += u.value;
    }
    return { shielded, transparent };
  };

  /**
   * Q.3 — Custom-token FS send with `changeShieldedMode: FULLY_SHIELDED`
   * routes the HTR fee-change into the shielded pool. Pre-fix the change
   * was emitted transparent regardless of the user-selected privacy
   * mode, leaking the sender alongside an otherwise-private send.
   */
  it('Q.3 — custom-token FS send produces FS HTR fee change', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'FsChangeTok', 'FCT', 1000n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(walletA, tokenResp.hash!);

    const beforeHtr = await sumHtrByPool(walletA);
    expect(beforeHtr.shielded).toBe(0n);
    expect(beforeHtr.transparent).toBeGreaterThan(0n);

    // Mobile flow for a custom-token FS send: recipient + self-change
    // both shielded (mobile builds them) and `changeShieldedMode: FS`
    // tells wallet-lib to also shield the HTR fee change.
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA0 = await walletA.getAddressAtIndex(2, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction(
      [
        {
          address: sbB0,
          value: 200n,
          token: tokenResp.hash,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
        {
          address: saA0,
          value: 800n,
          token: tokenResp.hash,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
      ],
      { changeShieldedMode: ShieldedOutputMode.FULLY_SHIELDED }
    );
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    const afterHtr = await sumHtrByPool(walletA);
    // Conversion should have moved walletA's HTR from transparent to
    // shielded (minus the per-shielded-output fees burned).
    expect(afterHtr.shielded).toBeGreaterThan(0n);
    expect(afterHtr.transparent).toBe(0n);
    // Total balance dropped only by the fees, never by the change value.
    const balA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balA[0].balance.unlocked).toBeGreaterThan(0n);
    expect(balA[0].balance.unlocked).toBeLessThan(beforeHtr.transparent);
    // The unlocked total equals the shielded sum (everything moved).
    expect(balA[0].balance.unlocked).toBe(afterHtr.shielded);
  });

  /**
   * Q.4 — Mirror of Q.3 with AmountShielded mode. AS uses the same
   * `shielded_outputs[]` array on-chain but a smaller per-output fee
   * constant; the conversion must pick the AS fee, not the FS one.
   */
  it('Q.4 — custom-token AS send produces AS HTR fee change', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'AsChangeTok', 'ACT', 1000n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(walletA, tokenResp.hash!);

    const beforeHtr = await sumHtrByPool(walletA);
    expect(beforeHtr.shielded).toBe(0n);
    expect(beforeHtr.transparent).toBeGreaterThan(0n);

    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA0 = await walletA.getAddressAtIndex(2, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction(
      [
        {
          address: sbB0,
          value: 200n,
          token: tokenResp.hash,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
        {
          address: saA0,
          value: 800n,
          token: tokenResp.hash,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      { changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED }
    );
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    const afterHtr = await sumHtrByPool(walletA);
    expect(afterHtr.shielded).toBeGreaterThan(0n);
    expect(afterHtr.transparent).toBe(0n);
    const balA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balA[0].balance.unlocked).toBe(afterHtr.shielded);
  });

  /**
   * Q.5 — Default behavior (no `changeShieldedMode`) keeps the HTR
   * change transparent. Regression guard: existing callers that don't
   * opt in must see no change in behavior.
   */
  it('Q.5 — without changeShieldedMode, HTR fee change stays transparent', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'NoOptTok', 'NOT', 1000n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(walletA, tokenResp.hash!);

    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const saA0 = await walletA.getAddressAtIndex(2, { legacy: false });
    // Same outputs as Q.3 but no `changeShieldedMode` option. Pre-fix
    // and post-fix behavior must match here — a regression in this
    // path would either populate the shielded HTR pool or break the
    // default flow.
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sbB0,
        value: 200n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: saA0,
        value: 800n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    const afterHtr = await sumHtrByPool(walletA);
    expect(afterHtr.shielded).toBe(0n);
    expect(afterHtr.transparent).toBeGreaterThan(0n);
  });
});
