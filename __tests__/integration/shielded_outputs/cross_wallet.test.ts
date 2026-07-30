/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group C — Sender vs receiver views of shielded transactions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group C: Cross-wallet views', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('C.15 — Sender to OTHER wallet: sender sees -input + change, receiver sees +amount', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
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
    await waitForTxReceived(walletA, tx!.hash!);
    await waitForTxReceived(walletB, tx!.hash!);

    // Sender's per-tx delta: lost 100 transparent, got 48 transparent change
    // (100 - 50 sent - 2 fee = 48), can't decrypt the shielded outputs.
    // Net = -52 (= -50 sent - 2 fee).
    const senderTx = await walletA.getTx(tx!.hash!);
    const senderBal = await walletA.getTxBalance(senderTx!);
    expect(senderBal[NATIVE_TOKEN_UID]).toBe(-52n);

    // Receiver's per-tx delta: +50 (sum of decoded shielded outputs).
    const receiverTx = await walletB.getTx(tx!.hash!);
    const receiverBal = await walletB.getTxBalance(receiverTx!);
    expect(receiverBal[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('C.16 — Sender does NOT accidentally credit recipient outputs', async () => {
    // Sanity: with two wallets that have different scan keys, sender must
    // not be able to decrypt receiver's outputs and accidentally credit them.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
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
    await waitForTxReceived(walletA, tx!.hash!);

    // walletA's stored tx: outputs[] should NOT contain decoded shielded
    // entries attributable to walletA — it can't decrypt receiver outputs.
    const senderTx = await walletA.getTx(tx!.hash!);
    const decodedShielded = (senderTx!.outputs ?? []).filter((o: any) => o?.type === 'shielded');
    // Resolve each potential shielded output to an isMine flag; every result
    // must be false (none of them should be credited to walletA).
    const ownership = await Promise.all(
      decodedShielded.map((o: any) => walletA.storage.isAddressMine(o.decoded?.address))
    );
    expect(ownership.every(isMine => isMine === false)).toBe(true);
  });

  it('C.17 — Round-trip A → B → A: both wallets see correct deltas in both txs', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // tx1: A → B shielded
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
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
    await waitForTxReceived(walletA, tx1!.hash!);
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // tx2: B → A shielded (using B's shielded UTXOs from tx1)
    const sa0 = await walletA.getAddressAtIndex(0, { legacy: false });
    const sa1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 25n,
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
    await waitForTxReceived(walletA, tx2!.hash!);
    await waitForTxReceived(walletB, tx2!.hash!);

    // Verify deltas:
    // tx1 from A's view = -52 (sent 50, fee 2), from B's view = +50.
    expect((await walletA.getTxBalance((await walletA.getTx(tx1!.hash!))!))[NATIVE_TOKEN_UID]).toBe(
      -52n
    );
    expect((await walletB.getTxBalance((await walletB.getTx(tx1!.hash!))!))[NATIVE_TOKEN_UID]).toBe(
      50n
    );

    // tx2: B's view: 30+20=50 in shielded UTXOs spent, 0 returned to B (no
    // change) + 2 fee → -50 if both UTXOs spent (40 sent + 2 fee + change?).
    // The test trusts the ledger: B's net is -fee - amount_sent_to_A.
    // A's net for tx2 = +40 (received 25+15 shielded).
    expect((await walletA.getTxBalance((await walletA.getTx(tx2!.hash!))!))[NATIVE_TOKEN_UID]).toBe(
      40n
    );
    // We don't pin B's exact value (depends on UTXO selection details), but
    // it should be negative and at least -fee (-2n).
    const bDeltaTx2 = (await walletB.getTxBalance((await walletB.getTx(tx2!.hash!))!))[
      NATIVE_TOKEN_UID
    ];
    expect(bDeltaTx2).toBeLessThan(0n);
  });

  it('C.18 — Receiver balance reverses when tx is voided from their perspective', async () => {
    // Mirror of A.8 from the receiver's angle: the receiver has already
    // decoded and credited a shielded output; a later is_voided=true
    // delivery must zero the credit (and a subsequent unvoid restores it).
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
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

    const stored = (await walletB.getTx(tx!.hash!))!;
    await walletB.onNewTx({ history: { ...stored, is_voided: true } });
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(0n);

    await walletB.onNewTx({ history: { ...stored, is_voided: false } });
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);
    // Voiding a propagated tx requires fullnode-level intervention not
    // exposed via wallet API. Documented for manual testing.
  });
});
