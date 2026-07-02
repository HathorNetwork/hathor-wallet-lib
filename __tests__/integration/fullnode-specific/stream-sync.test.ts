/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade history-streaming sync tests.
 *
 * Streaming history sync (XPUB_STREAM_WS / MANUAL_STREAM_WS) is a HathorWallet-only
 * feature negotiated over the fullnode websocket; the wallet-service facade does not
 * use it, so these tests are fullnode-specific and not shared.
 *
 * In the multisig case the client derives P2SH addresses locally and the fullnode streams
 * their history back over `request:history:manual`. The unit/mock coverage lives in
 * `__tests__/stream.test.ts`; this test exercises the same path against the real fullnode to
 * prove it accepts client-derived P2SH addresses.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateMultisigWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { HistorySyncMode } from '../../../src/types';
import { WALLET_CONSTANTS } from '../configuration/test-constants';

describe('[Fullnode] history-streaming sync', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should sync a multisig (P2SH) wallet history via manual websocket streaming', async () => {
    // The multisig fixture wallet (walletIndex 0) is shared and persistent across runs and other
    // test files, so its address[0] may already hold funds. We therefore assert RELATIVE to the
    // polling-derived balance, never an absolute amount.

    // 1. Fund the first multisig address using a regular (polling) multisig wallet. Doing it
    //    BEFORE the streaming wallet starts guarantees the funds can only be discovered through
    //    the history-streaming sync, not through a live `new-tx` websocket event.
    const funder = await generateMultisigWalletHelper({ walletIndex: 0 });
    const fundedAddress = await funder.getAddressAtIndex(0);
    expect(fundedAddress).toEqual(WALLET_CONSTANTS.multisig.addresses[0]);

    const [htrBefore] = await funder.getBalance(NATIVE_TOKEN_UID);
    // injectFunds waits for the funder wallet to receive and confirm the tx.
    await GenesisWalletHelper.injectFunds(funder, fundedAddress, 10n);
    const [htrAfter] = await funder.getBalance(NATIVE_TOKEN_UID);
    // Sanity: the polling path saw exactly the +10n we just injected.
    expect(htrAfter.balance.unlocked - htrBefore.balance.unlocked).toEqual(10n);

    // 2. Start a fresh multisig wallet (same seed) that syncs from scratch using manual streaming.
    const streamWallet = await generateMultisigWalletHelper({
      walletIndex: 0,
      historySyncMode: HistorySyncMode.MANUAL_STREAM_WS,
    });

    // Guard: prove streaming was actually exercised. Without the `history-streaming` capability
    // the wallet silently falls back to HTTP polling (see HathorWallet.syncHistory), which would
    // make this test pass without testing the feature at all.
    await expect(streamWallet.conn.hasCapability('history-streaming')).resolves.toBe(true);

    // 3. Manual P2SH streaming and HTTP polling derive the same address set, so they must
    //    reconstruct the same balance — including the funds just injected.
    const [htrStream] = await streamWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrStream.balance.unlocked).toEqual(htrAfter.balance.unlocked);

    // 4. The streamed addresses are the canonical P2SH addresses, proving the client-side P2SH
    //    derivation over the stream matches the polling path end to end.
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential reads keep the assertion readable
      const address = await streamWallet.getAddressAtIndex(i);
      expect(address).toEqual(WALLET_CONSTANTS.multisig.addresses[i]);
    }
  }, 60000);
});
