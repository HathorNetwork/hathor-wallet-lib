/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression coverage for the `wallet-load-partial-update` emission cadence.
 *
 * Before shielded support, `loadAddresses(0, 20)` returned 20 P2PKH addresses
 * and `loadAddressHistory` packed them in a single MAX_ADDRESSES_GET=20 chunk,
 * yielding once. The `apiSyncHistory` outer loop emitted exactly one
 * `wallet-load-partial-update` per page of addresses loaded.
 *
 * After shielded support, `loadAddresses` also pushes the per-index shielded
 * spend P2PKH, doubling the count to 40 and producing 2 chunks. The for-await
 * loop in `apiSyncHistory` then emitted *twice* for the same page, with
 * identical {addressesFound, historyLength} payloads. Headless
 * `plugin-events.test.js` caught the duplicate at the plugin event bus
 * (expected 1 startup partial-update, received 2).
 *
 * Fix: only emit when the (addressesFound, historyLength) tuple actually
 * changes since the previous emit on this same window — consumers stop
 * seeing identical back-to-back updates.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  stopAllWallets,
  waitForWalletReady,
  registerShieldedProvider,
} from '../helpers/wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { getGapLimitConfig } from '../utils/core.util';

interface PartialUpdateEvent {
  addressesFound: number;
  historyLength: number;
}

describe('[Fullnode-specific] wallet-load-partial-update emission', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * An empty-wallet startup loads exactly one BIP32 address window
   * (GAP_LIMIT = 20). Before the fix this produced 2 identical
   * partial-update emits (one per chunk of the 40 on-chain addresses).
   * After the fix it produces exactly 1 — duplicate (no-change) emits are
   * suppressed within the same window.
   */
  it('empty wallet startup emits exactly one partial-update', async () => {
    const precalculated = precalculationHelpers.test.getPrecalculatedWallet();

    // Build the wallet but do NOT start yet — we need to attach the
    // listener before start() so we capture the very first emit.
    const wallet = new HathorWallet({
      seed: precalculated.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: precalculated.addresses,
      scanPolicy: getGapLimitConfig(),
    });
    registerShieldedProvider(wallet);

    const events: PartialUpdateEvent[] = [];
    wallet.conn.on('wallet-load-partial-update', (data: PartialUpdateEvent) => {
      events.push(data);
    });

    await wallet.start();
    await waitForWalletReady(wallet);
    // Let any trailing async emit land before we assert.
    await new Promise(resolve => {
      setTimeout(resolve, 500);
    });

    // For an empty wallet (no txs received), there should be exactly one
    // partial-update event. The pre-fix behavior was two identical emits
    // because the chunked HTTP fetch yielded twice (40 addrs / 20 per chunk)
    // and the emit lived inside the inner loop. The exact `addressesFound`
    // count depends on the precalculated wallet's gap-limit + persistence
    // state, so assert structure rather than specific values — what we are
    // guarding against is the *duplicate*.
    expect(events).toHaveLength(1);
    expect(events[0].historyLength).toBe(0);
    expect(events[0].addressesFound).toBeGreaterThanOrEqual(20);
  });
});
