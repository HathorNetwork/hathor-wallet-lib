/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group O — Shielded UTXOs taken in the mode that keeps their token private.
 *
 * A fully shielded UTXO hides its token as well as its amount; an amount-shielded one hides only
 * its amount. So the wallet takes a token's shielded UTXOs in the mode that keeps the token as
 * private as the tx leaves it:
 *
 * - A token is public in a tx when any of its outputs is transparent or amount-shielded, and HTR
 *   always is, as it pays the public fee. Its amount-shielded UTXOs are taken before its fully
 *   shielded ones: spending a fully shielded UTXO there reveals the token it held.
 * - A custom token whose outputs are all fully shielded is hidden. Its fully shielded UTXOs are
 *   taken first: spending an amount-shielded one reveals the token.
 * - Within a mode, UTXOs are taken by value. A mode that cannot pay the amount alone is taken
 *   whole, and the other mode pays the rest.
 * - The order applies to the shielded pool a send draws from first, the shielded top-up of a
 *   short transparent pool, the shielded input a mixed send forces in, and the UTXO added so an
 *   exact match on a single shielded input leaves a change. An explicit changeShieldedMode
 *   decides the change, not the order.
 * - When the order needs more inputs than a tx holds, the send is built again with shielded
 *   UTXOs taken by value alone.
 *
 * - O.1: a custom token with an amount-shielded output takes an amount-shielded UTXO over a
 *   smaller fully shielded one, and all of its amount-shielded UTXOs before a fully shielded one
 *   tops them up.
 * - O.2: a custom token whose outputs are all fully shielded takes its fully shielded UTXO first,
 *   with the same inputs whatever the change mode, and is left out of the tx's token list when
 *   the rules decide the change; once an output of it is amount-shielded, the shielded input a
 *   mixed send forces in is amount-shielded.
 * - O.3: HTR takes amount-shielded UTXOs first for an all-shielded send, for the shielded top-up
 *   of its public pool and for the UTXO that forces a change.
 * - O.4: the order can leave a change where taking by value matches exactly. That change pays its
 *   own fee, so a wallet with just enough HTR is told so, and pinned transparent the send builds
 *   without spending the fully shielded UTXO.
 * - O.5 (prepare only): sends past the input limit fail with InputLimitError, and a send whose
 *   order needs more inputs than a tx holds is built again by value.
 *
 * Each test funds both modes of one token, so the order shows in which UTXO is spent and which
 * stays. The broadcast txs run against a real node because it exact-matches the FeeHeader and
 * verifies the balance of the shielded commitments, a fully shielded input spent into
 * amount-shielded outputs included.
 *
 * Funding keeps each test wallet's pool exact: a token's shielded UTXOs come from a funder in a
 * single tx, with the funder's change pinned transparent, and public HTR in separate txs.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { createTokenHelper, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import {
  ShieldedEntry,
  TokenLabels,
  broadcast,
  describeBuiltTx,
  fund,
  fundShielded,
  legacyAddr,
  poolOf,
  prepareSend,
  shieldedAddr,
  snapshotUtxos,
  sorted,
  startFunder,
  unlockedBalance,
} from '../helpers/shielded-send.helper';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
  MAX_INPUTS,
  MAX_OUTPUTS,
  NATIVE_TOKEN_UID,
} from '../../../src/constants';
import { InputLimitError, SendTxError } from '../../../src/errors';
import HathorWallet from '../../../src/new/wallet';
import { ProposedOutput } from '../../../src/new/types';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const FS = ShieldedOutputMode.FULLY_SHIELDED;
const HTR = NATIVE_TOKEN_UID;
const HTR_LABELS: TokenLabels = { [HTR]: 'HTR' };

/**
 * A test wallet holding exactly the given shielded UTXOs of a fresh DEPOSIT custom token, all from
 * one funding tx (see `fundShielded`), and one public HTR UTXO of `publicHtr` from the genesis
 * wallet, plus a fresh recipient.
 */
