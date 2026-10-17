/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression coverage for `HathorWallet.getUtxos` ordering.
 *
 * Until now `getUtxos` returned UTXOs in storage insertion order, which
 * means a `max_utxos: N` query would silently drop the most valuable UTXOs
 * if they happened to be stored last. The headless `utxo-filter` test caught
 * this end-to-end (`Expected: 900, Received: 30`) — the test built a wallet
 * with UTXOs [10, 20, 30, 40, 850, 50] and expected the top-2 by value
 * (850+50) but got the first-2 inserted (10+20). The fix makes `getUtxos`
 * default to `order_by_value: 'desc'`, matching `getUtxosForAmount`.
 */

import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { generateWalletHelper } from '../helpers/wallet.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';

describe('[Fullnode-specific] getUtxos ordering', () => {
  afterEach(async () => {
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * Build a wallet with HTR UTXOs of distinct values in a deliberately
   * non-monotonic insertion order, then assert that getUtxos returns them
   * sorted by value (desc) regardless of when each one entered storage.
   */
  it('returns UTXOs sorted by value desc by default', async () => {
    const wallet = await generateWalletHelper();
    // Inject 4 separate fundings so the wallet ends up with 4 distinct
    // UTXOs of values 10, 20, 30, 50 — and inject them in a value-mixed
    // order so insertion order ≠ value-desc order.
    const addr0 = await wallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 20n);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 50n);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 10n);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 30n);

    const { utxos } = await wallet.getUtxos({ token: NATIVE_TOKEN_UID });
    expect(utxos).toHaveLength(4);
    const values = utxos.map(u => u.amount);
    // The point of the regression: the test would previously see
    // [20n, 50n, 10n, 30n] (insertion order). Post-fix it must be
    // value-desc: [50n, 30n, 20n, 10n].
    expect(values).toEqual([50n, 30n, 20n, 10n]);
  });

  /**
   * `max_utxos: 2` must return the 2 *largest* UTXOs, not the 2 first
   * inserted. This is the exact pattern the headless utxo-filter test
   * caught end-to-end.
   */
  it('max_utxos returns the top-N by value, not insertion order', async () => {
    const wallet = await generateWalletHelper();
    const addr0 = await wallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 20n);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 50n);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 10n);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 30n);

    const { utxos, total_amount_available } = await wallet.getUtxos({
      token: NATIVE_TOKEN_UID,
      max_utxos: 2,
    });
    expect(utxos).toHaveLength(2);
    expect(total_amount_available).toBe(80n); // 50 + 30, not 20 + 50
    expect(utxos.map(u => u.amount)).toEqual([50n, 30n]);
  });
});
