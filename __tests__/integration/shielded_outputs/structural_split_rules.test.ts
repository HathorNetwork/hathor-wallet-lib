/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group W — Structural minimum: a transaction is never left with exactly one shielded output.
 *
 * A lone shielded output carries a random blinding factor and cannot balance (the wallet
 * computes the balancing factor for the last of at least two shielded outputs), and the
 * fullnode rejects such a tx (TrivialCommitmentError). The wallet therefore either splits
 * the lone output into two halves, paying one more shielded-output fee (the split fee), or
 * ends with a shielded HTR change as the second shielded output. Every scenario here sends a
 * single amount- or fully-shielded custom-token output while HTR enters only to pay fees, so
 * the HTR pool alone decides which of the two happens:
 *
 * - W.1: the split fee is pulled from a shielded 7, and that 7 funds a shielded change of its
 *   own, so the change is the second output and the recipient's output stays whole.
 * - W.2: a shielded 2 lands exactly on the fully-shielded split fee; an amount-shielded change
 *   costs less (1 vs 2), so it replaces the split.
 * - W.3: no pull can fund a shielded change (a single shielded 1 never exceeds its own change
 *   fee, and both together make a fully-shielded 2, not above its 2 fee), so the split fee is
 *   paid exactly, with the amount-shielded 1, and the recipient's output is split.
 * - W.4: the only pull is a fully-shielded 2 that leaves 1 over: that 1 can be neither a
 *   transparent change (it is shielded value) nor a fully-shielded change (fee 2), so the
 *   send fails before broadcast instead of downgrading.
 * - W.5: a transparent HTR change of 1 is short of the fully-shielded split fee by 1, and the
 *   shielded 1 pulled to cover it funds, together with that change, an amount-shielded change
 *   that costs less than the split.
 * - W.6: a 1-unit output (one NFT) cannot be split at all, so the HTR change becomes the
 *   second shielded output.
 *
 * Node acceptance proves the declared fee matches the node's exact computation and that the
 * shielded outputs balance.
 *
 * Funding keeps the test wallet's pool exact: the custom token's public 10 comes from a funder
 * in its own tx, the shielded HTR in another (a single wallet output is paired with one to the
 * funder's own shielded address, so the wallet does not split it into two halves), with the
 * funder's change pinned transparent, and the public HTR from the genesis wallet.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { createTokenHelper, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import {
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
  TokenLabels,
  unlockedBalance,
} from '../helpers/shielded-send.helper';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
  NATIVE_TOKEN_UID,
} from '../../../src/constants';
import { ProposedOutput } from '../../../src/new/types';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const FS = ShieldedOutputMode.FULLY_SHIELDED;
const HTR = NATIVE_TOKEN_UID;