async function setupShieldedCustomWallet(
  shieldedCustom: ShieldedEntry[],
  publicHtr: bigint
): Promise<{
  wallet: HathorWallet;
  recipient: HathorWallet;
  custom: string;
  labels: TokenLabels;
}> {
  const wallet = await generateWalletHelper();
  const recipient = await generateWalletHelper();
  const funder = await startFunder();

  const tokenResponse = await createTokenHelper(funder, 'Mode Order', 'MOO', 100n, {
    address: await legacyAddr(funder, 1),
  });
  const custom: string = tokenResponse.hash;

  await fundShielded(funder, wallet, custom, shieldedCustom);
  await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), publicHtr);

  return { wallet, recipient, custom, labels: { [HTR]: 'HTR', [custom]: 'CUSTOM' } };
}

describe('shielded outputs — Group O: Shielded UTXOs taken in the mode that keeps their token private', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('O.1 — a token with an amount-shielded output spends its amount-shielded UTXOs first: one over a smaller fully shielded UTXO, then all of them before a fully shielded one tops up', async () => {
    const { wallet, recipient, custom, labels } = await setupShieldedCustomWallet(
      [
        { value: 40n, mode: AS },
        { value: 30n, mode: FS },
        { value: 20n, mode: FS },
        { value: 5n, mode: AS },
      ],
      10n
    );
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:AS:40', 'CUSTOM:FS:30', 'CUSTOM:FS:20', 'CUSTOM:AS:5'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    let utxosBefore = await snapshotUtxos(wallet, labels);
    let htrBefore = await unlockedBalance(wallet, HTR);

    // 1. The output is amount-shielded, so CUSTOM is public in the tx and its amount-shielded
    // UTXOs are taken first, by value among them: the 40, the smallest one that pays 10 alone.
    // By value alone the fully shielded 20 would be taken (the smallest UTXO over 10), and
    // spending it into amount-shielded outputs would reveal the token it held. Every CUSTOM
    // output is shielded, so the 30 change is shielded in their mode, keeping its full value as
    // the fee is HTR. HTR enters only for the two amount-shielded fees.
    // CUSTOM: 40 = 10 (sent) + 30 (change). HTR: 10 = 8 (change) + 2 (fee).
    const first = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: AS },
    ]);

    const firstShape = await describeBuiltTx(first.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(firstShape).toEqual({
      inputs: sorted(['CUSTOM:AS:40', 'HTR:public:10']),
      outputs: ['self:HTR:8'],
      shielded: sorted(['recipient:CUSTOM:AS:10', 'self:CUSTOM:AS:30']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(first.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:FS:30', 'CUSTOM:FS:20', 'CUSTOM:AS:5', 'CUSTOM:AS:30'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:8']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(firstShape.fee);

    // 2. The amount-shielded UTXOs left, 30 + 5, cannot pay 50 alone: both are taken, and the
    // fully shielded mode pays the other 15 by value, with the 20, the smallest one that pays it
    // alone. The fully shielded 30 stays. The change is shielded in the outputs' mode:
    // 55 - 50 = 5. The node verifies the balance of a fully shielded input spent into
    // amount-shielded outputs only. CUSTOM: 30 + 5 + 20 = 50 (sent) + 5 (change).
    // HTR: 8 = 6 (change) + 2 (fee).
    utxosBefore = await snapshotUtxos(wallet, labels);
    htrBefore = await unlockedBalance(wallet, HTR);
    const second = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 1), value: 50n, token: custom, shielded: AS },
    ]);

    const secondShape = await describeBuiltTx(second.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(secondShape).toEqual({
      inputs: sorted(['CUSTOM:AS:30', 'CUSTOM:AS:5', 'CUSTOM:FS:20', 'HTR:public:8']),
      outputs: ['self:HTR:6'],
      shielded: sorted(['recipient:CUSTOM:AS:50', 'self:CUSTOM:AS:5']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(second.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(sorted(['CUSTOM:FS:30', 'CUSTOM:AS:5']));
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:6']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(secondShape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(60n);
  });

  it('O.2 — a token whose outputs are all fully shielded spends its fully shielded UTXO first whatever the change mode, and lists no token when the rules decide the change; once an output is amount-shielded, the forced input is amount-shielded', async () => {
    const { wallet, recipient, custom, labels } = await setupShieldedCustomWallet(
      [
        { value: 30n, mode: AS },
        { value: 40n, mode: FS },
      ],
      10n
    );
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:AS:30', 'CUSTOM:FS:40'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    const hidden: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: FS },
      { address: await shieldedAddr(recipient, 1), value: 10n, token: custom, shielded: FS },
    ];
    let utxosBefore = await snapshotUtxos(wallet, labels);

    // Every CUSTOM output is fully shielded, so CUSTOM is hidden in the tx and its fully
    // shielded UTXOs come first: the 40 pays the 20 alone. By value alone the amount-shielded 30
    // would be taken (the smallest UTXO over 20), and spending it would reveal the token. An
    // explicit change mode decides only the change: amount-shielded or transparent, the inputs
    // are the same. A change in either mode references CUSTOM, which the tx then lists among its
    // tokens. These two are built and not broadcast.
    // Amount-shielded change: CUSTOM 40 = 20 (sent) + 20 (change). HTR 10 = 4 (change, 5 less
    // its own 1 fee) + 6 (fee).
    const asChange = await prepareSend(wallet, hidden, { changeShieldedMode: AS });

    const asChangeShape = await describeBuiltTx(asChange.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(asChangeShape).toEqual({
      inputs: sorted(['CUSTOM:FS:40', 'HTR:public:10']),
      outputs: [],
      shielded: sorted([
        'recipient:CUSTOM:FS:10',
        'recipient:CUSTOM:FS:10',
        'self:CUSTOM:AS:20',
        'self:HTR:AS:4',
      ]),
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT + 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    expect(asChange.txData.tokens).toEqual([custom]);

    // Transparent change: CUSTOM 40 = 20 (sent) + 20 (change). HTR 10 = 6 (change) + 4 (fee).
    const transparentChange = await prepareSend(wallet, hidden, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const transparentChangeShape = await describeBuiltTx(transparentChange.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(transparentChangeShape).toEqual({
      inputs: sorted(['CUSTOM:FS:40', 'HTR:public:10']),
      outputs: sorted(['self:CUSTOM:20', 'self:HTR:6']),
      shielded: ['recipient:CUSTOM:FS:10', 'recipient:CUSTOM:FS:10'],
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });
    expect(transparentChange.txData.tokens).toEqual([custom]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:AS:30', 'CUSTOM:FS:40'])
    );

    // 1. Left to the rules, the change is shielded in the outputs' mode, fully shielded, so no
    // output of the tx references CUSTOM and the tx lists no token. The node accepts a custom
    // token that appears only in fully shielded commitments, spent from a fully shielded input.
    // CUSTOM: 40 = 20 (sent) + 20 (change). HTR: 10 = 4 (change) + 6 (fee).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const first = await prepareSend(wallet, hidden);

    const firstShape = await describeBuiltTx(first.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(firstShape).toEqual({
      inputs: sorted(['CUSTOM:FS:40', 'HTR:public:10']),
      outputs: ['self:HTR:4'],
      shielded: sorted(['recipient:CUSTOM:FS:10', 'recipient:CUSTOM:FS:10', 'self:CUSTOM:FS:20']),
      fee: 3n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });
    expect(first.txData.tokens).toEqual([]);

    await broadcast(first.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:AS:30', 'CUSTOM:FS:20'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:4']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(firstShape.fee);
    // The recipient decodes both outputs, amount and token.
    expect(await poolOf(recipient, custom, 'CUSTOM')).toEqual(['CUSTOM:FS:10', 'CUSTOM:FS:10']);
    expect(await unlockedBalance(recipient, custom)).toBe(20n);

    // 2. An amount-shielded output and a transparent one make CUSTOM public in the tx. With one
    // shielded output among public ones, a shielded input is forced in so that output's amount
    // cannot be computed by subtraction, and it is the smallest amount-shielded UTXO, the 30, not
    // the smaller fully shielded 20. The 30 pays the 10 alone, and the change mirrors the
    // shielded output, amount-shielded.
    // CUSTOM: 30 = 5 + 5 (sent) + 20 (change). HTR: 4 = 2 (change) + 2 (fee).
    utxosBefore = await snapshotUtxos(wallet, labels);
    const second = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 2), value: 5n, token: custom, shielded: AS },
      { address: await legacyAddr(recipient, 0), value: 5n, token: custom },
    ]);

    const secondShape = await describeBuiltTx(second.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(secondShape).toEqual({
      inputs: sorted(['CUSTOM:AS:30', 'HTR:public:4']),
      outputs: sorted(['recipient:CUSTOM:5', 'self:HTR:2']),
      shielded: sorted(['recipient:CUSTOM:AS:5', 'self:CUSTOM:AS:20']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    expect(second.txData.tokens).toEqual([custom]);

    await broadcast(second.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:FS:20', 'CUSTOM:AS:20'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:2']);
    expect(await unlockedBalance(recipient, custom)).toBe(30n);
  });

  it('O.3 — HTR is always public: an all-shielded HTR send, a shielded top-up and the change-forcing UTXO take amount-shielded HTR before a smaller fully shielded one', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await GenesisWalletHelper.injectFunds(funder, await legacyAddr(funder, 0), 100n);
    await fundShielded(funder, wallet, HTR, [
      { value: 30n, mode: AS },
      { value: 20n, mode: FS },
      { value: 37n, mode: AS },
      { value: 2n, mode: FS },
      { value: 5n, mode: AS },
    ]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 3n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:AS:30', 'HTR:FS:20', 'HTR:AS:37', 'HTR:FS:2', 'HTR:AS:5', 'HTR:public:3'])
    );
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    let htrBefore = await unlockedBalance(wallet, HTR);

    // A. Every output is shielded, so the shielded pool is drawn from first. HTR pays the fee,
    // so it is always public, and its amount-shielded UTXOs come first: 8 + 6 + 2 (their fees)
    // = 16 takes the 30, the smallest amount-shielded UTXO that pays it alone. By value alone
    // the fully shielded 20 would be taken. The 14 change is shielded in the outputs' mode and
    // pays its own fee: 14 - 1 = 13. HTR: 30 = 14 (sent) + 13 (change) + 3 (fee).
    const sendA = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 8n, token: HTR, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 6n, token: HTR, shielded: AS },
    ]);

    const shapeA = await describeBuiltTx(sendA.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shapeA).toEqual({
      inputs: ['HTR:AS:30'],
      outputs: [],
      shielded: sorted(['recipient:HTR:AS:8', 'recipient:HTR:AS:6', 'self:HTR:AS:13']),
      fee: 3n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendA.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:FS:20', 'HTR:AS:37', 'HTR:FS:2', 'HTR:AS:5', 'HTR:public:3', 'HTR:AS:13'])
    );
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(14n + shapeA.fee);

    // B. A transparent 40: the public pool comes first, and its 3 falls short, so it is spent
    // whole and the shielded pool tops up the other 37, amount-shielded first: the 37 matches it
    // exactly. Spent exactly, that one shielded input would have its value revealed by
    // subtraction, so the smallest other shielded UTXO joins to leave a change, of the mode
    // taken first: the amount-shielded 5, not the smaller fully shielded 2. The 5 change mirrors
    // the spent inputs, amount-shielded, and pays its own fee: 5 - 1 = 4. As the tx's only
    // shielded output it is split, its own value paying the extra fee: 4 - 1 = 3 -> 1 + 2.
    // By value alone the fully shielded 2 would join instead, revealing that it held HTR, and
    // its change, fully shielded to mirror it, would need one more UTXO to pay its own fee.
    // HTR: 3 + 37 + 5 = 40 (sent) + 1 + 2 (change) + 2 (fee).
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    htrBefore = await unlockedBalance(wallet, HTR);
    const sendB = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 40n, token: HTR },
    ]);

    const shapeB = await describeBuiltTx(sendB.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shapeB).toEqual({
      inputs: sorted(['HTR:public:3', 'HTR:AS:37', 'HTR:AS:5']),
      outputs: ['recipient:HTR:40'],
      shielded: ['self:HTR:AS:1', 'self:HTR:AS:2'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendB.sendTx, [wallet, recipient]);

    // Neither fully shielded UTXO was spent, so no tx revealed that they hold HTR.
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:FS:20', 'HTR:FS:2', 'HTR:AS:13', 'HTR:AS:1', 'HTR:AS:2'])
    );
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(40n + shapeB.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(54n);
  });

  it('O.4 — where the mode order leaves a change that taking by value would not, a wallet with just enough HTR is told the change needs its fee, and pinned transparent the send builds without spending the fully shielded UTXO', async () => {
    const { wallet, recipient, custom, labels } = await setupShieldedCustomWallet(
      [
        { value: 30n, mode: FS },
        { value: 40n, mode: AS },
      ],
      2n
    );
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:FS:30', 'CUSTOM:AS:40'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:2']);
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 15n, token: custom, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 15n, token: custom, shielded: AS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, labels);

    // CUSTOM is public in the tx, so its amount-shielded 40 pays the 30, where by value alone
    // the fully shielded 30 would match it exactly, with no change, and the 2 would pay the two
    // fees. The 40 leaves a 10 change, shielded like the outputs, whose own fee makes the HTR
    // owed 3, more than the 2 the wallet holds. The send fails rather than reveal the fully
    // shielded UTXO's token, and the error says the amount includes the fee to shield the
    // change, and how to keep it transparent.
    const refused = wallet.sendManyOutputsTransaction(outputs);
    await expect(refused).rejects.toThrow(
      new SendTxError(
        'Token: 00. Insufficient amount of tokens to fill the amount. The amount includes the fee ' +
          'to shield the change; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the ' +
          'change transparent.'
      )
    );
    await expect(refused).rejects.toBeInstanceOf(SendTxError);

    // Nothing was broadcast and nothing stays selected: the same UTXOs are still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, labels);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));

    // As the error suggests, pinned transparent: the change mode does not change the order, so
    // the 40 is spent again, and its 10 change stays public, owing no fee as CUSTOM is a DEPOSIT
    // token. The 2 pays the two amount-shielded fees exactly. The tx spends a shielded input into
    // shielded outputs and a transparent change, so it carries no excess blinding factor. The
    // fully shielded 30 is never spent. CUSTOM: 40 = 15 + 15 (sent) + 10 (change).
    // HTR: 2 = 2 (fee).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:AS:40', 'HTR:public:2']),
      outputs: ['self:CUSTOM:10'],
      shielded: ['recipient:CUSTOM:AS:15', 'recipient:CUSTOM:AS:15'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    expect(txData.excessBlindingFactor).toBeUndefined();

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(
      sorted(['CUSTOM:FS:30', 'CUSTOM:public:10'])
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(30n);
  });

  it('O.5 — the input limit, prepare-only: a transparent send past 255 inputs fails with InputLimitError, a stand-in change past it fails instead of a split, and a send whose mode order needs more than 255 inputs is built again by value', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await GenesisWalletHelper.injectFunds(funder, await legacyAddr(funder, 0), 400n);
    const tokenResponse = await createTokenHelper(funder, 'Mode Order Limit', 'MOL', 200n, {
      address: await legacyAddr(funder, 1),
    });
    const custom: string = tokenResponse.hash;
    const labels: TokenLabels = { [HTR]: 'HTR', [custom]: 'CUSTOM' };
    await fundShielded(funder, wallet, custom, [
      ...Array.from({ length: 10 }, () => ({ value: 1n, mode: AS })),
      { value: 100n, mode: FS },
    ]);
    const htrAddress = await legacyAddr(wallet, 0);
    const publicOnes = (count: number): ProposedOutput[] =>
      Array.from({ length: count }, () => ({ address: htrAddress, value: 1n, token: HTR }));
    // A tx holds at most 255 outputs: 254 of these and the funder's change, then the other 2.
    await fund(funder, wallet, publicOnes(MAX_OUTPUTS - 1));
    await fund(funder, wallet, publicOnes(2));

    const customPool = sorted([...Array(10).fill('CUSTOM:AS:1'), 'CUSTOM:FS:100']);
    const htrPool: string[] = Array(256).fill('HTR:public:1');
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(customPool);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(htrPool);
    // Nothing here is broadcast (signing some 250 inputs under jest is too slow), and a send
    // that is only built reserves no UTXO: every step leaves the pools as they are.
    const expectPoolsUnchanged = async (): Promise<void> => {
      expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(customPool);
      expect(await poolOf(wallet, HTR, 'HTR')).toEqual(htrPool);
    };
    const utxosBefore = await snapshotUtxos(wallet, labels);

    // a. The 256 public 1 pay 256 only all together, one input more than a tx holds. The send
    // fails with the number of inputs it needs, "at least" as later steps could add more, and
    // advises consolidating the wallet's UTXOs.
    const pastTheLimit = wallet.sendManyOutputsTransaction([
      { address: await legacyAddr(recipient, 0), value: 256n, token: HTR },
    ]);
    await expect(pastTheLimit).rejects.toThrow(
      new InputLimitError(
        'The transaction needs at least 256 inputs, more than the 255 a transaction can hold. ' +
          "Consolidate the wallet's UTXOs and try again."
      )
    );
    await expect(pastTheLimit).rejects.toBeInstanceOf(InputLimitError);
    await expect(pastTheLimit).rejects.toBeInstanceOf(SendTxError);
    await expectPoolsUnchanged();

    // b. One public and one shielded HTR output, from a wallet with no shielded HTR: the HTR
    // change stands in for the shielded input that would hide the shielded output's amount. 254
    // of the public 1 pay 248 + 5 + 1 (the shielded output's fee) exactly and leave no change,
    // so HTR is pulled, smallest first, until a change pays its own fee: two more 1, 256 inputs.
    // The send fails on that count rather than split the 248, whose halves would add up to its
    // amount. Built again by value, it fails the same way: the wallet holds no shielded HTR.
    const standIn: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 248n, token: HTR, shielded: AS },
    ];
    const standInRefused = wallet.sendManyOutputsTransaction(standIn);
    await expect(standInRefused).rejects.toThrow(
      new InputLimitError(
        'The transaction needs 256 inputs, more than the 255 a transaction can hold. ' +
          "Consolidate the wallet's UTXOs and try again."
      )
    );
    await expect(standInRefused).rejects.toBeInstanceOf(InputLimitError);
    await expectPoolsUnchanged();

    // Pinned transparent, no change stands in. The 248 is then the tx's only shielded output and
    // is split, and the split's fee takes one more 1: 255 inputs, every one a tx holds.
    // HTR: 255 = 5 + 124 + 124 (sent) + 2 (fee).
    const pinned = await prepareSend(wallet, standIn, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const pinnedShape = await describeBuiltTx(pinned.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(pinnedShape).toEqual({
      inputs: Array(MAX_INPUTS).fill('HTR:public:1'),
      outputs: ['recipient:HTR:5'],
      shielded: ['recipient:HTR:AS:124', 'recipient:HTR:AS:124'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    await expectPoolsUnchanged();

    // c. An amount-shielded CUSTOM output and a public HTR one. CUSTOM is public in the tx, so
    // its amount-shielded UTXOs come first: the ten 1 pay the 10 exactly. HTR then owes
    // 247 + 1 (the shielded output's fee) = 248 public 1, where 245 inputs are left: the send
    // needs at least 258 inputs, so it is built again with shielded UTXOs taken by value alone.
    // That build pays the 10 with the fully shielded 100 alone, revealing its token, and the 90
    // change is shielded like the output; HTR then owes 247 + 2 (fees) = 249 public 1, and the
    // 250 inputs fit. CUSTOM: 100 = 10 (sent) + 90 (change). HTR: 249 = 247 (sent) + 2 (fee).
    const rebuilt = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 1), value: 10n, token: custom, shielded: AS },
      { address: await legacyAddr(recipient, 0), value: 247n, token: HTR },
    ]);

    const rebuiltShape = await describeBuiltTx(rebuilt.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(rebuiltShape).toEqual({
      inputs: sorted(['CUSTOM:FS:100', ...Array(249).fill('HTR:public:1')]),
      outputs: ['recipient:HTR:247'],
      shielded: sorted(['recipient:CUSTOM:AS:10', 'self:CUSTOM:AS:90']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    expect(rebuilt.txData.inputs).toHaveLength(250);
    await expectPoolsUnchanged();

    // Nothing reached the recipient.
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual([]);
    expect(await poolOf(recipient, custom, 'CUSTOM')).toEqual([]);
  });
});
