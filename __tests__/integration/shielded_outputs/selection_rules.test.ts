/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group X — Automatic UTXO-pool selection and change-mode rules, end to end.
 *
 * For each token the wallet looks at its outputs and decides which pool the inputs come from
 * and whether the change is shielded, and in which mode:
 *
 * - All outputs shielded: the shielded pool first; the change is shielded in the most private
 *   mode among the outputs (X.1). A shielded pool that falls short is spent whole and topped up
 *   from the public one (T.3, in the FEE-token group).
 * - All outputs public: the public pool first, shielded UTXOs only when public funds fall
 *   short. A spent shielded input shields the change, mirroring the inputs (X.2); an exact
 *   match that would spend exactly one shielded input pulls the smallest other shielded UTXO,
 *   of the mode taken first, else of the other mode, so a change exists to hide that input's
 *   value behind (X.3, X.7).
 * - Mixed, with exactly one shielded output: a shielded input is force-included even when
 *   public funds cover the send, the smallest of the mode taken first: amount-shielded for
 *   HTR, which pays the fee and so is always public. The change mirrors the outputs (X.4).
 *   With no shielded UTXO the change is shielded instead, so the output and the change are
 *   two hidden values (X.5), or the send fails (Group Y).
 * - Mixed, with two or more shielded outputs: nothing is forced while they all pay the wallet
 *   itself, and an external one forces the smallest shielded UTXO of the mode taken first
 *   (X.6); with no shielded UTXO they are left as they are, since their total is public
 *   either way (X.5).
 * - HTR entering only to pay fees follows the all-public rule, shielded top-up and exact-match
 *   forcing included (X.7).
 * - An explicit `changeShieldedMode` wins: OutputKind.TRANSPARENT keeps every change public and turns
 *   the exact-match forcing off (X.3, X.8); AMOUNT_SHIELDED or FULLY_SHIELDED shields the
 *   change even on a transparent-only send, split in two when it is the tx's only shielded
 *   output (X.9).
 * - Caller-supplied inputs are spent as given, with nothing selected for their token, and a
 *   shielded one still shields its token's change (X.10).
 * - A legacy `changeAddress` is honored while every change stays transparent, on a shielded
 *   send too, and rejected before broadcast once a change must be shielded; an own new-format
 *   `changeAddress` hosts the shielded change (X.11).
 * - A transparent output to a new-format address pays its spend-derived P2PKH, and an own
 *   new-format `changeAddress` hosts a transparent change the same way (X.12).
 *
 * These run against a real node because every resulting shape must also be ACCEPTED: the
 * node exact-matches the FeeHeader, verifies the balance of shielded commitments (or the
 * excess of a full unshield), and rejects a tx with exactly one shielded output.
 *
 * Funding keeps each test wallet's pool exact: shielded UTXOs come from a funder wallet in
 * their own tx with the funder's change pinned transparent (a single wallet output is paired
 * with one to the funder's own shielded address, so the wallet does not split it into two
 * halves), and public HTR comes from the genesis wallet in a separate tx.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { createTokenHelper, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import {
  TokenLabels,
  broadcast,
  describeBuiltTx,
  fund,
  fundShielded,
  legacyAddr,
  poolOf,
  prepareSend,
  setupCustomTokenWallet,
  shieldedAddr,
  snapshotUtxos,
  sorted,
  spendAddressOf,
  startFunder,
  unlockedBalance,
  utxoKind,
} from '../helpers/shielded-send.helper';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
  NATIVE_TOKEN_UID,
} from '../../../src/constants';
import { ProposedOutput } from '../../../src/new/types';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { IUtxo } from '../../../src/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const FS = ShieldedOutputMode.FULLY_SHIELDED;
const HTR = NATIVE_TOKEN_UID;
const HTR_LABELS: TokenLabels = { [HTR]: 'HTR' };

