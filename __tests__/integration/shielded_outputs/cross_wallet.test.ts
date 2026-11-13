/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group C — Sender vs receiver views of shielded transactions.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
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
    // The change is kept transparent, so the sender decrypts no shielded output.
    const tx = await walletA.sendManyOutputsTransaction(
      [
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
      ],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );
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

    // walletA's stored tx keeps its shielded outputs in shielded_outputs[]
    // (outputs[] is transparent-only), and an entry walletA decodes carries
    // its value. Every HTR output is shielded, so walletA's change is a third
    // shielded output: 100 - 50 - 2 (the recipient outputs' fees) = 48, minus
    // its own 1 fee = 47. walletA decodes that change, at its own address, and
    // nothing of the receiver's two outputs, at addresses it does not own.
    const senderTx = await walletA.getTx(tx!.hash!);
    const seenBySender = await Promise.all(
      (senderTx!.shielded_outputs ?? []).map(async so => ({
        mine: await walletA.storage.isAddressMine(so.decoded.address ?? ''),
        value: so.value,
      }))
    );
    expect(seenBySender.filter(entry => entry.mine)).toEqual([{ mine: true, value: 47n }]);
    expect(seenBySender.filter(entry => !entry.mine)).toEqual([
      { mine: false, value: undefined },
      { mine: false, value: undefined },
    ]);
    // So walletA credits its change and none of the receiver's outputs:
    // -(50 sent + 3 fee).
    const senderBal = await walletA.getTxBalance(senderTx!);
    expect(senderBal[NATIVE_TOKEN_UID]).toBe(-53n);
  });

  it('C.17 — Round-trip A → B → A: both wallets see correct deltas in both txs', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // tx1: A → B shielded, with A's change kept transparent
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction(
      [
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
      ],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );
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

    // tx2: B's view: its shielded 30 + 20 = 50 are both spent for the 40
    // sent and the 2 fees of A's outputs. Every HTR output is shielded, so the
    // 8 left returns to B as a shielded change: 8 - 1 (its own fee) = 7, and
    // the fee is 3. B's net = -(40 sent + 3 fee) = -43.
    // A's net for tx2 = +40 (received 25+15 shielded).
    expect((await walletA.getTxBalance((await walletA.getTx(tx2!.hash!))!))[NATIVE_TOKEN_UID]).toBe(
      40n
    );
    const bDeltaTx2 = (await walletB.getTxBalance((await walletB.getTx(tx2!.hash!))!))[
      NATIVE_TOKEN_UID
    ];
    expect(bDeltaTx2).toBe(-43n);
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
