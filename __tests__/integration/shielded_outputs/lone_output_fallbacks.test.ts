/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group Y — A mixed send with one shielded output, from a wallet with no shielded UTXO of
 * that output's token.
 *
 * With only public inputs, the lone output's value is public by subtraction (inputs - public
 * outputs - change - fee). The wallet shields the token's change instead, so the output and
 * the change are two hidden values, and that change is never skipped: it is shielded, or the
 * send fails before broadcast, saying why and, unless a transparent change would fail too,
 * suggesting changeShieldedMode: OutputKind.TRANSPARENT. For HTR, a selection that leaves no
 * change pulls HTR, smallest first, until a change pays its own fee, and the lone HTR output
 * is never split, as its halves would add up to its amount. A custom token whose selection
 * leaves no change has nothing to stand in, and its lone output is split in two, since the tx
 * still needs a second shielded output (a lone one cannot balance, and the node rejects it).
 *
 * - Y.1: a custom-token change is shielded in place of the missing shielded input.
 * - Y.2: a custom-token send with no change: the output is split, and the HTR change pays the
 *   split fee.
 * - Y.3: an HTR send with no change: HTR is pulled for a shielded change, and the output stays
 *   whole.
 * - Y.4: the only HTR to pull lands exactly on that change's fee, so the send fails; pinned
 *   transparent, the output is split.
 * - Y.5: no HTR to pull, so the send fails without the transparent hint, and the UTXO stays
 *   usable.
 * - Y.6: a change too small for its own fee fails the send; pinned transparent, it pays the
 *   split fee.
 * - Y.7: a legacy changeAddress fails the send; pinned transparent, the change goes there and
 *   the output is split.
 *
 * Node acceptance proves the declared fee matches the node's exact computation and that the
 * shielded outputs balance. Funding keeps each pool exact: public HTR comes from the genesis
 * wallet, one UTXO per injectFunds call, and the custom token from a funder in its own tx
 * (setupCustomTokenWallet).
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import {
  TokenLabels,
  broadcast,
  describeBuiltTx,
  legacyAddr,
  poolOf,
  prepareSend,
  setupCustomTokenWallet,
  shieldedAddr,
  snapshotUtxos,
  sorted,
  spendAddressOf,
  unlockedBalance,
  utxoKind,
} from '../helpers/shielded-send.helper';
import { FEE_PER_AMOUNT_SHIELDED_OUTPUT, NATIVE_TOKEN_UID } from '../../../src/constants';
import { ProposedOutput } from '../../../src/new/types';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const HTR = NATIVE_TOKEN_UID;
const HTR_LABELS: TokenLabels = { [HTR]: 'HTR' };