describe('shielded outputs — Group X: Automatic selection rules', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('X.1 — an all-shielded HTR send draws from the shielded pool and shields its change', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [{ value: 30n, mode: AS }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 50n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:50', 'HTR:AS:30']));
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // 8 (amount-shielded) + 6 (fully shielded) + their 1 + 2 fees = 17: either pool covers it
    // and the shielded one is drawn from. The change is shielded in the most private mode
    // among the outputs (fully shielded): 30 - 17 = 13, minus its own 2 fee = 11. The public
    // 50 is untouched. HTR: 30 = 14 (sent) + 11 (change) + 5 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 8n, token: HTR, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 6n, token: HTR, shielded: FS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:AS:30'],
      outputs: [],
      shielded: sorted(['recipient:HTR:AS:8', 'recipient:HTR:FS:6', 'self:HTR:FS:11']),
      fee: FEE_PER_AMOUNT_SHIELDED_OUTPUT + 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:50', 'HTR:FS:11']));
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(14n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(14n);
  });

  it('X.2 — a public send topped up from a fully-shielded UTXO gets a fully-shielded change, split when lone', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [{ value: 20n, mode: FS }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 8n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:8', 'HTR:FS:20']));
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // Public first: the 8 falls short of 12, so it is spent whole and the fully-shielded 20
    // tops up. The 16 change mirrors that input (fully shielded): 16 - 2 (its fee) = 14. As
    // the tx's only shielded output it is split, its own value paying the extra 2 fee:
    // 12 -> 6 + 6. HTR: 8 + 20 = 12 (sent) + 6 + 6 (change) + 4 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 12n, token: HTR },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:8', 'HTR:FS:20']),
      outputs: ['recipient:HTR:12'],
      shielded: ['self:HTR:FS:6', 'self:HTR:FS:6'],
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:6', 'HTR:FS:6']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(12n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(12n);
  });

  it('X.3 — an exact match on a single shielded input pulls the smallest extra UTXO; OutputKind.TRANSPARENT turns that off', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [
      { value: 20n, mode: AS },
      { value: 9n, mode: AS },
      { value: 6n, mode: AS },
    ]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:AS:20', 'HTR:AS:9', 'HTR:AS:6']));
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // There is no public HTR, so the shielded pool tops up and its 20 matches the 20 sent
    // exactly. Spending that one shielded input with no change would reveal its value, so the
    // smallest other UTXO (6, not 9) joins. The 6 change mirrors the inputs (amount-shielded):
    // 6 - 1 = 5, then split as the lone shielded output: 5 - 1 = 4 -> 2 + 2.
    // HTR: 20 + 6 = 20 (sent) + 2 + 2 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 20n, token: HTR },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:AS:20', 'HTR:AS:6']),
      outputs: ['recipient:HTR:20'],
      shielded: ['self:HTR:AS:2', 'self:HTR:AS:2'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:AS:9', 'HTR:AS:2', 'HTR:AS:2']));
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(20n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(20n);

    // The forcing exists only to give a shielded change something to hide behind, so
    // changeShieldedMode OutputKind.TRANSPARENT turns it off: the shielded 9 matches a 9 exactly,
    // nothing joins it, and the tx fully unshields that one input, with no change and no fee.
    const utxosBeforeUnforced = await snapshotUtxos(wallet, HTR_LABELS);
    const unforced = await prepareSend(
      wallet,
      [{ address: await legacyAddr(recipient, 1), value: 9n, token: HTR }],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );

    const unforcedShape = await describeBuiltTx(unforced.txData, utxosBeforeUnforced, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(unforcedShape).toEqual({
      inputs: ['HTR:AS:9'],
      outputs: ['recipient:HTR:9'],
      shielded: [],
      fee: 0n,
    });
    expect(unforced.txData.excessBlindingFactor).toBeDefined();

    await broadcast(unforced.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:2', 'HTR:AS:2']);
    expect(await unlockedBalance(recipient, HTR)).toBe(29n);
  });

  it('X.4 — a mixed send with one external shielded output force-includes an amount-shielded input before a smaller fully-shielded one', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [
      { value: 5n, mode: FS },
      { value: 9n, mode: AS },
    ]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 100n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:100', 'HTR:FS:5', 'HTR:AS:9'])
    );
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // One public and one shielded HTR output: the public 100 alone covers 10 + 20 + 1 (fee),
    // but a shielded input is force-included so the shielded output's value cannot be computed
    // from public amounts. HTR pays the fee, so it is always public in the tx, and its
    // amount-shielded UTXOs are taken first: the forced input is the amount-shielded 9, not
    // the smaller fully-shielded 5, whose spending would reveal its token. The public 100 pays
    // the 22 left. A shielded input was used, so the change is shielded, mirroring the shielded
    // outputs (amount-shielded): 109 - 31 = 78, minus its 1 fee = 77.
    // HTR: 9 + 100 = 30 (sent) + 77 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 10n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 20n, token: HTR, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:AS:9', 'HTR:public:100']),
      outputs: ['recipient:HTR:10'],
      shielded: sorted(['recipient:HTR:AS:20', 'self:HTR:AS:77']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:FS:5', 'HTR:AS:77']));
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(30n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(30n);
  });

  it('X.5 — with no shielded UTXO, a mixed send shields its change instead of forcing an input', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 100n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:100']);
    const paidTo = [
      await shieldedAddr(recipient, 0),
      await shieldedAddr(recipient, 1),
      await shieldedAddr(recipient, 2),
    ];
    const paidOnChain = paidTo.map(address => spendAddressOf(wallet, address));

    // 1. One shielded output: the rules want a shielded input to hide it among, the wallet has
    // none, so the change is shielded instead, in the output's mode. Left transparent, it
    // would publish the 20 by subtraction; shielded, the output and the change are two hidden
    // values. HTR: 100 = 10 + 20 (sent) + 68 (change) + 2 (fee).
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const single = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 10n, token: HTR },
      { address: paidTo[0], value: 20n, token: HTR, shielded: AS },
    ]);

    const singleShape = await describeBuiltTx(single.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(singleShape).toEqual({
      inputs: ['HTR:public:100'],
      outputs: ['recipient:HTR:10'],
      shielded: sorted(['recipient:HTR:AS:20', 'self:HTR:AS:68']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    expect((single.txData.shieldedOutputs ?? []).map(output => output.address)).toContain(
      paidOnChain[0]
    );

    await broadcast(single.sendTx, [wallet, recipient]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:68']);

    // 2. Two shielded outputs, both external, from a wallet with only public funds: the
    // outputs already meet the two-output minimum and their total is public either way, so
    // they are left whole and the change stays transparent.
    // HTR: 68 = 10 + 6 + 4 (sent) + 46 (change) + 2 (fee).
    const publicOnly = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(publicOnly, await legacyAddr(publicOnly, 0), 68n);
    utxosBefore = await snapshotUtxos(publicOnly, HTR_LABELS);
    const several = await prepareSend(publicOnly, [
      { address: await legacyAddr(recipient, 0), value: 10n, token: HTR },
      { address: paidTo[1], value: 6n, token: HTR, shielded: AS },
      { address: paidTo[2], value: 4n, token: HTR, shielded: AS },
    ]);

    const severalShape = await describeBuiltTx(several.txData, utxosBefore, {
      sender: publicOnly,
      recipient,
      labels: HTR_LABELS,
    });
    expect(severalShape).toEqual({
      inputs: ['HTR:public:68'],
      outputs: sorted(['recipient:HTR:10', 'self:HTR:46']),
      shielded: sorted(['recipient:HTR:AS:6', 'recipient:HTR:AS:4']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    const severalByAddress = (several.txData.shieldedOutputs ?? []).map(
      output => `${output.address}:${output.value}`
    );
    expect(sorted(severalByAddress)).toEqual(
      sorted([`${paidOnChain[1]}:6`, `${paidOnChain[2]}:4`])
    );

    await broadcast(several.sendTx, [publicOnly, recipient]);

    expect(await poolOf(publicOnly, HTR, 'HTR')).toEqual(['HTR:public:46']);
    expect(await unlockedBalance(recipient, HTR)).toBe(50n);
  });

  it('X.6 — two or more shielded outputs force a shielded input only when one leaves the wallet', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [{ value: 5n, mode: AS }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 100n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:100', 'HTR:AS:5']));

    // 1. Both shielded outputs pay the wallet's own addresses, so no shielded input is forced
    // and the shielded 5 stays. No shielded input is spent and the outputs are mixed, so the
    // change stays transparent. HTR: 100 = 10 (sent) + 6 + 4 (to itself) + 78 (change) +
    // 2 (fee).
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const toSelf = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 10n, token: HTR },
      { address: await shieldedAddr(wallet, 1), value: 6n, token: HTR, shielded: AS },
      { address: await shieldedAddr(wallet, 2), value: 4n, token: HTR, shielded: AS },
    ]);

    const toSelfShape = await describeBuiltTx(toSelf.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(toSelfShape).toEqual({
      inputs: ['HTR:public:100'],
      outputs: sorted(['recipient:HTR:10', 'self:HTR:78']),
      shielded: sorted(['self:HTR:AS:6', 'self:HTR:AS:4']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(toSelf.sendTx, [wallet, recipient]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:AS:5', 'HTR:AS:6', 'HTR:AS:4', 'HTR:public:78'])
    );

    // 2. The same amounts paid to the recipient: an external shielded output forces the
    // smallest shielded UTXO in (the 4 the wallet just paid itself). The change is shielded,
    // mirroring the outputs: 4 + 78 - 22 = 60, minus its 1 fee = 59.
    // HTR: 4 + 78 = 20 (sent) + 59 (change) + 3 (fee).
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const external = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 10n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 6n, token: HTR, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 4n, token: HTR, shielded: AS },
    ]);

    const externalShape = await describeBuiltTx(external.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(externalShape).toEqual({
      inputs: sorted(['HTR:AS:4', 'HTR:public:78']),
      outputs: ['recipient:HTR:10'],
      shielded: sorted(['recipient:HTR:AS:6', 'recipient:HTR:AS:4', 'self:HTR:AS:59']),
      fee: 3n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(external.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:AS:5', 'HTR:AS:6', 'HTR:AS:59']));
    expect(await unlockedBalance(recipient, HTR)).toBe(30n);
  });

  it('X.7 — HTR entering only for fees draws on the shielded pool when public HTR is short', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(0n, [
      { value: 2n, mode: AS },
      { value: 3n, mode: FS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:AS:2', 'HTR:FS:3']));
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // CUSTOM matches exactly. HTR enters only for the two amount-shielded fees (2) and the
    // wallet has no public HTR, so the shielded pool tops up: its 2 matches exactly. Spending
    // that one shielded input with no change would reveal its value, so the smallest other
    // UTXO (the fully-shielded 3) joins. The 3 change mirrors the inputs in their most
    // private mode (fully shielded): 3 - 2 (its fee) = 1. HTR: 2 + 3 = 1 (change) + 4 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 6n, token: custom, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 4n, token: custom, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:AS:2', 'HTR:FS:3']),
      outputs: [],
      shielded: sorted(['recipient:CUSTOM:AS:6', 'recipient:CUSTOM:AS:4', 'self:HTR:FS:1']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT + FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:1']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('X.8 — changeShieldedMode OutputKind.TRANSPARENT keeps every change public and fully unshields', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const tokenResponse = await createTokenHelper(funder, 'Transparent Change', 'TCH', 100n, {
      address: await legacyAddr(funder, 1),
    });
    const custom: string = tokenResponse.hash;
    const labels: TokenLabels = { [HTR]: 'HTR', [custom]: 'CUSTOM' };
    // One shielded UTXO of each token, both in the same funding tx (two shielded outputs).
    await fund(
      funder,
      wallet,
      [
        { address: await shieldedAddr(wallet, 0), value: 30n, token: custom, shielded: AS },
        { address: await shieldedAddr(wallet, 1), value: 20n, token: HTR, shielded: AS },
      ],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:AS:30']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:20']);
    const utxosBefore = await snapshotUtxos(wallet, labels);

    // Both tokens only have shielded UTXOs, so each payment unshields one. The rules would
    // shield both changes (they mirror the shielded inputs); the explicit OutputKind.TRANSPARENT keeps
    // them public. No shielded output remains: the tx is a full unshield carrying the excess
    // blinding factor, and with a DEPOSIT token and no shielded output it owes no fee.
    const { sendTx, txData } = await prepareSend(
      wallet,
      [
        { address: await legacyAddr(recipient, 0), value: 12n, token: custom },
        { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      ],
      { changeShieldedMode: OutputKind.TRANSPARENT }
    );

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:AS:30', 'HTR:AS:20']),
      outputs: sorted(['recipient:CUSTOM:12', 'recipient:HTR:5', 'self:CUSTOM:18', 'self:HTR:15']),
      shielded: [],
      fee: 0n,
    });
    expect(txData.excessBlindingFactor).toBeDefined();

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:18']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:15']);
    expect(await unlockedBalance(wallet, custom)).toBe(18n);
    expect(await unlockedBalance(wallet, HTR)).toBe(15n);
    expect(await unlockedBalance(recipient, custom)).toBe(12n);
    expect(await unlockedBalance(recipient, HTR)).toBe(5n);
  });

  it('X.9 — an explicit shielded changeShieldedMode shields the change of a transparent-only send, split when lone', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 100n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:100']);
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // Public 100 pays the 10. The 90 change is emitted amount-shielded as requested: 90 - 1 =
    // 89, then split as the lone shielded output: 89 - 1 = 88 -> 44 + 44.
    // HTR: 100 = 10 (sent) + 44 + 44 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(
      wallet,
      [{ address: await legacyAddr(recipient, 0), value: 10n, token: HTR }],
      { changeShieldedMode: AS }
    );

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:public:100'],
      outputs: ['recipient:HTR:10'],
      shielded: ['self:HTR:AS:44', 'self:HTR:AS:44'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:44', 'HTR:AS:44']);
    expect(await unlockedBalance(wallet, HTR)).toBe(100n - 10n - shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(10n);

    // FULLY_SHIELDED wins over the rules as well, which would mirror the amount-shielded
    // input: with no public HTR left a 44 is spent, and the 34 change is emitted fully
    // shielded: 34 - 2 = 32, then split as the lone shielded output: 32 - 2 = 30 -> 15 + 15.
    // HTR: 44 = 10 (sent) + 15 + 15 (change) + 4 (fee).
    const utxosBeforeFullyShielded = await snapshotUtxos(wallet, HTR_LABELS);
    const fullyShielded = await prepareSend(
      wallet,
      [{ address: await legacyAddr(recipient, 1), value: 10n, token: HTR }],
      { changeShieldedMode: FS }
    );

    const fullyShieldedShape = await describeBuiltTx(
      fullyShielded.txData,
      utxosBeforeFullyShielded,
      { sender: wallet, recipient, labels: HTR_LABELS }
    );
    expect(fullyShieldedShape).toEqual({
      inputs: ['HTR:AS:44'],
      outputs: ['recipient:HTR:10'],
      shielded: ['self:HTR:FS:15', 'self:HTR:FS:15'],
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(fullyShielded.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:AS:44', 'HTR:FS:15', 'HTR:FS:15'])
    );
    expect(await unlockedBalance(wallet, HTR)).toBe(74n);
    expect(await unlockedBalance(recipient, HTR)).toBe(20n);
  });

  it('X.10 — a caller-supplied shielded input is spent as given and shields its change', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [{ value: 30n, mode: AS }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 50n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:50', 'HTR:AS:30']));
    const shieldedUtxos: IUtxo[] = [];
    for await (const utxo of wallet.storage.selectUtxos({ token: HTR, shielded: true })) {
      shieldedUtxos.push(utxo);
    }
    expect(shieldedUtxos.map(utxo => utxo.value)).toEqual([30n]);
    const [{ txId, index }] = shieldedUtxos;
    // A shielded output's on-chain index comes after every transparent output of its tx.
    const fundingTx = await wallet.getTx(txId);
    expect(index).toBeGreaterThanOrEqual(fundingTx?.outputs.length ?? Number.MAX_SAFE_INTEGER);
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // The caller picks the shielded 30 for a 10 transparent payment, and the wallet adds
    // nothing of its own: the public 50, which alone would cover the payment, stays untouched.
    // The spent shielded input shields the 20 change, mirroring it (amount-shielded):
    // 20 - 1 = 19, then split as the lone shielded output, its own value paying the extra 1
    // fee: 18 -> 9 + 9. HTR: 30 = 10 (sent) + 9 + 9 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(
      wallet,
      [{ address: await legacyAddr(recipient, 0), value: 10n, token: HTR }],
      { inputs: [{ txId, index, token: HTR }] }
    );

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:AS:30'],
      outputs: ['recipient:HTR:10'],
      shielded: ['self:HTR:AS:9', 'self:HTR:AS:9'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    // The input is spent at that on-chain index and reaches fee accounting flagged shielded.
    const spent = txData.inputs.map(input => ({
      txId: input.txId,
      index: input.index,
      shielded: input.shielded,
    }));
    expect(spent).toEqual([{ txId, index, shielded: true }]);

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:AS:9', 'HTR:AS:9', 'HTR:public:50'])
    );
    expect(await unlockedBalance(wallet, HTR)).toBe(68n);
    expect(await unlockedBalance(recipient, HTR)).toBe(10n);
  });

  it('X.11 — a legacy changeAddress takes a change that stays transparent, is rejected once one must be shielded, and an own new-format one hosts it', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [{ value: 30n, mode: AS }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 10n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:10', 'HTR:AS:30']));

    const legacyChange = await legacyAddr(wallet, 5);
    const shieldedChange = await shieldedAddr(wallet, 7);
    // Neither is where the wallet would put a change by default, so honoring them is visible.
    expect((await wallet.getCurrentAddress()).address).not.toBe(legacyChange);
    expect((await wallet.getCurrentAddress({}, { legacy: false })).address).not.toBe(
      shieldedChange
    );
    const pay = async (value: bigint): Promise<ProposedOutput[]> => [
      { address: await legacyAddr(recipient, 0), value, token: HTR },
    ];

    // 1. Public funds cover 4: the change stays transparent and goes to the legacy address.
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const first = await prepareSend(wallet, await pay(4n), { changeAddress: legacyChange });
    const firstShape = await describeBuiltTx(first.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(firstShape).toEqual({
      inputs: ['HTR:public:10'],
      outputs: sorted(['recipient:HTR:4', 'self:HTR:6']),
      shielded: [],
      fee: 0n,
    });
    const changeAt = first.txData.outputs.filter(
      output => 'address' in output && output.address === legacyChange
    );
    expect(changeAt.map(output => output.value)).toEqual([6n]);
    await broadcast(first.sendTx, [wallet, recipient]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:6', 'HTR:AS:30']));

    // 2. Public 6 falls short of 20, so the shielded 30 tops up and the rules shield the
    // change: the legacy address cannot host it and the send fails before broadcast.
    await expect(
      wallet.sendManyOutputsTransaction(await pay(20n), { changeAddress: legacyChange })
    ).rejects.toThrow(/legacy change address cannot receive it/);
    // With every output shielded the change must be shielded too: rejected the same way.
    await expect(
      wallet.sendManyOutputsTransaction(
        [
          { address: await shieldedAddr(recipient, 0), value: 5n, token: HTR, shielded: AS },
          { address: await shieldedAddr(recipient, 1), value: 5n, token: HTR, shielded: AS },
        ],
        { changeAddress: legacyChange }
      )
    ).rejects.toThrow(/legacy change address cannot receive it/);
    // A new-format changeAddress must belong to the wallet. The public 6 pays this 6 exactly,
    // so the send would have no change at all: only the ownership check made before selection
    // can reject it.
    await expect(
      wallet.sendManyOutputsTransaction(await pay(6n), {
        changeAddress: await shieldedAddr(recipient, 0),
      })
    ).rejects.toThrow('Change address is not from the wallet');
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:6', 'HTR:AS:30']));

    // 3. The same 20 with an own new-format changeAddress: the shielded change goes there.
    // 6 + 30 = 36; the 16 change mirrors the amount-shielded input: 16 - 1 = 15, then split
    // as the lone shielded output: 15 - 1 = 14 -> 7 + 7, both at that address.
    // HTR: 36 = 20 (sent) + 7 + 7 (change) + 2 (fee).
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const second = await prepareSend(wallet, await pay(20n), { changeAddress: shieldedChange });
    const secondShape = await describeBuiltTx(second.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(secondShape).toEqual({
      inputs: sorted(['HTR:public:6', 'HTR:AS:30']),
      outputs: ['recipient:HTR:20'],
      shielded: ['self:HTR:AS:7', 'self:HTR:AS:7'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    const changeSpendAddress = spendAddressOf(wallet, shieldedChange);
    expect((second.txData.shieldedOutputs ?? []).map(output => output.address)).toEqual([
      changeSpendAddress,
      changeSpendAddress,
    ]);
    await broadcast(second.sendTx, [wallet, recipient]);

    const atChangeAddress: string[] = [];
    for await (const utxo of wallet.storage.selectUtxos({
      token: HTR,
      filter_address: shieldedChange,
    })) {
      atChangeAddress.push(`HTR:${utxoKind(utxo)}:${utxo.value}`);
    }
    expect(atChangeAddress).toEqual(['HTR:AS:7', 'HTR:AS:7']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:7', 'HTR:AS:7']);
    expect(await unlockedBalance(wallet, HTR)).toBe(14n);
    expect(await unlockedBalance(recipient, HTR)).toBe(24n);

    // 4. A shielded send whose change is pinned transparent takes the legacy address: the
    // change of the two shielded 7 goes there, public. HTR: 14 = 3 + 3 (sent) + 6 (change)
    // + 2 (fee).
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const third = await prepareSend(
      wallet,
      [
        { address: await shieldedAddr(recipient, 2), value: 3n, token: HTR, shielded: AS },
        { address: await shieldedAddr(recipient, 3), value: 3n, token: HTR, shielded: AS },
      ],
      { changeAddress: legacyChange, changeShieldedMode: OutputKind.TRANSPARENT }
    );
    const thirdShape = await describeBuiltTx(third.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(thirdShape).toEqual({
      inputs: ['HTR:AS:7', 'HTR:AS:7'],
      outputs: ['self:HTR:6'],
      shielded: ['recipient:HTR:AS:3', 'recipient:HTR:AS:3'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    const legacyChangeAt = third.txData.outputs.filter(
      output => 'address' in output && output.address === legacyChange
    );
    expect(legacyChangeAt.map(output => output.value)).toEqual([6n]);
    await broadcast(third.sendTx, [wallet, recipient]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:6']);
    expect(await unlockedBalance(recipient, HTR)).toBe(30n);
  });

  it('X.12 — a transparent output to a new-format address pays its spend P2PKH; so does a new-format changeAddress', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 20n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:20']);
    const paidTo = await shieldedAddr(recipient, 0);
    const changeAddress = await shieldedAddr(wallet, 3);
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // Nothing shielded is sent or spent: no fee, and the change stays transparent. The
    // payment, a plain transparent output to the recipient's new-format address, is resolved
    // to that address's spend-derived P2PKH while the tx is built; the new-format change
    // address passes the same ownership check a legacy one does.
    // HTR: 20 = 5 (sent) + 15 (change).
    const { sendTx, txData } = await prepareSend(
      wallet,
      [{ address: paidTo, value: 5n, token: HTR }],
      { changeAddress }
    );

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:public:20'],
      outputs: sorted(['recipient:HTR:5', 'self:HTR:15']),
      shielded: [],
      fee: 0n,
    });
    const payment = txData.outputs.filter(output => output.value === 5n);
    expect(payment.map(output => ('address' in output ? output.address : ''))).toEqual([
      spendAddressOf(wallet, paidTo),
    ]);

    const hash = await broadcast(sendTx, [wallet, recipient]);

    // On chain, each output pays the spend-derived P2PKH of its new-format address.
    const pushed = await wallet.getTx(hash);
    const paidOnChain = (pushed?.outputs ?? []).map(
      output => `${output.decoded.address}:${output.value}`
    );
    expect(sorted(paidOnChain)).toEqual(
      sorted([`${spendAddressOf(wallet, paidTo)}:5`, `${spendAddressOf(wallet, changeAddress)}:15`])
    );
    // Both are transparent UTXOs of their owners: the payment for the recipient, the change at
    // the wallet's change address.
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual(['HTR:public:5']);
    const atChangeAddress: string[] = [];
    for await (const utxo of wallet.storage.selectUtxos({
      token: HTR,
      filter_address: changeAddress,
    })) {
      atChangeAddress.push(`HTR:${utxoKind(utxo)}:${utxo.value}`);
    }
    expect(atChangeAddress).toEqual(['HTR:public:15']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:15']);
    expect(await unlockedBalance(recipient, HTR)).toBe(5n);
  });
});
