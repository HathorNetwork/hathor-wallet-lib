/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group T — FEE-token fees when the token's inputs are shielded.
 *
 * The fullnode charges a FEE-version token FEE_PER_OUTPUT for each of its transparent outputs,
 * or one flat FEE_PER_OUTPUT (the melt charge) when the token has transparent inputs and no
 * transparent outputs. Shielded inputs count toward neither: their value, and for fully
 * shielded outputs their token, is hidden in commitments. The node compares the declared
 * FeeHeader with that computation for an EXACT match, so a wallet that counted shielded inputs
 * would declare one FEE_PER_OUTPUT too many on an all-shielded spend and the tx would be
 * rejected. Only a real node runs that exact-match check and the balance verification over
 * shielded inputs, which is why these scenarios run against the shielded network.
 *
 * - T.1 spends shielded-only inputs of a FEE token into shielded outputs: the fee is the
 *   shielded-output fees alone. The tx that funds T.1 and T.2 is its transparent counterpart:
 *   the funder spends a transparent input of the token into shielded outputs only and owes the
 *   melt charge.
 * - T.2 spends the same kind of inputs into a transparent output: that output still costs
 *   FEE_PER_OUTPUT whatever its inputs are, and the token change, which the rules shield
 *   because shielded inputs were spent, costs the shielded-output fees.
 * - T.3 spends one shielded and one transparent input of the token into shielded outputs: the
 *   transparent input owes the melt charge, and only the shielded input is flagged as shielded
 *   for fee accounting.
 *
 * In T.1 and T.2 the test wallet never holds a transparent unit of the token: a separate funder
 * creates it and sends the whole supply to the test wallet as two amount-shielded outputs. The
 * test wallet's HTR comes from the genesis wallet in a separate tx.
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
  shieldedAddr,
  snapshotUtxos,
  sorted,
  startFunder,
  unlockedBalance,
} from '../helpers/shielded-send.helper';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_OUTPUT,
  NATIVE_TOKEN_UID,
} from '../../../src/constants';
import HathorWallet from '../../../src/new/wallet';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { TokenVersion } from '../../../src/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const HTR = NATIVE_TOKEN_UID;

/**
 * A test wallet holding exactly two amount-shielded UTXOs of a FEE token (60 + 40, the whole
 * supply) and one transparent 10 HTR UTXO, plus a fresh recipient.
 */
async function setupShieldedFeeTokenWallet(): Promise<{
  wallet: HathorWallet;
  recipient: HathorWallet;
  fbt: string;
  labels: TokenLabels;
}> {
  const wallet = await generateWalletHelper();
  const recipient = await generateWalletHelper();
  const funder = await startFunder();

  const tokenResponse = await createTokenHelper(funder, 'Shielded Input Fee', 'SIF', 100n, {
    address: await legacyAddr(funder, 1),
    tokenVersion: TokenVersion.FEE,
  });
  const fbt: string = tokenResponse.hash;

  // The whole supply in two shielded outputs: an exact match, so the funder keeps no FBT
  // change, and HTR enters only to pay fees, from public HTR, so its change stays
  // transparent. The funder's transparent FBT input meets no transparent FBT output, so FBT
  // owes the melt charge on top of the two shielded fees.
  const funderHtrBefore = await unlockedBalance(funder, HTR);
  await fund(funder, wallet, [
    { address: await shieldedAddr(wallet, 0), value: 60n, token: fbt, shielded: AS },
    { address: await shieldedAddr(wallet, 1), value: 40n, token: fbt, shielded: AS },
  ]);
  expect(funderHtrBefore - (await unlockedBalance(funder, HTR))).toBe(
    FEE_PER_OUTPUT + 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT
  );
  await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 10n);

  expect(await poolOf(wallet, fbt, 'FBT')).toEqual(sorted(['FBT:AS:60', 'FBT:AS:40']));
  expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
  // The wallet only received the token: its FEE version comes from the fullnode's token API
  // and is what makes the wallet charge FEE_PER_OUTPUT at all.
  expect((await wallet.getBalance(fbt))[0].token.version).toBe(TokenVersion.FEE);

  return { wallet, recipient, fbt, labels: { [HTR]: 'HTR', [fbt]: 'FBT' } };
}

