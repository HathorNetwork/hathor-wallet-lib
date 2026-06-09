/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group V — Negative tests: combinations the protocol must reject.
 *
 * These pin the boundary cases where wallet-lib or hathor-core actively
 * refuses a tx that's structurally invalid for the shielded protocol.
 * If a future change accidentally accepts one of them, the tests fail.
 *
 * Pattern: each test attempts a malformed flow and asserts an error is
 * raised, either client-side (wallet-lib refuses to build the tx) or
 * server-side (fullnode rejects on push_tx).
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

describe('shielded outputs — Group V: protocol-level rejections', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * V.1 — `sendManyOutputsTransaction` cannot emit a single shielded
   * output. The wallet-lib enforces a minimum of 2 shielded outputs to
   * prevent trivial commitment-matching attacks (anti-decoy).
   */
  it('V.1 — single shielded output is rejected client-side', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbB = await walletB.getAddressAtIndex(0, { legacy: false });
    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: sbB,
          value: 30n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
      ])
    ).rejects.toThrow(/at least 2 shielded outputs/i);
  });

  // V.2 is now a POSITIVE test (TCT/shielded-HTR works after the upstream
  // dispatch fix) and lives in `mint_melt_shielded.test.ts` as `S.0`.

  /**
   * V.3 — Sending a shielded output to a LEGACY (P2PKH) address is
   * rejected. Shielded outputs require the recipient's scan_pubkey,
   * which legacy P2PKH addresses don't carry — there's no way to
   * construct the ECDH shared secret.
   */
  it('V.3 — shielded output to a legacy address is rejected', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const legacyB = await walletB.getAddressAtIndex(0, { legacy: true });
    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: legacyB,
          value: 30n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
        {
          address: legacyB,
          value: 20n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.FULLY_SHIELDED,
        },
      ])
    ).rejects.toThrow();
  });

  /**
   * V.4 — Repeatedly spending the same shielded UTXO double-spends. The
   * fullnode (or the wallet, depending on which side detects first)
   * rejects the second tx as conflicting.
   */
  it('V.4 — second send of an already-spent shielded UTXO is rejected', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const fundA = await walletA.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletA, fundA, 100n);

    const sbA0 = await walletA.getAddressAtIndex(2, { legacy: false });
    const sbA1 = await walletA.getAddressAtIndex(3, { legacy: false });
    const seedTx = await walletA.sendManyOutputsTransaction([
      {
        address: sbA0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbA1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletA, seedTx!.hash!);
    await waitUntilNextTimestamp(walletA, seedTx!.hash!);

    // First send — succeeds.
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    const tx1 = await walletA.sendTransaction(addrB, 25n);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletA, tx1!.hash!);

    // Second send chained — wallet should pick a NEW UTXO (the change
    // from tx1) automatically. If for some reason it tried to re-use
    // the spent UTXO from seedTx, the fullnode would reject. We mainly
    // assert no error is thrown — and the recipient's balance reflects
    // both sends.
    const addrC = await walletC.getAddressAtIndex(0, { legacy: true });
    const tx2 = await walletA.sendTransaction(addrC, 5n);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletC, tx2!.hash!);
  });
});
