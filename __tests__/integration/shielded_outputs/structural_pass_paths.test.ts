/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group SP — Lone-output and structural-pass paths, end to end.
 *
 * A transaction with exactly one shielded output cannot balance, and the fullnode rejects it, so
 * the wallet gives a lone shielded output a second one: it splits the output into two halves,
 * paying one more shielded-output fee (the split fee), or it shields an HTR change as the
 * second output. Which of the two happens, and where its HTR comes from, depends on the change
 * mode, on the HTR change the selection leaves and on the UTXOs the wallet can still pull:
 *
 * - SP.1: an explicit changeShieldedMode decides every change of the send, so on a send whose
 *   change would otherwise stand in for a missing shielded input, both changes take the
 *   requested mode and the recipient's output keeps its own.
 * - SP.2: a fee-sized shielded HTR UTXO is spent whole on the fees: its change, too small for
 *   its own fee, pays the split fee.
 * - SP.3: a lone shielded HTR output whose change equals its own fee is split, the change paying
 *   the split fee, amount-shielded and fully shielded.
 * - SP.4: a 1-unit output cannot be split, so the HTR change is its second output: topped up from
 *   fully shielded HTR it mirrors that UTXO, and made of transparent HTR alone it is
 *   amount-shielded.
 * - SP.5: a transparent HTR change short of the split fee is topped up from shielded HTR into an
 *   amount-shielded change, which costs less than the split.
 * - SP.6: a split-fee pull that would spend a shielded UTXO exactly on the fee pulls on until it
 *   funds a shielded change, which a legacy changeAddress cannot receive.
 * - SP.7: with the change pinned transparent, the split fee comes from transparent HTR first.
 * - SP.8: UTXOs another send holds are never taken: the probe for a shielded UTXO and the HTR
 *   pull both skip them.
 * - SP.9: a 1-unit output paid with caller-supplied HTR takes the caller's change as its second
 *   output, and fails when that HTR leaves too little.
 * - SP.10: an exact split-fee pull for a fully shielded output becomes a pinned amount-shielded
 *   change, which costs less than the split.
 *
 * Every tx built here must be accepted by the node, which exact-matches the declared fee and
 * verifies the balance of the shielded commitments and the surjection proofs of the fully
 * shielded outputs.
 *
 * Funding keeps each test wallet's pool exact: public HTR comes from the genesis wallet, one UTXO
 * per injectFunds call; a custom token comes from a funder in its own tx; shielded HTR comes from
 * the funder in another tx, with the funder's change pinned transparent and a single wallet
 * output paired with one to the funder's own shielded address, so the wallet does not split it.
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
  startFunder,
  unlockedBalance,
  utxoKind,
} from '../helpers/shielded-send.helper';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
  NATIVE_TOKEN_UID,
} from '../../../src/constants';
import { SendTxError } from '../../../src/errors';
import HathorWallet from '../../../src/new/wallet';
import { ProposedOutput } from '../../../src/new/types';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { IUtxo } from '../../../src/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const FS = ShieldedOutputMode.FULLY_SHIELDED;
const HTR = NATIVE_TOKEN_UID;
const HTR_LABELS: TokenLabels = { [HTR]: 'HTR' };

/**
 * The wallet's one available UTXO of `token` that is of `kind` ('public', 'AS' or 'FS') and holds
 * `value`, for a test to supply as an input or to hold.
 */