describe('shielded outputs — Group T: FEE-token fees with shielded inputs', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('T.1 — shielded-only FEE-token inputs into shielded outputs pay only the shielded fees', async () => {
    const { wallet, recipient, fbt, labels } = await setupShieldedFeeTokenWallet();
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // All FBT outputs are shielded, so selection draws from the shielded pool: 60 + 40 match
    // the 100 sent exactly and there is no FBT change. FBT has no transparent input and no
    // transparent output, so it owes neither FEE_PER_OUTPUT nor the melt charge. HTR pays only
    // the two amount-shielded output fees, from the public 10: 10 = 8 (change) + 2 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 70n, token: fbt, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 30n, token: fbt, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['FBT:AS:60', 'FBT:AS:40', 'HTR:public:10']),
      outputs: ['self:HTR:8'],
      shielded: sorted(['recipient:FBT:AS:70', 'recipient:FBT:AS:30']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    // The spent FBT UTXOs reach fee accounting flagged as shielded inputs.
    const fbtInputFlags = txData.inputs.filter(input => input.token === fbt).map(i => i.shielded);
    expect(fbtInputFlags).toEqual([true, true]);

    // The node exact-matches the FeeHeader: accepting the tx confirms it also charged nothing
    // for the shielded-only FBT inputs.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, fbt, 'FBT')).toEqual([]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:8']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(wallet, fbt)).toBe(0n);
    expect(await unlockedBalance(recipient, fbt)).toBe(100n);
  });

  it('T.2 — shielded-only FEE-token inputs into a transparent output pay FEE_PER_OUTPUT for it', async () => {
    const { wallet, recipient, fbt, labels } = await setupShieldedFeeTokenWallet();
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // All FBT outputs are public and the wallet holds no public FBT, so the shielded pool tops
    // up: 60 + 40 cover the 70, leaving a 30 change. A spent shielded input shields the change,
    // mirroring the inputs (amount-shielded); as the tx's only shielded output it is split into
    // 15 + 15, the split's fee shaved from the transparent HTR change.
    // Fee: FEE_PER_OUTPUT for the transparent FBT output (charged whatever its inputs are) +
    // two amount-shielded outputs. HTR: 10 = 7 (change) + 3 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await legacyAddr(recipient, 0), value: 70n, token: fbt },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['FBT:AS:60', 'FBT:AS:40', 'HTR:public:10']),
      outputs: sorted(['recipient:FBT:70', 'self:HTR:7']),
      shielded: ['self:FBT:AS:15', 'self:FBT:AS:15'],
      fee: FEE_PER_OUTPUT + 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    // A full unshield would carry an excess instead of shielded outputs; this tx keeps some.
    expect(txData.excessBlindingFactor).toBeUndefined();

    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, fbt, 'FBT')).toEqual(['FBT:AS:15', 'FBT:AS:15']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:7']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(wallet, fbt)).toBe(30n);
    expect(await unlockedBalance(recipient, fbt)).toBe(70n);
  });

  it('T.3 — next to a shielded FEE-token input, a transparent one still owes the melt charge', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const tokenResponse = await createTokenHelper(funder, 'Mixed Input Fee', 'MIF', 140n, {
      address: await legacyAddr(funder, 1),
      tokenVersion: TokenVersion.FEE,
    });
    const fbt: string = tokenResponse.hash;
    const labels: TokenLabels = { [HTR]: 'HTR', [fbt]: 'FBT' };
    // The shielded 60 and the transparent 40 arrive in separate txs; HTR from the genesis wallet.
    await fundShielded(funder, wallet, fbt, [{ value: 60n, mode: AS }]);
    await fund(funder, wallet, [{ address: await legacyAddr(wallet, 0), value: 40n, token: fbt }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 10n);
    expect(await poolOf(wallet, fbt, 'FBT')).toEqual(sorted(['FBT:AS:60', 'FBT:public:40']));
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // All FBT outputs are shielded: the shielded 60 is spent whole and the public 40 tops it up
    // to the 100 sent, an exact match with no FBT change. FBT now has a transparent input and
    // no transparent output, so it owes the melt charge; the shielded 60 adds nothing to it.
    // HTR: 10 = 7 (change) + 3 (fee).
    const { sendTx, txData } = await prepareSend(wallet, [
      { address: await shieldedAddr(recipient, 0), value: 70n, token: fbt, shielded: AS },
      { address: await shieldedAddr(recipient, 1), value: 30n, token: fbt, shielded: AS },
    ]);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['FBT:AS:60', 'FBT:public:40', 'HTR:public:10']),
      outputs: ['self:HTR:7'],
      shielded: sorted(['recipient:FBT:AS:70', 'recipient:FBT:AS:30']),
      fee: FEE_PER_OUTPUT + 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    // Only the shielded FBT input reaches fee accounting flagged as shielded.
    const fbtInputFlags = txData.inputs
      .filter(input => input.token === fbt)
      .map(
        input => `${utxosBefore.get(`${input.txId}:${input.index}`)}:${input.shielded === true}`
      );
    expect(sorted(fbtInputFlags)).toEqual(sorted(['FBT:AS:60:true', 'FBT:public:40:false']));

    // Accepting the tx confirms the node also charged the melt fee for the transparent input
    // and nothing for the shielded one.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, fbt, 'FBT')).toEqual([]);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:7']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(recipient, fbt)).toBe(100n);
  });
});
