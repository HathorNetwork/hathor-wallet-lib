/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group U — Unshielding: transparent outputs spending SHIELDED inputs.
 *
 * hathor-core accepts txs where shielded inputs fund transparent-only
 * outputs. `Transaction.is_shielded()` returns true if the tx has shielded
 * inputs OR outputs, so `_verify_tx` skips `verify_sum` and
 * `verify_token_rules(is_shielded=True)` skips the HTR surplus/deficit
 * check (hathor-core commit 75831f9a). Ownership is enforced via the
 * P2PKH signature on the spend-derived key of the shielded output.
 *
 * On the wallet-lib side: `bestUtxoSelection` / `fastUtxoSelection` must
 * return shielded UTXOs too, and the signing path in
 * `src/utils/transaction.ts` already routes `shielded-spend` addresses to
 * the spend xprivkey chain. No shielded crypto block runs for this path
 * (no shielded outputs), fee is 0.
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
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

describe('shielded outputs — Group U: Unshielding (shielded inputs → transparent outputs)', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('U.1 — Unshield HTR: shielded HTR spent as a transparent send', async () => {
    // Wallet A: gets HTR from genesis, moves most of it into shielded UTXOs
    // via a self-send, then sends HTR transparent from those shielded UTXOs.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Move 50n HTR into two shielded UTXOs (30 + 20) owned by walletA.
    const sa0 = await walletA.getAddressAtIndex(1, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(2, { legacy: false });
    const shieldTx = await walletA.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletA, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletA, shieldTx!.hash!);

    // walletA now has:
    //   ~48n HTR transparent (100 - 50 sent - 2 AS fees)
    //   50n HTR shielded (30 + 20)
    // Transparent send of 60n needs to pull from the shielded UTXOs.
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const sendTx = await walletA.sendTransaction(addrB, 60n);
    expect(sendTx).not.toBeNull();
    await waitForTxReceived(walletA, sendTx!.hash!);
    await waitForTxReceived(walletB, sendTx!.hash!);

    // Receiver sees 60n transparent.
    const balB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balB[0].balance.unlocked).toBe(60n);
  });

  it('U.2 — Unshield custom token (exact mobile repro)', async () => {
    // Reproduces the mobile scenario: create a custom token, move most of
    // the supply into shielded UTXOs via a self-send, then send transparent
    // to another wallet with an amount that exceeds the transparent
    // remainder.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const funding = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, funding, 100n);
    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'UnshieldTok', 'UST', 1000n, {
      address: mintAddr,
    });

    // Move 900 TST into shielded UTXOs (500 + 400).
    const sa0 = await walletA.getAddressAtIndex(2, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(3, { legacy: false });
    const shieldTx = await walletA.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 500n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 400n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, shieldTx!.hash!);
    await waitUntilNextTimestamp(walletA, shieldTx!.hash!);

    // walletA now has 100 TST transparent + 900 TST shielded. Transparent
    // send of 650 TST pulls from both pools.
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const sendTx = await walletA.sendTransaction(addrB, 650n, { token: tokenResp.hash });
    expect(sendTx).not.toBeNull();
    await waitForTxReceived(walletA, sendTx!.hash!);
    await waitForTxReceived(walletB, sendTx!.hash!);

    const balB = await walletB.getBalance(tokenResp.hash);
    expect(balB[0].balance.unlocked).toBe(650n);
  });

  it('U.3 — Pure transparent unchanged: wallet with only transparent UTXOs still works', async () => {
    // Regression guard: after removing the `shielded: false` filter, the
    // vanilla transparent-only path must still behave identically for a
    // wallet that has never touched shielded UTXOs.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, addrA, 50n);
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const tx = await walletA.sendTransaction(addrB, 25n);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);
    await waitForTxReceived(walletB, tx!.hash!);
    const balB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balB[0].balance.unlocked).toBe(25n);
  });
});
