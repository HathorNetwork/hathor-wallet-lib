/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group Z — The change that stands in for a missing shielded input.
 *
 * A mixed send with exactly one shielded output of a token wants a shielded input of that token
 * to hide the output's amount among. When the wallet holds no available shielded UTXO of the
 * token (or, for a token the caller supplies inputs of, the caller supplied no shielded one),
 * only transparent inputs are spent, and a transparent change would publish the output's amount
 * by subtraction. The token's change is shielded instead, in the most private mode of the token's
 * shielded outputs, so the output and the change are two hidden values. That change is never
 * skipped: it is shielded, or the send fails before broadcast. The send checks, in this order:
 *
 *   1. the wallet can receive a shielded change: it is not a multisig wallet, whose shielded
 *      addresses would be single-signature, and it has a shielded address. Otherwise the send
 *      fails with ShieldedChangeUnavailableError, before any other check, as no change address
 *      would help;
 *   2. the transaction has fewer than 32 shielded outputs, leaving room for the change;
 *   3. for HTR, the change pays its own shielded-output fee: HTR is pulled, smallest-first with
 *      fully shielded UTXOs last, until it does, and when the HTR selection leaves no change at
 *      all, HTR is pulled to make one, whatever other shielded outputs the transaction has. HTR
 *      is never added to caller-supplied HTR inputs;
 *   4. the change address is not a legacy one, checked only once the change pays its fee.
 *
 * The lone HTR output whose change stands in is never split, since its two halves would add up
 * to its amount: the change is its second shielded output, or the send fails. Each refusal ends
 * by suggesting changeShieldedMode: OutputKind.TRANSPARENT, unless the send is known to fail that
 * way too: the only shielded output the caller asked for holds 1 unit and cannot be split, or the
 * HTR left, with the fees the other changes stop paying once transparent, cannot pay the fee of
 * splitting that output.
 *
 * - Z.1: with no HTR change, HTR is pulled past an exact landing on the split's fee until the
 *   change pays its own fee, and the HTR output stays whole.
 * - Z.2: a fully shielded output's change below its own fee takes more HTR and stays fully
 *   shielded; with no HTR to add the send fails, and the error does not suggest a transparent
 *   change, which could not pay for the split either.
 * - Z.3: a legacy changeAddress is checked last: with an explicit shielded mode it fails up
 *   front, a change that cannot pay its fee fails for that first, a funded one fails for the
 *   address, and an own new-format changeAddress hosts the change.
 * - Z.4: a wallet with no shielded address (an xpub wallet with an external signer) cannot
 *   receive the change; pinned transparent, it pays the shielded recipient with a split.
 * - Z.5: a multisig wallet cannot receive the change; pinned transparent, its P2SH change and the
 *   recipient's split go through the multisig proposal flow and are accepted by the node.
 * - Z.6: beside other shielded outputs, an HTR send that leaves no change fails while the wallet
 *   has no HTR to add, then takes a fully shielded change made of new HTR.
 * - Z.7: the error suggests a transparent change only where it would build: beside another
 *   token's shielded change, the fee that change frees decides.
 * - Z.8: a 1-unit HTR output is never split: with HTR to add, the change is its second output,
 *   and no error suggests a transparent change.
 * - Z.9: with caller-supplied HTR, the change is shielded with nothing added, and a change too
 *   small for its fee fails rather than take the wallet's HTR.
 * - Z.10: a FEE token's change is shielded and owes its shielded-output fee instead of
 *   FEE_PER_OUTPUT.
 * - Z.11: at 32 shielded outputs the change fails for the limit, before a legacy changeAddress.
 *
 * These run against a real node because every shape built must also be accepted: the node
 * exact-matches the FeeHeader, verifies the balance of the shielded commitments and the
 * surjection proofs of fully shielded outputs, and rejects a tx with exactly one shielded output.
 * The refusals never reach the node; each test shows they leave the UTXOs it funded spendable.
 *
 * Funding keeps each test wallet's pool exact: public HTR comes from the genesis wallet, one UTXO
 * per injectFunds call, and custom tokens and shielded UTXOs come from a funder in their own txs.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  createTokenHelper,
  generateMultisigWalletHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
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
  FEE_PER_OUTPUT,
  MAX_SHIELDED_OUTPUTS,
  NATIVE_TOKEN_UID,
  P2PKH_ACCT_PATH,
} from '../../../src/constants';
import { SendTxError, ShieldedChangeUnavailableError } from '../../../src/errors';
import Address from '../../../src/models/address';
import Network from '../../../src/models/network';
import Transaction from '../../../src/models/transaction';
import SendTransaction, { ISendOutput } from '../../../src/new/sendTransaction';
import { ProposedInput, ProposedOutput } from '../../../src/new/types';
import HathorWallet from '../../../src/new/wallet';
import { ChangeOutputMode, OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { IDataTx, IUtxo, TokenVersion, isDataOutputAddress } from '../../../src/types';
import transactionUtils from '../../../src/utils/transaction';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

const AS = ShieldedOutputMode.AMOUNT_SHIELDED;
const FS = ShieldedOutputMode.FULLY_SHIELDED;
const HTR = NATIVE_TOKEN_UID;
const HTR_LABELS: TokenLabels = { [HTR]: 'HTR' };

/** Ends a refusal of a change the rules shield, where keeping it transparent would build. */
const KEEP_TRANSPARENT_HINT =
  '; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.';

/**
 * The refusal of a send whose change stands in for a missing shielded input but cannot be
 * shielded: why the change must be shielded, `whyNot` it cannot be, and `end`, the hint to keep
 * it transparent, or '.' where the send is known to fail that way too.
 */
function standInRefusal(whyNot: string, end: string = KEEP_TRANSPARENT_HINT): string {
  return (
    "The change must be shielded (so the amount of its token's only shielded output cannot be " +
    `computed by subtraction), but ${whyNot}${end}`
  );
}

/** Why a standing-in HTR change cannot be shielded: too small for its fee, nothing to add. */
const TOO_SMALL =
  'it is too small to fund its shielded-output fee and no additional HTR is available to cover ' +
  'the difference';
/** The same when the caller supplied the HTR inputs, which nothing is added to. */
const TOO_SMALL_FROM_CALLER_HTR =
  'it is too small to fund its shielded-output fee, and HTR inputs were user-supplied so no ' +
  'additional HTR can be selected to cover the difference';
/** No HTR change was left at all, and no HTR can be pulled to make one. */
const NO_HTR_CHANGE = 'no HTR change is left and no additional HTR is available to make one';

/**
 * The refusal of a legacy changeAddress for a standing-in change that pays its own fee, up to
 * the suggestions that follow it.
 */
const LEGACY_ADDRESS_REFUSAL =
  "The change must be shielded (so the amount of its token's only shielded output cannot be " +
  'computed by subtraction), and a legacy change address cannot receive it. Use a new-format ' +
  'change address';

/**
 * Asserts that `send` is refused before broadcast with exactly `message`, raised as exactly
 * `type`: ShieldedChangeUnavailableError where the wallet cannot receive a shielded change, a
 * plain SendTxError for every other refusal here.
 */
async function expectRefusal(
  send: Promise<unknown>,
  type: typeof SendTxError,
  message: string
): Promise<void> {
  const outcome = await send.then(
    () => new Error('The send was not refused'),
    (error: unknown) => error
  );
  expect(outcome).toBeInstanceOf(type);
  expect((outcome as Error).constructor).toBe(type);
  expect((outcome as Error).message).toBe(message);
}

/**
 * Asserts that `wallet` holds exactly the available UTXOs it held in `before`: a refused send
 * broadcasts nothing and leaves nothing selected.
 */
async function expectUtxosUnchanged(
  wallet: HathorWallet,
  labels: TokenLabels,
  before: Map<string, string>
): Promise<void> {
  const entries = (snapshot: Map<string, string>): string[] =>
    sorted([...snapshot].map(([id, descriptor]) => `${id} ${descriptor}`));
  expect(entries(await snapshotUtxos(wallet, labels))).toEqual(entries(before));
}

/**
 * The caller input for the one available UTXO of `token` that `fundingTx` gave `wallet`, found
 * by its funding tx rather than by its value.
 */
async function fundedInput(
  wallet: HathorWallet,
  fundingTx: Transaction,
  token: string = HTR
): Promise<ProposedInput> {
  const funded: IUtxo[] = [];
  for await (const utxo of wallet.storage.selectUtxos({ token, only_available_utxos: true })) {
    if (utxo.txId === fundingTx.hash) {
      funded.push(utxo);
    }
  }
  expect(funded).toHaveLength(1);
  return { txId: funded[0].txId, index: funded[0].index, token };
}

/**
 * Starts a wallet with no shielded keys, the way a passkey wallet starts: from its account xpub,
 * with an external signer that holds the keys. An xpub derives the legacy chain alone, so the
 * wallet can pay a shielded recipient, which takes only the recipient's address, but has no
 * shielded address to receive a shielded change at.
 */
async function startWalletWithoutShieldedKeys(): Promise<HathorWallet> {
  const { words } = await precalculationHelpers.test!.getPrecalculatedWallet();
  const acctXpriv = new Mnemonic(words)
    .toHDPrivateKey('', new Network('testnet'))
    .deriveNonCompliantChild(P2PKH_ACCT_PATH);
  // The signer derives each input's key from the change-path xpriv, as a passkey ceremony does.
  const changeXpriv = acctXpriv.deriveNonCompliantChild(0);
  const wallet = await generateWalletHelper({ xpub: acctXpriv.xpubkey });
  wallet.setExternalTxSigningMethod((tx, storage) =>
    transactionUtils.signTxInputs(tx, storage, async () => changeXpriv)
  );
  // The external signer, not a stored key, makes the wallet spendable.
  expect(await wallet.isReadonly()).toBe(false);
  await expect(shieldedAddr(wallet, 0)).rejects.toThrow('Shielded keys not available');
  return wallet;
}

/**
 * Pushes a multisig send the way a tx proposal goes: every participant signs the proposal's hex,
 * the proposer assembles the P2SH input data from the signatures, then mines and pushes the tx.
 * Returns the pushed tx's hash.
 */
async function pushMultisigProposal(
  txData: IDataTx,
  participants: HathorWallet[],
  fundingTxId: string
): Promise<string> {
  const [proposer] = participants;
  const txHex = transactionUtils
    .createTransactionFromData({ version: 1, ...txData }, proposer.getNetworkObject())
    .toHex();
  const signatures: string[] = [];
  for (const participant of participants) {
    signatures.push(await participant.getAllSignatures(txHex, DEFAULT_PIN_CODE));
  }
  await waitUntilNextTimestamp(proposer, fundingTxId);
  const assembled = await proposer.assemblePartialTransaction(txHex, signatures);
  assembled.prepareToSend();
  const pushed = await new SendTransaction({
    storage: proposer.storage,
    transaction: assembled,
  }).runFromMining();
  if (!pushed.hash) {
    throw new Error('The pushed multisig transaction has no hash');
  }
  return pushed.hash;
}

describe('shielded outputs — Group Z: The change that stands in for a missing shielded input', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('Z.1 — with no HTR change, HTR is pulled past an exact split-fee landing until the stand-in change pays its own fee, and the output stays whole', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 17n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 1n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 2), 5n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:17', 'HTR:public:1', 'HTR:public:5'])
    );
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);

    // One public and one amount-shielded HTR output, and the wallet holds no shielded HTR: the
    // HTR change stands in for the missing shielded input. The public 17 pays 5 + 11 + 1 (the
    // shielded output's fee) exactly, so the HTR selection leaves no change, and HTR is pulled,
    // smallest-first, until a change pays its own fee. The 1 alone would pay the 1 fee of a
    // split exactly, but as a change it cannot pay its own 1 fee, so the 5 is pulled too:
    // 1 + 5 - 1 = 5, amount-shielded like the output. That change is the second shielded
    // output, and the 11 is never split, as its halves would add up to its amount.
    // HTR: 17 + 1 + 5 = 5 + 11 (sent) + 5 (change) + 2 (fee).
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
      inputs: sorted(['HTR:public:17', 'HTR:public:1', 'HTR:public:5']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:11', 'self:HTR:AS:5']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // The node exact-matches the fee of two amount-shielded outputs funded by transparent
    // inputs alone, and the wallet decodes its own change.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:5']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual(sorted(['HTR:public:5', 'HTR:AS:11']));
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it("Z.2 — a fully shielded output's stand-in change below its own fee takes more HTR and stays fully shielded; with none to add the send fails without suggesting a transparent change", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 19n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:19']);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: FS },
    ];
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // 1. The public 19 pays 5 + 11 + 2 (the fully shielded output's fee) and leaves 1, which
    // stands in for the missing shielded input. Fully shielded like the output, the change owes
    // a 2 fee it cannot pay, and the wallet has no HTR to add. Kept transparent, the 1 could not
    // pay the 2 fee of splitting the 11 either, so the error does not suggest it, and pinned
    // transparent the send fails for the split.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs),
      SendTxError,
      standInRefusal(TOO_SMALL, '.')
    );
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeShieldedMode: OutputKind.TRANSPARENT }),
      SendTxError,
      'The HTR change cannot fund the shielded-output split the protocol requires, and no ' +
        'additional HTR is available.'
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // 2. With the public 10 as well, the 19 still pays the send alone and leaves 1, not above
    // its 2 fee, so the 10 is pulled into the change, which stays fully shielded: 1 + 10 - 2 =
    // 9. It is the 11's second shielded output, and the 11 stays whole.
    // HTR: 19 + 10 = 5 + 11 (sent) + 9 (change) + 4 (fee).
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 10n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:19', 'HTR:public:10']));
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:19', 'HTR:public:10']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:FS:11', 'self:HTR:FS:9']),
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    // The node verifies the surjection proofs of both fully shielded outputs, whose domain holds
    // only transparent HTR inputs, and the exact fee; the recipient decodes the fully shielded 11.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:9']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual(sorted(['HTR:public:5', 'HTR:FS:11']));
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it('Z.3 — a legacy changeAddress is checked last for the stand-in: an explicit shielded mode fails up front, an unfundable change fails for its fee first, a funded one fails for the address, and an own new-format changeAddress hosts it', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 18n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:18']);
    const legacyChange = await legacyAddr(wallet, 5);
    const shieldedChange = await shieldedAddr(wallet, 7);
    // Neither is where the wallet would put a change by default, so honoring them is visible.
    expect((await wallet.getCurrentAddress()).address).not.toBe(legacyChange);
    expect((await wallet.getCurrentAddress({}, { legacy: false })).address).not.toBe(
      shieldedChange
    );
    const paidTo = await shieldedAddr(recipient, 0);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: paidTo, value: 11n, token: HTR, shielded: AS },
    ];
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // 0. An explicit shielded change mode and a legacy change address contradict each other:
    // the send fails before anything is selected.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, {
        changeAddress: legacyChange,
        changeShieldedMode: AS,
      }),
      SendTxError,
      'A legacy change address cannot receive the shielded change that changeShieldedMode ' +
        'requests — use a new-format change address.'
    );

    // 1. The public 18 pays 5 + 11 + 1 (the shielded output's fee) and leaves 1, which stands in
    // for the missing shielded input but cannot pay its own 1 fee, and the wallet has no HTR to
    // add. That fails the send before the legacy address is looked at: a new-format address
    // would not fund the change. Kept transparent, the 1 would pay the 1 fee of a split, so the
    // error suggests it.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeAddress: legacyChange }),
      SendTxError,
      standInRefusal(TOO_SMALL)
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // 2. With the public 5 as well, it is pulled into the change, which then pays its own fee:
    // only now is the legacy address refused, as it cannot receive a shielded change.
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 5n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:18', 'HTR:public:5']));
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeAddress: legacyChange }),
      SendTxError,
      `${LEGACY_ADDRESS_REFUSAL}, or changeShieldedMode: OutputKind.TRANSPARENT to keep the ` +
        'change transparent.'
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // 3. The wallet's own new-format address at index 7 hosts the same change: 1 + 5 - 1 = 5,
    // amount-shielded, paid to that address's spend P2PKH.
    // HTR: 18 + 5 = 5 + 11 (sent) + 5 (change) + 2 (fee).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
      changeAddress: shieldedChange,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:18', 'HTR:public:5']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:11', 'self:HTR:AS:5']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    const paidOnChain = (txData.shieldedOutputs ?? []).map(
      output => `${output.address}:${output.value}`
    );
    expect(sorted(paidOnChain)).toEqual(
      sorted([
        `${spendAddressOf(wallet, paidTo)}:11`,
        `${spendAddressOf(wallet, shieldedChange)}:5`,
      ])
    );

    // The node accepts a change topped up by a pulled UTXO and paid to a shielded address the
    // wallet would not pick by default, and the wallet decodes it there.
    await broadcast(sendTx, [wallet, recipient]);

    const atChangeAddress: string[] = [];
    for await (const utxo of wallet.storage.selectUtxos({
      token: HTR,
      filter_address: shieldedChange,
    })) {
      atChangeAddress.push(`HTR:${utxoKind(utxo)}:${utxo.value}`);
    }
    expect(atChangeAddress).toEqual(['HTR:AS:5']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:5']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it('Z.4 — a wallet with no shielded address (an xpub wallet with an external signer) cannot receive the stand-in change; pinned transparent, it pays the shielded recipient with a split', async () => {
    const wallet = await startWalletWithoutShieldedKeys();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 30n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:30']);
    const legacyChange = await legacyAddr(wallet, 5);
    expect(await wallet.isAddressMine(legacyChange)).toBe(true);
    const paidTo = await shieldedAddr(recipient, 0);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: paidTo, value: 11n, token: HTR, shielded: AS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    const noShieldedAddress = standInRefusal('the wallet has no shielded address to receive it');

    // 1. The 30 pays 5 + 11 + 1 (the shielded output's fee) and leaves 13, which stands in for
    // the missing shielded input. The wallet has no shielded address to receive it, the first
    // check, made before any about fees or addresses.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs),
      ShieldedChangeUnavailableError,
      noShieldedAddress
    );
    // The wallet's own legacy changeAddress does not change that: a new-format change address
    // would not help a wallet with no shielded address, so the error is about the wallet, not
    // about the legacy address.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeAddress: legacyChange }),
      ShieldedChangeUnavailableError,
      noShieldedAddress
    );
    // With every output shielded, the change must be shielded as well, though it stands in for
    // nothing: refused for the same reason, in the wording of any shielded change.
    await expectRefusal(
      wallet.sendManyOutputsTransaction([
        { address: paidTo, value: 5n, token: HTR, shielded: AS },
        { address: await shieldedAddr(recipient, 1), value: 5n, token: HTR, shielded: AS },
      ]),
      ShieldedChangeUnavailableError,
      `A shielded change is required, but the wallet has no shielded address to receive it${KEEP_TRANSPARENT_HINT}`
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // 2. Pinned transparent, as suggested, the 13 change stays public at the wallet's own
    // address and pays the split fee: 13 - 1 = 12. The 11 is then the only shielded output and
    // is split into 5 + 6, both at the recipient's address. The wallet builds the halves from the
    // recipient's address alone, and its external signer signs the legacy input.
    // HTR: 30 = 5 + 5 + 6 (sent) + 12 (change) + 2 (fee).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs, {
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
    const paidOnChain = spendAddressOf(wallet, paidTo);
    expect((txData.shieldedOutputs ?? []).map(output => output.address)).toEqual([
      paidOnChain,
      paidOnChain,
    ]);

    // The node accepts the two halves with the exact fee, and the recipient decodes 5 + 6.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:12']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(16n + shape.fee);
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:5', 'HTR:AS:5', 'HTR:AS:6'])
    );
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
  });

  it("Z.5 — a multisig wallet cannot receive the stand-in change; pinned transparent, its P2SH change and the recipient's split are accepted by the node", async () => {
    const mh1 = await generateMultisigWalletHelper({ walletIndex: 0 });
    const mh2 = await generateMultisigWalletHelper({ walletIndex: 1 });
    const mh3 = await generateMultisigWalletHelper({ walletIndex: 2 });
    const recipient = await generateWalletHelper();
    const fundTx = await GenesisWalletHelper.injectFunds(mh1, await mh1.getAddressAtIndex(0), 30n);
    // The multisig seeds are shared across suites, so the wallet may hold other UTXOs: the send
    // spends the one this test funded, as a caller input.
    const input = await fundedInput(mh1, fundTx);
    // Every participant signs from its own copy of the funding tx.
    await waitForTxReceived(mh2, input.txId);
    await waitForTxReceived(mh3, input.txId);
    const network = mh1.getNetworkObject();
    const paidTo = await shieldedAddr(recipient, 0);
    const outputs: ISendOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: paidTo, value: 11n, token: HTR, shieldedMode: AS },
    ];
    // A multisig send is built from storage alone, as a tx proposal is.
    const propose = (
      options: { changeAddress?: string; changeShieldedMode?: ChangeOutputMode } = {}
    ): Promise<IDataTx> =>
      new SendTransaction({
        storage: mh1.storage,
        inputs: [input],
        outputs,
        ...options,
      }).prepareTxData();
    const utxosBefore = await snapshotUtxos(mh1, HTR_LABELS);

    // 1. The caller's 30 pays 5 + 11 + 1 (the shielded output's fee) and leaves 13, which stands
    // in for the missing shielded input. A multisig wallet's shielded addresses would be
    // single-signature, so it never receives a shielded change.
    await expectRefusal(
      propose(),
      ShieldedChangeUnavailableError,
      standInRefusal('a shielded change is not supported for multisig wallets')
    );
    // Nor can it use a new-format change address, even for a change pinned transparent, which
    // would pay a single-signature spend key there. That is checked up front, before the
    // address's owner.
    await expectRefusal(
      propose({
        changeShieldedMode: OutputKind.TRANSPARENT,
        changeAddress: await shieldedAddr(recipient, 1),
      }),
      SendTxError,
      'A multisig wallet cannot use a new-format change address.'
    );
    // Neither refusal broadcast anything or left the 30 selected.
    expect(await fundedInput(mh1, fundTx)).toEqual(input);

    // 2. Pinned transparent, as multisig wallets pass for such sends, the 13 change stays a
    // transparent P2SH change and pays the split fee: 13 - 1 = 12. The 11 is split into 5 + 6
    // at the recipient. HTR: 30 = 5 + 5 + 6 (sent) + 12 (change) + 2 (fee).
    const txData = await propose({ changeShieldedMode: OutputKind.TRANSPARENT });

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: mh1,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: ['HTR:public:30'],
      outputs: sorted(['recipient:HTR:5', 'self:HTR:12']),
      shielded: sorted(['recipient:HTR:AS:5', 'recipient:HTR:AS:6']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    expect(txData.inputs.map(spent => `${spent.txId}:${spent.index}`)).toEqual([
      `${input.txId}:${input.index}`,
    ]);
    const changes = txData.outputs.filter(isDataOutputAddress).filter(out => out.value === 12n);
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change.type).toBe('p2sh');
    expect(new Address(change.address, { network }).getType()).toBe('p2sh');
    expect(await mh1.isAddressMine(change.address)).toBe(true);
    const paidOnChain = spendAddressOf(mh1, paidTo);
    expect((txData.shieldedOutputs ?? []).map(output => output.address)).toEqual([
      paidOnChain,
      paidOnChain,
    ]);

    // The node verifies the P2SH signatures over a tx that carries the shielded outputs and the
    // fee headers, after the proposal's hex round trip, and accepts the exact fee.
    const hash = await pushMultisigProposal(txData, [mh1, mh2, mh3], input.txId);
    await waitForTxReceived(mh1, hash);
    await waitForTxReceived(recipient, hash);

    // The recipient decodes both halves beside its transparent 5.
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:5', 'HTR:AS:5', 'HTR:AS:6'])
    );
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);
    // The multisig wallet holds the 12 at its P2SH change address, and the 30 is spent.
    const { utxos } = await mh1.getUtxos({ token: HTR });
    expect(
      utxos.filter(utxo => utxo.tx_id === hash).map(utxo => [utxo.address, utxo.amount])
    ).toEqual([[change.address, 12n]]);
    expect(
      utxos.find(utxo => utxo.tx_id === input.txId && utxo.index === input.index)
    ).toBeUndefined();
    expect(await mh1.getTx(hash)).toMatchObject({
      inputs: [expect.objectContaining({ tx_id: input.txId, index: input.index, value: 30n })],
    });
  });

  it('Z.6 — beside other shielded outputs, an HTR stand-in with no change fails while the wallet has no HTR to add, then takes a fully shielded change pulled from new HTR', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(19n, []);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:19']);
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: HTR, shielded: FS },
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 1), value: 5n, token: custom, shielded: AS },
      { address: await shieldedAddr(recipient, 2), value: 5n, token: custom, shielded: AS },
    ];
    let utxosBefore = await snapshotUtxos(wallet, labels);

    // 1. HTR has one fully shielded output and one public one, and the wallet holds no shielded
    // HTR, so the HTR change stands in for the missing shielded input; the two CUSTOM shielded
    // outputs do not change that, as the 10 is still the only shielded output of its token.
    // CUSTOM's 10 pays 5 + 5 exactly, and the public 19 pays 10 + 5 + 4 (fees: 2 + 1 + 1)
    // exactly, so no HTR change is left, and the wallet has no HTR to pull for one.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs),
      SendTxError,
      standInRefusal(NO_HTR_CHANGE)
    );
    await expectUtxosUnchanged(wallet, labels, utxosBefore);
    // The error suggests a transparent change because pinned transparent the three outputs
    // build as they are, with no change (inspected, not broadcast). The 10 could then be
    // computed by subtraction: 19 - 5 - 4.
    const pinned = await prepareSend(wallet, outputs, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });
    expect(
      await describeBuiltTx(pinned.txData, utxosBefore, { sender: wallet, recipient, labels })
    ).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:19']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:FS:10', 'recipient:CUSTOM:AS:5', 'recipient:CUSTOM:AS:5']),
      fee: FEE_PER_FULL_SHIELDED_OUTPUT + 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // 2. With the public 2 and 5 as well, the 19 still pays the send exactly, and HTR is pulled,
    // smallest-first, until a fully shielded change pays its own 2 fee: the 2 alone is not above
    // it, so the 5 is pulled too: 2 + 5 - 2 = 5.
    // HTR: 19 + 2 + 5 = 10 + 5 (sent) + 5 (change) + 6 (fee).
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 2), 2n);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 3), 5n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:19', 'HTR:public:2', 'HTR:public:5'])
    );
    utxosBefore = await snapshotUtxos(wallet, labels);
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:public:10', 'HTR:public:19', 'HTR:public:2', 'HTR:public:5']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted([
        'recipient:HTR:FS:10',
        'recipient:CUSTOM:AS:5',
        'recipient:CUSTOM:AS:5',
        'self:HTR:FS:5',
      ]),
      fee: 2n * FEE_PER_FULL_SHIELDED_OUTPUT + 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // The node verifies the fully shielded outputs' surjection proofs over a domain that
    // includes the CUSTOM input, and the exact fee.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:FS:5']);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual([]);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(15n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(15n);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it("Z.7 — the stand-in error suggests a transparent change only where it would build: beside another token's shielded change, the fee that change frees decides", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const tokenResponse = await createTokenHelper(funder, 'Stand-in Custom', 'SIC', 100n, {
      address: await legacyAddr(funder, 1),
    });
    const custom: string = tokenResponse.hash;
    const labels: TokenLabels = { [HTR]: 'HTR', [custom]: 'CUSTOM' };
    await fundShielded(funder, wallet, custom, [{ value: 15n, mode: AS }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 18n);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:AS:15']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:18']);
    // The same send with its shielded HTR output in either mode.
    const sendWithHtrIn = async (htrMode: ShieldedOutputMode): Promise<ProposedOutput[]> => [
      { address: await shieldedAddr(recipient, 0), value: 10n, token: HTR, shielded: htrMode },
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await legacyAddr(recipient, 1), value: 10n, token: custom },
    ];
    const fullyShielded = await sendWithHtrIn(FS);
    const amountShielded = await sendWithHtrIn(AS);
    const utxosBefore = await snapshotUtxos(wallet, labels);

    // 1. The shielded CUSTOM 15 pays the public 10, so its 5 change mirrors it (amount-shielded)
    // and owes a 1 fee. The public 18 pays 10 + 5 + 3 (fees: 2 + 1) exactly, so the HTR change,
    // which stands in for the missing shielded HTR input, must be made of pulled HTR, and the
    // wallet has none. Pinned transparent, the CUSTOM change would stop paying its 1 fee, too
    // little for the 2 of splitting the fully shielded 10, so the error does not suggest it, and
    // the pinned send fails for the split.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(fullyShielded),
      SendTxError,
      standInRefusal(NO_HTR_CHANGE, '.')
    );
    await expectRefusal(
      wallet.sendManyOutputsTransaction(fullyShielded, {
        changeShieldedMode: OutputKind.TRANSPARENT,
      }),
      SendTxError,
      'The HTR change cannot fund the shielded-output split the protocol requires, and no ' +
        'additional HTR is available.'
    );

    // 2. With the HTR output amount-shielded, the 18 pays 10 + 5 + 2 (fees) and leaves 1, too
    // small for its own 1 fee, with no HTR to add. Pinned transparent, the 1 fee the CUSTOM
    // change would stop paying covers the 1 of splitting the amount-shielded 10, so the error
    // suggests it.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(amountShielded),
      SendTxError,
      standInRefusal(TOO_SMALL)
    );
    await expectUtxosUnchanged(wallet, labels, utxosBefore);

    // 3. Pinned transparent, as suggested: the CUSTOM 5 change stays public, the HTR change,
    // 18 - 10 - 5 - 1 = 2, pays the split fee and keeps 1, and the 10 is split into 5 + 5.
    // HTR: 18 = 5 + 5 + 5 (sent) + 1 (change) + 2 (fee). CUSTOM: 15 = 10 (sent) + 5 (change).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, amountShielded, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['CUSTOM:AS:15', 'HTR:public:18']),
      outputs: sorted(['recipient:HTR:5', 'recipient:CUSTOM:10', 'self:CUSTOM:5', 'self:HTR:1']),
      shielded: ['recipient:HTR:AS:5', 'recipient:HTR:AS:5'],
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });
    // Shielded outputs remain, so this is no full unshield: the blinding of the shielded CUSTOM
    // input is balanced by the HTR outputs, with no excess.
    expect(txData.excessBlindingFactor).toBeUndefined();

    // The node checks that cross-token balance and the exact fee.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:5']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:1']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(15n + shape.fee);
    expect(await unlockedBalance(recipient, HTR)).toBe(15n);
    expect(await unlockedBalance(recipient, custom)).toBe(10n);
  });

  it('Z.8 — a 1-unit HTR output whose change stands in is never split: with HTR to add, the change is its second output, and no error suggests a transparent change', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 0), 7n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:7']);
    const legacyChange = await legacyAddr(wallet, 5);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 1n, token: HTR, shielded: AS },
    ];
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // 1. The public 7 pays 5 + 1 + 1 (the shielded output's fee) exactly, so no HTR change is
    // left, and the wallet has no HTR to make one from. Pinned transparent, the 1-unit output
    // could not be split and would have no shielded change for its second output, so the send
    // fails that way too, and the error does not suggest it.
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs),
      SendTxError,
      standInRefusal(NO_HTR_CHANGE, '.')
    );
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeShieldedMode: OutputKind.TRANSPARENT }),
      SendTxError,
      "The transaction's only shielded output holds 1 unit, too little to split into the two " +
        'shielded outputs the protocol requires, and changeShieldedMode: OutputKind.TRANSPARENT ' +
        'keeps the change from being shielded as the second one.'
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // 2. With the public 5 as well, it is pulled for a change that pays its own fee, and only
    // then is the legacy changeAddress refused. Kept transparent, the change could not be the
    // 1-unit output's second shielded output, so only a new-format change address is suggested.
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 5n);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:7', 'HTR:public:5']));
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeAddress: legacyChange }),
      SendTxError,
      `${LEGACY_ADDRESS_REFUSAL}.`
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // 3. Without a changeAddress, the pulled 5 is the change: 5 - 1 = 4, amount-shielded beside
    // the 1, which is never split. HTR: 7 + 5 = 5 + 1 (sent) + 4 (change) + 2 (fee).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs);

    const shape = await describeBuiltTx(txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(shape).toEqual({
      inputs: sorted(['HTR:public:7', 'HTR:public:5']),
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:1', 'self:HTR:AS:4']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // The node accepts the 1-unit output beside a change made of transparent inputs, with the
    // exact fee, and the recipient decodes the 1.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:AS:4']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(6n + shape.fee);
    expect(await poolOf(recipient, HTR, 'HTR')).toEqual(sorted(['HTR:public:5', 'HTR:AS:1']));
    expect(await unlockedBalance(recipient, HTR)).toBe(6n);
  });

  it("Z.9 — caller-supplied HTR: the stand-in change of the caller's input is shielded with nothing added, and a change too small for its fee fails rather than add the wallet's HTR", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funded30 = await GenesisWalletHelper.injectFunds(
      wallet,
      await legacyAddr(wallet, 0),
      30n
    );
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 50n);
    const funded18 = await GenesisWalletHelper.injectFunds(
      wallet,
      await legacyAddr(wallet, 2),
      18n
    );
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:30', 'HTR:public:50', 'HTR:public:18'])
    );
    const input30 = await fundedInput(wallet, funded30);
    const input18 = await fundedInput(wallet, funded18);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 5n, token: HTR },
      { address: await shieldedAddr(recipient, 0), value: 11n, token: HTR, shielded: AS },
    ];
    let utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);

    // 1. The caller supplies the 30, so the wallet selects no HTR and adds nothing to it. The
    // caller supplied no shielded HTR input, so the change stands in for one: 30 - 5 - 11 - 1 =
    // 13, amount-shielded at a 1 fee: 12. The spare 50 and the 18 stay untouched.
    // HTR: 30 = 5 + 11 (sent) + 12 (change) + 2 (fee).
    const first = await prepareSend(wallet, outputs, { inputs: [input30] });

    const firstShape = await describeBuiltTx(first.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(firstShape).toEqual({
      inputs: ['HTR:public:30'],
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:11', 'self:HTR:AS:12']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    // The wallet decodes its own change, built from an input the caller chose.
    await broadcast(first.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(
      sorted(['HTR:public:50', 'HTR:public:18', 'HTR:AS:12'])
    );
    expect(await unlockedBalance(recipient, HTR)).toBe(16n);

    // 2. The caller supplies the 18: 18 - 5 - 11 - 1 = 1, too small for its own 1 fee, and no
    // HTR is added to a caller's inputs, although the wallet holds the spare 50. Nor does the
    // shielded 12 the wallet now holds count as a shielded input: for a token the caller
    // supplies inputs of, the rules read those inputs, not the wallet's pool.
    utxosBefore = await snapshotUtxos(wallet, HTR_LABELS);
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { inputs: [input18] }),
      SendTxError,
      standInRefusal(TOO_SMALL_FROM_CALLER_HTR)
    );
    await expectUtxosUnchanged(wallet, HTR_LABELS, utxosBefore);

    // Pinned transparent, as suggested, the 1 pays the 1 fee of splitting the 11 exactly, with
    // nothing added: 18 = 5 + 5 + 6 (sent) + 2 (fee).
    const pinned = await prepareSend(wallet, outputs, {
      inputs: [input18],
      changeShieldedMode: OutputKind.TRANSPARENT,
    });

    const pinnedShape = await describeBuiltTx(pinned.txData, utxosBefore, {
      sender: wallet,
      recipient,
      labels: HTR_LABELS,
    });
    expect(pinnedShape).toEqual({
      inputs: ['HTR:public:18'],
      outputs: ['recipient:HTR:5'],
      shielded: sorted(['recipient:HTR:AS:5', 'recipient:HTR:AS:6']),
      fee: 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT,
    });

    await broadcast(pinned.sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(sorted(['HTR:public:50', 'HTR:AS:12']));
    expect(await unlockedBalance(wallet, HTR)).toBe(62n);
    expect(await unlockedBalance(recipient, HTR)).toBe(32n);
  });

  it("Z.10 — a FEE token's stand-in change is shielded and owes its shielded-output fee instead of FEE_PER_OUTPUT", async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();
    const funder = await startFunder();
    const tokenResponse = await createTokenHelper(funder, 'Stand-in Fee', 'SFE', 100n, {
      address: await legacyAddr(funder, 1),
      tokenVersion: TokenVersion.FEE,
    });
    const fbt: string = tokenResponse.hash;
    const labels: TokenLabels = { [HTR]: 'HTR', [fbt]: 'FBT' };
    await fund(funder, wallet, [{ address: await legacyAddr(wallet, 0), value: 10n, token: fbt }]);
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), 10n);
    expect(await poolOf(wallet, fbt, 'FBT')).toEqual(['FBT:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:10']);
    // The wallet only received the token: its FEE version comes from the fullnode's token API
    // and is what makes the wallet charge FEE_PER_OUTPUT at all.
    expect((await wallet.getBalance(fbt))[0].token.version).toBe(TokenVersion.FEE);
    const outputs: ProposedOutput[] = [
      { address: await legacyAddr(recipient, 0), value: 3n, token: fbt },
      { address: await shieldedAddr(recipient, 0), value: 4n, token: fbt, shielded: FS },
    ];
    const utxosBefore = await snapshotUtxos(wallet, labels);

    // Pinned transparent (inspected, not broadcast), the FBT change of 3 stays public and owes
    // FEE_PER_OUTPUT like the transparent 3 sent, and the fully shielded 4, the only shielded
    // output, is split into 2 + 2, the split's 2 fee taken from the HTR change: 10 - 4 - 2 = 4.
    // Fee: 2 x FEE_PER_OUTPUT + two fully shielded outputs.
    const pinned = await prepareSend(wallet, outputs, {
      changeShieldedMode: OutputKind.TRANSPARENT,
    });
    expect(
      await describeBuiltTx(pinned.txData, utxosBefore, { sender: wallet, recipient, labels })
    ).toEqual({
      inputs: sorted(['FBT:public:10', 'HTR:public:10']),
      outputs: sorted(['recipient:FBT:3', 'self:FBT:3', 'self:HTR:4']),
      shielded: ['recipient:FBT:FS:2', 'recipient:FBT:FS:2'],
      fee: 2n * FEE_PER_OUTPUT + 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    // By the rules, FBT has one public and one fully shielded output and the wallet holds no
    // shielded FBT, so its change stands in for the missing shielded input, in the most private
    // mode of the token's shielded outputs (fully shielded). As a shielded output the change
    // owes the fully shielded fee instead of FEE_PER_OUTPUT. FBT: 10 = 3 + 4 (sent) + 3
    // (change). Fee: FEE_PER_OUTPUT for the transparent 3 + two fully shielded outputs. HTR
    // enters only to pay the fee, from public HTR, so its change stays transparent:
    // 10 = 5 (change) + 5 (fee).
    const htrBefore = await unlockedBalance(wallet, HTR);
    const { sendTx, txData } = await prepareSend(wallet, outputs);

    const shape = await describeBuiltTx(txData, utxosBefore, { sender: wallet, recipient, labels });
    expect(shape).toEqual({
      inputs: sorted(['FBT:public:10', 'HTR:public:10']),
      outputs: sorted(['recipient:FBT:3', 'self:HTR:5']),
      shielded: sorted(['recipient:FBT:FS:4', 'self:FBT:FS:3']),
      fee: FEE_PER_OUTPUT + 2n * FEE_PER_FULL_SHIELDED_OUTPUT,
    });

    // The node exact-matches a FEE-token fee in which the change owes a fully shielded output's
    // fee rather than FEE_PER_OUTPUT.
    await broadcast(sendTx, [wallet, recipient]);

    expect(await poolOf(wallet, fbt, 'FBT')).toEqual(['FBT:FS:3']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:5']);
    expect(htrBefore - (await unlockedBalance(wallet, HTR))).toBe(shape.fee);
    expect(await unlockedBalance(wallet, fbt)).toBe(3n);
    expect(await unlockedBalance(recipient, fbt)).toBe(7n);
  });

  it('Z.11 — at 32 shielded outputs the stand-in change fails for the limit, before a legacy changeAddress (no broadcast)', async () => {
    const { wallet, recipient, custom, labels } = await setupCustomTokenWallet(70n, []);
    expect(await poolOf(wallet, custom, 'CUSTOM')).toEqual(['CUSTOM:public:10']);
    expect(await poolOf(wallet, HTR, 'HTR')).toEqual(['HTR:public:70']);
    const htrRecipients = [
      await shieldedAddr(recipient, 1),
      await shieldedAddr(recipient, 2),
      await shieldedAddr(recipient, 3),
    ];
    const outputs: ProposedOutput[] = [
      { address: await shieldedAddr(recipient, 0), value: 6n, token: custom, shielded: AS },
      { address: await legacyAddr(recipient, 0), value: 3n, token: custom },
      ...Array.from({ length: MAX_SHIELDED_OUTPUTS - 1 }, (_, i) => ({
        address: htrRecipients[i % 3],
        value: 1n,
        token: HTR,
        shielded: AS,
      })),
    ];
    expect(outputs.filter(output => output.shielded !== undefined)).toHaveLength(
      MAX_SHIELDED_OUTPUTS
    );
    const utxosBefore = await snapshotUtxos(wallet, labels);
    const atTheLimit = standInRefusal(
      `the transaction already has the maximum ${MAX_SHIELDED_OUTPUTS} shielded outputs`
    );

    // CUSTOM's 10 pays 6 + 3 and leaves 1, which stands in for the missing shielded CUSTOM
    // input, but the CUSTOM 6 and the 31 HTR outputs already make 32 shielded outputs, the most
    // a transaction holds. The limit is checked before the change address, so a legacy one fails
    // the same way, and before any proof is built. Pinned transparent, the send would build 32
    // range proofs, so it is not tried here.
    await expectRefusal(wallet.sendManyOutputsTransaction(outputs), SendTxError, atTheLimit);
    await expectRefusal(
      wallet.sendManyOutputsTransaction(outputs, { changeAddress: await legacyAddr(wallet, 5) }),
      SendTxError,
      atTheLimit
    );
    await expectUtxosUnchanged(wallet, labels, utxosBefore);
  });
});
