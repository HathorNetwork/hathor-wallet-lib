/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Fee-token shielded fee accounting.
 *
 * A shielded output is charged ONLY the shielded per-output fee
 * (FEE_PER_AMOUNT/FULL_SHIELDED_OUTPUT), never the transparent FEE_PER_OUTPUT —
 * shielded outputs live in their own on-chain list and are not counted as
 * chargeable transparent outputs (see hathor-core alpha-v4 calculate_fee /
 * calculate_shielded_fee). The send pipeline pushes a transparent "phantom" for
 * each shielded output so UTXO selection accounts for its value; that phantom
 * must NOT reach the transparent fee calc, or a FEE-token shielded output is
 * charged FEE_PER_OUTPUT on top of its shielded fee. The fullnode validates the
 * declared fee for an EXACT match, so the over-declared tx is rejected outright.
 *
 * This test sends a FEE-token to two shielded addresses (the protocol requires
 * at least two shielded outputs per tx), leaving a transparent change (pinned
 * with changeShieldedMode: OutputKind.TRANSPARENT; by default the change of a
 * token whose outputs are all shielded is shielded too). The correct fee is
 * FEE_PER_OUTPUT (for the one transparent change) + the two shielded fees. On a build that leaks the phantoms the wallet declares
 * 3 * FEE_PER_OUTPUT + shielded fees and the fullnode rejects the exact-match
 * fee — so this test fails on any phantom-leaking build.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import {
  FEE_PER_FULL_SHIELDED_OUTPUT,
  FEE_PER_OUTPUT,
  NATIVE_TOKEN_UID,
} from '../../../src/constants';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { TokenVersion } from '../../../src/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — fee-token shielded fee', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('does not charge FEE_PER_OUTPUT for a FEE-token shielded output', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    // A FEE-version custom token: each TRANSPARENT output of it costs
    // FEE_PER_OUTPUT (paid in HTR); a shielded output of it costs only the
    // shielded fee.
    const mintAddr = await walletA.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(walletA, 'ShieldFeeTok', 'SFT', 1000n, {
      address: mintAddr,
      tokenVersion: TokenVersion.FEE,
    });
    await waitUntilNextTimestamp(walletA, tokenResp.hash!);

    const htrBefore = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Send part of the FEE token to two shielded addresses (the protocol
    // minimum per tx); the remainder returns as a single TRANSPARENT change
    // output, pinned so. Correct fee =
    //   FEE_PER_OUTPUT (the one transparent change output)
    //   + 2 * FEE_PER_FULL_SHIELDED_OUTPUT (the two shielded outputs).
    // A phantom-leaking build instead declares 3 * FEE_PER_OUTPUT + shielded
    // fees (two phantoms + change) and the fullnode rejects the exact-match
    // fee.
    const sbB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sbB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction(
      [
        {
          address: sbB0,
          value: 250n,
          token: tokenResp.hash,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
        {
          address: sbB1,
          value: 150n,
          token: tokenResp.hash,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
      ],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    const htrAfter = (await walletA.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    const expectedFee = FEE_PER_OUTPUT + 2n * FEE_PER_FULL_SHIELDED_OUTPUT;
    expect(htrBefore - htrAfter).toBe(expectedFee);

    // The receiver decodes both shielded outputs.
    const balB = await walletB.getBalance(tokenResp.hash);
    expect(balB[0].balance.unlocked).toBe(400n);
  });
});