async function findUtxo(
  wallet: HathorWallet,
  token: string,
  kind: string,
  value: bigint
): Promise<IUtxo> {
  const matches: IUtxo[] = [];
  for await (const utxo of wallet.storage.selectUtxos({ token, only_available_utxos: true })) {
    if (utxoKind(utxo) === kind && utxo.value === value) {
      matches.push(utxo);
    }
  }
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** Asserts that `attempt` fails with a SendTxError whose message is exactly `message`. */
async function expectSendTxError(attempt: Promise<unknown>, message: string): Promise<void> {
  await expect(attempt).rejects.toBeInstanceOf(SendTxError);
  await expect(attempt).rejects.toHaveProperty('message', message);
}

describe('shielded outputs — Group SP: Lone-output and structural-pass paths', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('SP.1 — an explicit change mode decides a send whose change would otherwise stand in: fully shielded custom and HTR changes beside an amount-shielded recipient', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(9n, []);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:9']);
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 4n, token: custom, shielded: AS },
      { address: await legacyAddr(recipient, 0), value: 3n, token: custom },
    ];
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // One amount-shielded and one public CUSTOM output, from a wallet with no shielded CUSTOM
    // UTXO: left to the rules, the CUSTOM change would be shielded in place of the missing
    // shielded input. An explicit changeShieldedMode decides every change of the send ahead of
    // any rule, so no change stands in: the CUSTOM change and the HTR change both take the
    // requested mode, and the recipient's output keeps its own. The CUSTOM change keeps its full
    // value, as the fee is HTR; the HTR change pays its own fee out of its value. The tx already
    // has three shielded outputs, so nothing is split. CUSTOM: 10 = 3 + 4 (sent) + 3 (change).
    //
    // 1. AMOUNT_SHIELDED, built but not broadcast: three amount-shielded outputs, fee 3.
    // HTR: 9 = 6 (change) + 3 (fee).
    const amountShielded = await prepareSend(wallet, outputs, { changeShieldedMode: AS });

    const amountShieldedShape = await describeBuiltTx(amountShielded.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(amountShieldedShape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:9']),
      outputs: ['recipient:CUSTOM:3'],
      shielded: sorted(['recipient:CUSTOM:AS:4', 'self:CUSTOM:AS:3', 'self:HTR:AS:6']),
      fee: 3n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // 2. FULLY_SHIELDED, broadcast: both changes fully shielded beside the amount-shielded
    // recipient, fee 1 + 2 + 2 = 5. HTR: 9 = 4 (change) + 5 (fee). Only the node checks the
    // surjection proofs of the two fully shielded changes, built over transparent inputs of two
    // tokens, beside an amount-shielded output of the same token as one of them.
    const { sendTx, txData } = await prepareSend(wallet, outputs, { changeShieldedMode: FS });

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:9']),
      outputs: ['recipient:CUSTOM:3'],
      shielded: sorted(['recipient:CUSTOM:AS:4', 'self:CUSTOM:FS:3', 'self:HTR:FS:4']),
      fee: FEE_PER_AMOUNT_SHIELDED_OUTPUT + 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:FS:3']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:4']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(wallet, custom)).toBe(3n);
    expect(await unlockedBalance(recipient, custom)).toBe(7n);
  });

  it('SP.2 — a fee-sized shielded HTR UTXO is spent whole on the fees: its change, too small for its own fee, pays the split of the custom output', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(0n, [
      { value: 2n, mode: AS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:2']);
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The CUSTOM 10 pays 6 + 4 exactly: a custom-token selection that matches exactly leaves no
    // change to stand in for the missing shielded input, so the 6 is the tx's only shielded
    // output. HTR enters only for its 1 fee, and the wallet's only HTR is the shielded 2. The
    // change of 1 mirrors that input (amount-shielded), cannot pay its own 1 fee, and there is
    // no other HTR to add to it. As the tx's only shielded output holds 2 units or more, it is
    // split next, and a change equal to the split fee is spent whole on it: 6 -> 3 + 3, and
    // nothing transparent is left. A fee-sized shielded HTR UTXO spent exactly on the fee
    // publishes its value, which the rules allow only where the alternative is failing the send.
    // HTR: 2 = 2 (fee). CUSTOM: 10 = 4 + 3 + 3 (sent). With no HTR output at all, the shielded
    // HTR input balances only through the blinding factors of the CUSTOM halves, a balance
    // across two tokens that only the node checks.
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 6n, token: custom, shielded: AS },
      { address: await legacyAddr(recipient, 0), value: 4n, token: custom },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:AS:2']),
      outputs: ['recipient:CUSTOM:4'],
      shielded: ['recipient:CUSTOM:AS:3', 'recipient:CUSTOM:AS:3'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('SP.3 — a lone shielded HTR output whose change equals its own fee is split, the change paying the split fee, in both modes', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 12n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:12']);
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    let htrBefore = await unlockedBalance(wallet, HTR);

    // 1. Every HTR output is shielded, so the HTR change is shielded in the output's mode. The
    // public 12 pays 10 + 1 (the output's fee) and leaves a change of 1, which equals its own
    // amount-shielded fee and so cannot fund it, and the wallet has no other HTR to add. The 10
    // is the tx's only shielded output and holds 2 units or more, so it is split next, and the
    // split's fee takes the whole change: no change output is left. 10 -> 5 + 5.
    // HTR: 12 = 5 + 5 (sent) + 2 (fee).
    const amountShielded = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: HTR, shielded: AS },
    ]);

    const amountShieldedShape = await describeBuiltTx(amountShielded.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(amountShieldedShape).toEqual({
      inputs: ['HTR:public:12'],
      outputs: [],
      shielded: ['recipient:HTR:AS:5', 'recipient:HTR:AS:5'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(amountShielded.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(10n + amountShieldedShape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(10n);

    // 2. The same send fully shielded: the public 14 pays 10 + 2 and leaves a change of 2, its
    // own fully shielded fee, with no other HTR to add; the split takes it whole.
    // HTR: 14 = 5 + 5 (sent) + 4 (fee). Only the node exact-matches these fees of 2 and 4.
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 14n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:14']);
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    htrBefore = await unlockedBalance(wallet, HTR);
    const fullyShielded = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 1), value: 10n, token: HTR, shielded: FS },
    ]);

    const fullyShieldedShape = await describeBuiltTx(fullyShielded.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(fullyShieldedShape).toEqual({
      inputs: ['HTR:public:14'],
      outputs: [],
      shielded: ['recipient:HTR:FS:5', 'recipient:HTR:FS:5'],
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(fullyShielded.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(10n + fullyShieldedShape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(20n);
  });

  it("SP.4 — a 1-unit fully shielded output's second output: an HTR change topped up from fully shielded HTR mirrors it, one from transparent HTR is amount-shielded", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const nftResponse = await createTokenHelper(funder, 'Shape NFT', 'SNF', 2n, {
      address: await legacyAddr(funder, 1),
    });
    const nft: string = nftResponse.hash;
    // Both units in one tx, as two 1-unit UTXOs: one for each send below.
    await fund(funder, wallet, [
      { address: await legacyAddr(wallet, 0), value: 1n, token: nft },
      { address: await legacyAddr(wallet, 1), value: 1n, token: nft },
    ]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 2), 3n);
    await fundShielded(funder, wallet, HTR, [{ value: 5n, mode: FS }]);
    const labels: TokenLabels = { [HTR]: 'HTR', [nft]: 'NFT' };
    expect(await poolOf(wallet, nft, 'NFT')).toEqual(['NFT:public:1', 'NFT:public:1']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:3', 'HTR:FS:5']));
    let utxosBefore = await snapshotUtxos(wallet, labels);
    let htrBefore = await unlockedBalance(wallet, HTR);

    // 1. One unit is spent exactly, so its 1-unit output is the tx's only shielded output, and it
    // cannot be split: the HTR change becomes the second shielded output. HTR enters only for
    // the output's fully shielded fee (2): the public 3 pays it and leaves a change of 1, too
    // small for its own fee, so HTR is pulled into it, transparent first and fully shielded
    // UTXOs last. Only the fully shielded 5 is left, so the change mirrors it, fully shielded,
    // and the pull stops once the change exceeds the fully shielded fee: 1 + 5 - 2 = 4.
    // HTR: 3 + 5 = 4 (change) + 4 (fee). The node checks the surjection proofs of the fully
    // shielded 1-unit output and of the fully shielded change built from a fully shielded input.
    const first = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 1n, token: nft, shielded: FS },
    ]);

    const firstShape = await describeBuiltTx(first.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(firstShape).toEqual({
      inputs: sorted(['NFT:public:1', 'HTR:public:3', 'HTR:FS:5']),
      outputs: [],
      shielded: sorted(['recipient:NFT:FS:1', 'self:HTR:FS:4']),
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    await broadcast(first.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:4']);
    expect(await poolOf(wallet, nft, 'NFT')).toEqual(['NFT:public:1']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(firstShape.fee);
    expect(await unlockedBalance(recipient, nft)).toBe(1n);

    // 2. With public HTR again, the public 10 pays the 2 fee and leaves 8, which pays its own
    // fee, so nothing is pulled. The rules leave the HTR change transparent and no shielded HTR
    // is spent, so the second output takes the amount-shielded mode: 8 - 1 = 7. The fully
    // shielded 4 stays. HTR: 10 = 7 (change) + 3 (fee).
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 3), 10n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:FS:4', 'HTR:public:10']));
    utxosBefore = await snapshotUtxos(wallet, labels);
    htrBefore = await unlockedBalance(wallet, HTR);
    const second = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 1), value: 1n, token: nft, shielded: FS },
    ]);

    const secondShape = await describeBuiltTx(second.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(secondShape).toEqual({
      inputs: sorted(['NFT:public:1', 'HTR:public:10']),
      outputs: [],
      shielded: sorted(['recipient:NFT:FS:1', 'self:HTR:AS:7']),
      fee: FEE_PER_FULL_SHIELDED_OUTPUT + FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(second.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, nft, 'NFT')).toEqual([]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:FS:4', 'HTR:AS:7']));
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(secondShape.fee);
    expect(await unlockedBalance(recipient, nft)).toBe(2n);
  });

  it('SP.5 — a transparent HTR change short of the fully shielded split fee is topped up from shielded HTR into a cheaper amount-shielded change', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(3n, [
      { value: 5n, mode: AS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:3', 'HTR:AS:5']));
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // CUSTOM matches exactly, so the recipient's output is the only shielded output. The public 3
    // pays its fully shielded fee (2) and leaves a transparent HTR change of 1, one short of the
    // split's 2. The missing 1 is pulled, transparent first; no public HTR is left, so the pull
    // spends the shielded 5. A pull that spent shielded HTR becomes a shielded change instead of
    // the split when it pays its own fee: the change of 1 and the pulled 5 make an HTR change,
    // amount-shielded like the pulled input, whose 1 fee is less than the split's 2. It is the
    // second shielded output, and the recipient's output stays whole: 1 + 5 - 1 = 5.
    // HTR: 3 + 5 = 5 (change) + 3 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: FS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:3', 'HTR:AS:5']),
      outputs: [],
      shielded: sorted(['recipient:CUSTOM:FS:10', 'self:HTR:AS:5']),
      fee: FEE_PER_FULL_SHIELDED_OUTPUT + FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:5']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('SP.6 — a shielded split-fee pull that would land exactly on the fee keeps pulling until it funds a shielded change, which a legacy changeAddress cannot receive', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(1n, [
      { value: 1n, mode: AS },
      { value: 7n, mode: AS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:1', 'HTR:AS:1', 'HTR:AS:7'])
    );
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: AS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // 1. CUSTOM matches exactly and the public 1 pays the recipient's fee exactly, so the split
    // fee of 1 must be pulled, and no public HTR is left. The shielded 1 alone would land on it
    // exactly, and spent whole on the public fee its value would be revealed by subtraction. So,
    // for a lone output of another token, a pull that spends shielded HTR goes on until it can
    // fund a shielded change of its own: it takes the 7 too, and the change it makes must be
    // shielded, as a transparent change never carries the value of a shielded input. A legacy
    // changeAddress fails wherever the rules shield a change, this one included, so the send
    // fails before anything is broadcast.
    await expectSendTxError(
      wallet.sendManyOutputsTransaction(outputs, { changeAddress: await legacyAddr(wallet, 5) }),
      "The change must be shielded (all of its token's outputs are shielded, or the transaction " +
        'spends a shielded UTXO), and a legacy change address cannot receive it. Use a ' +
        'new-format change address, or changeShieldedMode: OutputKind.TRANSPARENT to keep the ' +
        'change transparent.'
    );

    // Nothing was broadcast and nothing stays selected: the same UTXOs are still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, labels);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));

    // 2. With no change address, the pulled 1 + 7 become the HTR change, amount-shielded like
    // the pulled inputs, which pays its own 1 fee and is the second shielded output, so the
    // recipient's output stays whole: 8 - 1 = 7. The node accepts it as the change of two
    // amount-shielded inputs. HTR: 1 + 1 + 7 = 7 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, outputs);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:1', 'HTR:AS:1', 'HTR:AS:7']),
      outputs: [],
      shielded: sorted(['recipient:CUSTOM:AS:10', 'self:HTR:AS:7']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:7']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('SP.7 — with the change pinned transparent, the split fee comes from transparent HTR first and the shielded UTXO stays', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [
      { value: 11n, mode: AS },
      { value: 5n, mode: AS },
    ]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 4n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:AS:11', 'HTR:AS:5', 'HTR:public:4'])
    );
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: HTR, shielded: AS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // 1. Left to the rules, built but not broadcast: every HTR output is shielded, so the
    // shielded pool comes first, and its 11 pays 10 + 1 (the output's fee) exactly. The split
    // fee is pulled from the shielded pool first too, smallest first: the shielded 5. Its
    // surplus cannot be a transparent change (it is shielded value), and the rules shield the
    // HTR change anyway: everything pulled becomes an amount-shielded change, which pays its own
    // fee and is the second shielded output: 5 - 1 = 4.
    // HTR: 11 + 5 = 10 (sent) + 4 (change) + 2 (fee).
    const byRules = await prepareSend(wallet, outputs);

    const byRulesShape = await describeBuiltTx(byRules.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(byRulesShape).toEqual({
      inputs: sorted(['HTR:AS:11', 'HTR:AS:5']),
      outputs: [],
      shielded: sorted(['recipient:HTR:AS:10', 'self:HTR:AS:4']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // 2. With the change pinned transparent, the change can never be the second output, and a
    // change pinned transparent pulls from the transparent pool first, so it unshields no more
    // than it must: the split fee comes from the public 4, not the shielded 5. Its surplus stays
    // a transparent change, and the 10 is split: 10 -> 5 + 5. The shielded 5 is never moved into
    // the public change. HTR: 11 + 4 = 10 (sent) + 3 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:AS:11', 'HTR:public:4']),
      outputs: ['self:HTR:3'],
      shielded: ['recipient:HTR:AS:5', 'recipient:HTR:AS:5'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:AS:5', 'HTR:public:3']));
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(10n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(10n);
  });

  it('SP.8 — UTXOs another send holds are invisible: the availability probe ignores a held shielded UTXO, so the change stands in, and the pull skips a held transparent one', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 17n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 1n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 2), 3n);
    const funder = await startFunder();
    await fundShielded(funder, wallet, HTR, [{ value: 9n, mode: AS }]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:17', 'HTR:public:1', 'HTR:public:3', 'HTR:AS:9'])
    );
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: AS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // 1. Nothing held, built but not broadcast: one public and one amount-shielded HTR output,
    // and the wallet holds a shielded HTR UTXO, so the rules force the smallest one in, the
    // shielded 9, and the public 17 pays the rest. A shielded input was spent, so the change is
    // shielded, in the mode of the shielded output: 9 + 17 - 17 = 9, minus its 1 fee = 8.
    // HTR: 9 + 17 = 5 + 11 (sent) + 8 (change) + 2 (fee).
    const free = await prepareSend(wallet, outputs);

    const freeShape = await describeBuiltTx(free.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(freeShape).toEqual({
      inputs: sorted(['HTR:AS:9', 'HTR:public:17']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:11', 'self:HTR:AS:8']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // 2. The shielded 9 and the public 1 are now held, as a send in flight holds its inputs, and
    // only available UTXOs are ever taken. The probe for a shielded HTR UTXO finds none, so no
    // shielded input is forced: the HTR change stands in for it instead. The public 17 pays
    // 5 + 11 + 1 exactly, leaving no change, so HTR is pulled, smallest first, until a change
    // pays its own fee: the pull skips the held 1 and takes the 3, and the change, amount-shielded
    // like the output, is the second shielded output: 3 - 1 = 2.
    // HTR: 17 + 3 = 5 + 11 (sent) + 2 (change) + 2 (fee).
    const heldShielded = await findUtxo(wallet, HTR, 'AS', 9n);
    const heldPublic = await findUtxo(wallet, HTR, 'public', 1n);
    await wallet.markUtxoSelected(heldShielded.txId, heldShielded.index, true);
    await wallet.markUtxoSelected(heldPublic.txId, heldPublic.index, true);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:17', 'HTR:public:3']));

    const { sendTx, txData } = await prepareSend(wallet, outputs);

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
    await wallet.markUtxoSelected(heldShielded.txId, heldShielded.index, false);
    await wallet.markUtxoSelected(heldPublic.txId, heldPublic.index, false);

    // Released, both held UTXOs are spendable again, untouched.
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:1', 'HTR:AS:9', 'HTR:AS:2'])
    );
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it("SP.9 — a 1-unit output paid with caller-supplied HTR takes the caller's change as its second output, and fails when that HTR leaves too little", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const nftResponse = await createTokenHelper(funder, 'Shape NFT', 'SNF', 1n, {
      address: await legacyAddr(funder, 1),
    });
    const nft: string = nftResponse.hash;
    await fund(funder, wallet, [{ address: await legacyAddr(wallet, 0), value: 1n, token: nft }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 2n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 2), 10n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 3), 7n);
    const labels: TokenLabels = { [HTR]: 'HTR', [nft]: 'NFT' };
    expect(await poolOf(wallet, nft, 'NFT')).toEqual(['NFT:public:1']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:2', 'HTR:public:10', 'HTR:public:7'])
    );
    const callerTwo = await findUtxo(wallet, HTR, 'public', 2n);
    const callerTen = await findUtxo(wallet, HTR, 'public', 10n);
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 1n, token: nft, shielded: AS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // 1. The caller supplies the HTR, so the wallet selects only the NFT and never adds HTR of
    // its own. The NFT's 1-unit output is the tx's only shielded output and cannot be split, so
    // the change of the caller's HTR must be the second shielded output. The caller's 2 pays the
    // output's 1 fee and leaves a change of 1, too small for its own 1 fee, and no HTR can be
    // added to it: the send fails before broadcast.
    await expectSendTxError(
      wallet.sendManyOutputsTransaction(outputs, {
        inputs: [{ txId: callerTwo.txId, index: callerTwo.index, token: HTR }],
      }),
      "The transaction's only shielded output holds 1 unit, too little to split into the two " +
        'shielded outputs the protocol requires, and the HTR inputs were user-supplied, so no ' +
        'HTR can be selected for a shielded change.'
    );

    // Nothing was broadcast and nothing stays selected: the same UTXOs are still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, labels);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));

    // 2. The caller's 10 pays the output's 1 fee and leaves 9, which pays its own fee: the
    // change of the caller's input is the second shielded output, amount-shielded, with no pull,
    // 9 - 1 = 8. The wallet selects the NFT itself; the 2 and the 7 are untouched.
    // HTR: 10 = 8 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      inputs: [{ txId: callerTen.txId, index: callerTen.index, token: HTR }],
    });

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['NFT:public:1', 'HTR:public:10']),
      outputs: [],
      shielded: sorted(['recipient:NFT:AS:1', 'self:HTR:AS:8']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:2', 'HTR:public:7', 'HTR:AS:8'])
    );
    expect(await poolOf(wallet, nft, 'NFT')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, nft)).toBe(1n);
  });

  it('SP.10 — an exact split-fee pull for a fully shielded output becomes a pinned amount-shielded change when that costs less', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 12n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 2n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:12', 'HTR:public:2']));
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The public 12 pays 10 + 2 (the output's fully shielded fee) exactly, so the split fee of 2
    // is pulled, and the public 2 lands on it exactly. On an exact landing the pull becomes the
    // change, in place of the split, only when the change's own fee is the smaller one: as the
    // amount-shielded change the caller pinned, it pays 1 instead of the split's 2 and keeps 1.
    // The pinned mode, not the recipient's, decides the change's mode, and no shielded pull is
    // involved. The recipient's output stays whole. HTR: 12 + 2 = 10 (sent) + 1 (change) +
    // 3 (fee).
    const { sendTx, txData } = await prepareSend(
      wallet,
      [{ address: await shieldedAddr(recipient, 0), value: 10n, token: HTR, shielded: FS }],
      { changeShieldedMode: AS }
    );

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:12', 'HTR:public:2']),
      outputs: [],
      shielded: sorted(['recipient:HTR:FS:10', 'self:HTR:AS:1']),
      fee: FEE_PER_FULL_SHIELDED_OUTPUT + FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:1']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(10n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(10n);
  });
});