describe('shielded outputs — Group W: Structural minimum for a lone shielded output', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('W.1 — a split fee pulled from shielded HTR becomes a shielded HTR change, the recipient stays whole', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(1n, [
      { value: 7n, mode: AS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:1', 'HTR:AS:7']));
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // CUSTOM matches exactly, so the recipient's output is the only shielded output. The
    // public 1 pays its fee exactly; the second shielded output's fee must be pulled, and no
    // public HTR is left, so the pull takes the shielded 7. Its remainder cannot surface as a
    // transparent change, and 7 funds a shielded change of its own (7 > 1): the HTR change,
    // amount-shielded like the input, is the second shielded output and nothing is split.
    // HTR: 1 + 7 = 6 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:1', 'HTR:AS:7']),
      outputs: [],
      shielded: sorted(['recipient:CUSTOM:AS:10', 'self:HTR:AS:6']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:6']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('W.2 — an exact split-fee pull becomes a cheaper amount-shielded change for a fully-shielded send', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(2n, [
      { value: 2n, mode: AS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:2', 'HTR:AS:2']));
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The public 2 pays the recipient's fully-shielded fee exactly. The split would cost
    // another 2, and the shielded 2 lands on it exactly; spent that way it would be revealed
    // by subtraction. As an amount-shielded change it pays a 1 fee and keeps 1, which is the
    // cheaper resolution: the change is the second shielded output and the recipient's
    // output is not split. HTR: 2 + 2 = 1 (change) + 3 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: FS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:2', 'HTR:AS:2']),
      outputs: [],
      shielded: sorted(['recipient:CUSTOM:FS:10', 'self:HTR:AS:1']),
      fee: FEE_PER_FULL_SHIELDED_OUTPUT + FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:1']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('W.3 — when no pull can fund a shielded change, the split fee is paid exactly and the recipient is split', async () => {
    const { wallet, recipient, funder, custom, labels } = await setupCustomTokenWallet(1n, [
      { value: 1n, mode: AS },
    ]);
    // The fully-shielded 1 arrives in a later tx than the amount-shielded 1, so the wallet's
    // store keeps these two equal values in a fixed order.
    await fundShielded(funder, wallet, HTR, [{ value: 1n, mode: FS }], 1);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:1', 'HTR:AS:1', 'HTR:FS:1'])
    );
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The public 1 pays the recipient's fee exactly and the 1 split fee needs a pull. A
    // single shielded 1 never exceeds its own change fee (1 amount-shielded, 2 fully
    // shielded), and both together make a fully-shielded 2, not above its 2 fee: no pull
    // funds a shielded change. The send then pulls exactly the split fee and splits the
    // recipient's 10 into 5 + 5. The pull spends the amount-shielded 1 and the fully-shielded
    // 1 stays: spent on a fee, it would reveal its token as well as its amount.
    // HTR: 1 + 1 = 2 (fee), no HTR change.
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:1', 'HTR:AS:1']),
      outputs: [],
      shielded: ['recipient:CUSTOM:AS:5', 'recipient:CUSTOM:AS:5'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:1']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('W.4 — a fully-shielded pull too small for its own change fails before broadcast and leaves the UTXOs usable', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(1n, [
      { value: 2n, mode: FS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:1', 'HTR:FS:2']));
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: AS },
    ];

    // The public 1 pays the recipient's fee exactly and the 1 split fee is pulled from the
    // fully-shielded 2, leaving 1 over. That 1 is shielded value, so it cannot be a
    // transparent change; a change mirroring the fully-shielded input owes a 2 fee it cannot
    // fund; it is never downgraded to amount-shielded; and there is no other HTR to pull.
    await expect(wallet.sendManyOutputsTransaction(outputs)).rejects.toThrow(
      /HTR change is too small to fund its shielded-output fee and no additional HTR is available/
    );

    // Nothing was broadcast and nothing stays selected: the same UTXOs are still spendable.
    const utxosAfterFailure = await snapshotUtxos(wallet, labels);
    expect(sorted([...utxosAfterFailure.keys()])).toEqual(sorted([...utxosBefore.keys()]));
    expect(sorted([...utxosAfterFailure.values()])).toEqual(sorted([...utxosBefore.values()]));
    expect(await unlockedBalance(wallet, HTR)).toBe(3n);
    expect(await unlockedBalance(wallet, custom)).toBe(10n);

    // With more public HTR the same send fits: the split fee comes from the public 5 (public
    // first; its 4 remainder stays a transparent change, no shielded value involved) and the
    // recipient's 10 is split into 5 + 5. HTR: 1 + 5 = 4 (change) + 2 (fee).
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 2), 5n);
    const utxosBeforeRetry = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs);

    const shape = await describeBuiltTx(txData, utxosBeforeRetry, {
      sender: wallet,
      recipient,
      labels,
    });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:1', 'HTR:public:5']),
      outputs: ['self:HTR:4'],
      shielded: ['recipient:CUSTOM:AS:5', 'recipient:CUSTOM:AS:5'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:FS:2', 'HTR:public:4']));
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('W.5 — a transparent HTR change short of the split fee is topped up into a cheaper shielded change', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(3n, [
      { value: 1n, mode: AS },
    ]);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:3', 'HTR:AS:1']));
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The public 3 pays the recipient's fully-shielded fee (2) and leaves a transparent HTR
    // change of 1. The split would owe another 2, one more than that change holds, so 1 is
    // pulled: the shielded 1. Spent on the fee it would be revealed by subtraction. Together
    // with the change it makes 2, which funds an amount-shielded change (fee 1, cheaper than
    // the split's 2): the change, amount-shielded like the pulled input, is the second
    // shielded output and the recipient's output stays whole.
    // HTR: 3 + 1 = 1 (change) + 3 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: custom, shielded: FS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:3', 'HTR:AS:1']),
      outputs: [],
      shielded: sorted(['recipient:CUSTOM:FS:10', 'self:HTR:AS:1']),
      fee: FEE_PER_FULL_SHIELDED_OUTPUT + FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:1']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('W.6 — a 1-unit output cannot be split, so the HTR change becomes the second shielded output', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const nftResponse = await createTokenHelper(funder, 'Shape NFT', 'SNF', 1n, {
      address: await legacyAddr(funder, 1),
    });
    const nft: string = nftResponse.hash;
    await fund(funder, wallet, [{ address: await legacyAddr(wallet, 0), value: 1n, token: nft }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 10n);
    const labels: TokenLabels = { [HTR]: 'HTR', [nft]: 'NFT' };
    expect(await poolOf(wallet, nft, 'NFT')).toEqual(['NFT:public:1']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // The NFT is spent exactly, so its 1-unit output is the only shielded output, and it
    // cannot be split in two. The HTR change, 10 - 1 (the output's fee) = 9, is shielded
    // instead as the second output: 9 - 1 (its own fee) = 8. HTR: 10 = 8 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 1n, token: nft, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['NFT:public:1', 'HTR:public:10']),
      outputs: [],
      shielded: sorted(['recipient:NFT:AS:1', 'self:HTR:AS:8']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:8']);
    expect(await poolOf(wallet, nft, 'NFT')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, nft)).toBe(1n);
  });
});