describe('shielded outputs — Group Y: A lone shielded output with no shielded UTXO of its token', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('Y.1 — with no shielded UTXO of a custom token, a mixed send shields its change while the HTR change stays public', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(10n, []);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // One public and one amount-shielded CUSTOM output: the rules want a shielded CUSTOM input
    // to hide the 4 among, the wallet has none, so the CUSTOM change is shielded instead, in
    // the output's mode. Left transparent, it would publish the 4 by subtraction (10 - 3 - 3);
    // shielded, the output and the change are two hidden values, and nothing is split. The fee
    // is HTR, so the change keeps its full value. CUSTOM: 10 = 3 + 4 (sent) + 3 (change).
    // HTR enters only to pay the two amount-shielded fees and no shielded HTR is spent, so its
    // change stays transparent. HTR: 10 = 8 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 3n, token: custom },
      { address: await shieldedAddr(recipient, 0), value: 4n, token: custom, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:10']),
      outputs: sorted(['recipient:CUSTOM:3', 'self:HTR:8']),
      shielded: sorted(['recipient:CUSTOM:AS:4', 'self:CUSTOM:AS:3']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:AS:3']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:8']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(7n);
  });

  it('Y.2 — with no custom-token change to shield, the lone shielded output is split and the HTR change pays the split fee', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(10n, []);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // 4 + 6 spends the CUSTOM 10 exactly: there is no change to shield in place of the missing
    // shielded input, so the 6 is the tx's only shielded output and is split into 3 + 3 at
    // the recipient. Its value is public by subtraction (10 - 4) either way; the split only
    // meets the two-output minimum. The split fee comes out of the transparent HTR change:
    // 10 - 1 (the output's fee) = 9, minus 1 (the split fee) = 8.
    // CUSTOM: 10 = 4 + 3 + 3 (sent). HTR: 10 = 8 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 4n, token: custom },
      { address: await shieldedAddr(recipient, 0), value: 6n, token: custom, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:10']),
      outputs: sorted(['recipient:CUSTOM:4', 'self:HTR:8']),
      shielded: ['recipient:CUSTOM:AS:3', 'recipient:CUSTOM:AS:3'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:8']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('Y.3 — with no HTR change, HTR is pulled for a shielded change that stands in for the missing shielded input, and the output stays whole', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 17n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 3n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:17', 'HTR:public:3']));
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The public 17 matches 5 + 11 + 1 (the shielded output's fee) exactly, so the selection
    // leaves no HTR change to stand in for the missing shielded input. HTR is pulled for one,
    // smallest first, until it pays its own 1 fee: the public 3. It becomes the HTR change,
    // amount-shielded like the output, and is the tx's second shielded output; the 11 is never
    // split, as its halves would add up to its amount. 3 - 1 (its own fee) = 2.
    // HTR: 17 + 3 = 5 + 11 (sent) + 2 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:17', 'HTR:public:3']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:11', 'self:HTR:AS:2']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:2']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it("Y.4 — with no HTR change, a pull that lands exactly on the change's fee fails the send; pinned transparent, it pays the split fee and the output is split", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 17n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 1n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:17', 'HTR:public:1']));
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: AS },
    ];

    // The public 17 matches 5 + 11 + 1 (the shielded output's fee) exactly, so the selection
    // leaves no HTR change to stand in for the missing shielded input, and HTR is pulled for
    // one. The public 1, all there is, lands exactly on that change's own 1 fee, so the change
    // cannot fund it, and the 11 is never split in its place, as its halves would add up to its
    // amount: the send fails before broadcast. Pinned transparent, the same 1 would pay the
    // split's fee instead, so the error suggests that.
    await expect(prepareSend(wallet, outputs)).rejects.toThrow(
      "The change must be shielded (so the amount of its token's only shielded output cannot " +
        'be computed by subtraction), but it is too small to fund its shielded-output fee and ' +
        'no additional HTR is available to cover the difference; pass changeShieldedMode: ' +
        'OutputKind.TRANSPARENT to keep the change transparent.'
    );

    // Nothing was broadcast and nothing stays selected: both UTXOs are still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, HTR_LABELS);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));

    // Pinned transparent, no change stands in: the public 1 is pulled for the second shielded
    // output's 1 fee, landing on it exactly, and the 11 is split into 5 + 6 at the recipient.
    // HTR: 17 + 1 = 5 + 5 + 6 (sent) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:17', 'HTR:public:1']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:5', 'recipient:HTR:AS:6']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it('Y.5 — with no HTR change and no HTR to pull, the send fails before broadcast without suggesting a transparent change, and leaves the UTXO usable', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 17n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:17']);
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: AS },
    ];

    // The public 17 matches 5 + 11 + 1 (the shielded output's fee) exactly, so the selection
    // leaves no HTR change to stand in for the missing shielded input, and the wallet holds no
    // other HTR to make one: the send fails before broadcast. The 11 is never split in its
    // place, as its halves would add up to its amount. The message ends there, with no
    // suggestion to keep the change transparent: pinned transparent, the 11 is split, and that
    // split's 1 fee needs HTR the wallet lacks as well.
    await expect(wallet.sendManyOutputsTransaction(outputs)).rejects.toThrow(
      "The change must be shielded (so the amount of its token's only shielded output cannot " +
        'be computed by subtraction), but no HTR change is left and no additional HTR is ' +
        'available to make one.'
    );
    await expect(
      wallet.sendManyOutputsTransaction(outputs, { changeShieldedMode: OutputKind.TRANSPARENT })
    ).rejects.toThrow(
      'Splitting the lone shielded output requires extra HTR for its fee, and no additional ' +
        'HTR is available.'
    );

    // Nothing was broadcast and nothing stays selected: the 17 is still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, HTR_LABELS);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));
    expect(await unlockedBalance(wallet, HTR)).toBe(17n);

    // Paid publicly, the same 5 + 11 owes no fee and the 17 covers it: the send spends the 17
    // and keeps the 1 left over as a transparent change. HTR: 17 = 5 + 11 (sent) + 1 (change).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await legacyAddr(recipient, 1), value: 11n, token: HTR },
    ]);

    const shape = await describeBuiltTx(txData, utxosAfterFailure, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:public:17'],
      outputs: sorted(['recipient:HTR:5', 'recipient:HTR:11', 'self:HTR:1']),
      shielded: [],
      fee: 0n,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:1']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it('Y.6 — an HTR change too small for its own fee, with no HTR to add, fails the send; pinned transparent, it pays the split fee', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 18n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:18']);
    const paidTo = await shieldedAddr(recipient, 0);
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: paidTo, value: 11n, token: HTR, shielded: AS },
    ];

    // One shielded output and no shielded HTR to hide it among, so the change stands in for the
    // missing shielded input, and a change standing in is shielded or the send fails: left
    // transparent, it would publish the 11 by subtraction. That change is 18 - 11 - 5 - 1 (the
    // recipient's fee) = 1, too small to pay its own 1 fee, and the wallet has no other HTR to
    // add to it, so the send fails before broadcast. Pinned transparent, the change would pay
    // the split's fee instead, so the error suggests that.
    await expect(prepareSend(wallet, outputs)).rejects.toThrow(
      "The change must be shielded (so the amount of its token's only shielded output cannot " +
        'be computed by subtraction), but it is too small to fund its shielded-output fee and ' +
        'no additional HTR is available to cover the difference; pass changeShieldedMode: ' +
        'OutputKind.TRANSPARENT to keep the change transparent.'
    );

    // Nothing was broadcast and nothing stays selected: the 18 is still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, HTR_LABELS);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));

    // Pinned transparent, the 11 is the tx's only shielded output and is split into 5 + 6; the
    // change is exactly the split fee and is spent on it, so no change output is left.
    // HTR: 18 = 5 + 5 + 6 (sent) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:public:18'],
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:5', 'recipient:HTR:AS:6']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    // Both halves pay the address the caller gave.
    const paidOnChain = spendAddressOf(wallet, paidTo);
    expect((txData.shieldedOutputs ?? []).map(output => output.address)).toEqual([
      paidOnChain,
      paidOnChain,
    ]);

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it('Y.7 — a legacy changeAddress cannot receive the change standing in for a shielded input, so the send fails; pinned transparent, the change goes there and the lone output is split', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 30n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:30']);
    const legacyChange = await legacyAddr(wallet, 5);
    // Not where the wallet would put a change by default, so honoring it is visible.
    expect((await wallet.getCurrentAddress()).address).not.toBe(legacyChange);
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: AS },
    ];

    // One shielded output and no shielded HTR to hide it among, so the change stands in for the
    // missing shielded input and must be shielded. That change, 30 - 11 - 5 - 1 (the
    // recipient's fee) = 13, can pay its own fee, but the caller asked for it at a legacy
    // address, which cannot receive a shielded output: the send fails before broadcast, saying
    // why.
    await expect(prepareSend(wallet, outputs, { changeAddress: legacyChange })).rejects.toThrow(
      "The change must be shielded (so the amount of its token's only shielded output cannot " +
        'be computed by subtraction), and a legacy change address cannot receive it. Use a ' +
        'new-format change address, or changeShieldedMode: OutputKind.TRANSPARENT to keep the ' +
        'change transparent.'
    );

    // Nothing was broadcast and nothing stays selected: the 30 is still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, HTR_LABELS);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));

    // Pinned transparent, the change, 13, goes to the legacy address. The 11 is then the tx's
    // only shielded output: the change pays the split fee, 13 - 1 = 12, and the 11 is split
    // into 5 + 6. HTR: 30 = 5 + 5 + 6 (sent) + 12 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      changeAddress: legacyChange,
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:public:30'],
      outputs: sorted(['recipient:HTR:5', 'self:HTR:12']),
      shielded: sorted(['recipient:HTR:AS:5', 'recipient:HTR:AS:6']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    const changeAt = txData.outputs.filter(
      output => 'address' in output && output.address === legacyChange
    );
    expect(changeAt.map(output => output.value)).toEqual([12n]);

    await broadcast(sendTx, [wallet, recipient]);

    const atChangeAddress: string[] = [];
    for await (const utxo of wallet.storage.selectUtxos({
      token: HTR,
      filter_address: legacyChange,
    })) {
      atChangeAddress.push(`HTR:${utxoKind(utxo)}:${utxo.value}`);
    }
    expect(atChangeAddress).toEqual(['HTR:public:12']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:12']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });
});
