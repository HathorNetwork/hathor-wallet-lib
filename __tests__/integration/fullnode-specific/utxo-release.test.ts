/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * UTXO reservation (`selected_as_input`) must be settled by the time the call
 * that changes it resolves or rejects:
 * - a failed send (mining or push) releases its inputs before it rejects, so an
 *   immediate retry can spend them again;
 * - `PartialTxProposal.addSend` reserves its inputs before it resolves, and
 *   `unmarkAsSelected` releases them before it resolves.
 *
 * Each wallet holds a single UTXO, so a UTXO still marked as selected makes the
 * follow-up send fail with insufficient funds.
 *
 * The action under test runs with slowed-down storage reads (see `slowTxReads`):
 * with the fast in-memory store an un-awaited (un)marking usually finishes before
 * the caller resumes, which hides the race that a slower store exposes.
 */

import config from '../../../src/config';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import type HathorWallet from '../../../src/new/wallet';
import PartialTxProposal from '../../../src/wallet/partialTxProposal';
import type { IUtxoId } from '../../../src/types';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { FULLNODE_URL, TX_MINING_URL } from '../configuration/test-constants';

// Nothing listens on port 1, so requests fail immediately with ECONNREFUSED.
const UNREACHABLE_URL = 'http://127.0.0.1:1/';
const AMOUNT = 10n;
const SLOW_READ_MS = 200;

/**
 * Delays the wallet's tx reads, like a disk-backed store (e.g. AsyncStorage on mobile).
 * Marking or releasing a UTXO reads its tx first, so this widens the window in which an
 * un-awaited (un)marking is still pending. Returns the spy, to restore the normal reads.
 */
function slowTxReads(hWallet: HathorWallet) {
  const { storage } = hWallet;
  const getTx = storage.getTx.bind(storage);
  return jest.spyOn(storage, 'getTx').mockImplementation(async txId => {
    await new Promise(resolve => {
      setTimeout(resolve, SLOW_READ_MS);
    });
    return getTx(txId);
  });
}

/**
 * Creates a wallet holding exactly one HTR UTXO of `AMOUNT`.
 */
async function walletWithSingleUtxo(): Promise<{ hWallet: HathorWallet; utxo: IUtxoId }> {
  const hWallet = await generateWalletHelper();
  const fundTx = await GenesisWalletHelper.injectFunds(
    hWallet,
    await hWallet.getAddressAtIndex(0),
    AMOUNT
  );
  const { utxos } = await hWallet.getUtxos();
  expect(utxos).toHaveLength(1);
  expect(utxos[0].tx_id).toBe(fundTx!.hash);
  // A tx spending this UTXO must have a later timestamp than the funding tx.
  await waitUntilNextTimestamp(hWallet, fundTx!.hash);
  return { hWallet, utxo: { txId: utxos[0].tx_id, index: utxos[0].index } };
}

/**
 * Sends the whole balance to the wallet's own address, spending its single UTXO.
 */
async function sendAll(hWallet: HathorWallet) {
  const tx = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), AMOUNT);
  await waitForTxReceived(hWallet, tx!.hash!);
  return tx;
}

/**
 * Prepares and signs a tx spending the wallet's single UTXO, without mining or pushing it.
 */
async function prepareSendAll(hWallet: HathorWallet) {
  const sendTx = await hWallet.sendManyOutputsSendTransaction([
    { address: await hWallet.getAddressAtIndex(1), value: AMOUNT, token: NATIVE_TOKEN_UID },
  ]);
  await sendTx.prepareTx();
  await sendTx.signTx();
  return sendTx;
}

describe('[Fullnode] UTXO release on a failed send', () => {
  afterEach(async () => {
    config.setServerUrl(FULLNODE_URL);
    config.setTxMiningUrl(TX_MINING_URL);
    await stopAllWallets();
  });

  it('releases the inputs before rejecting when mining fails', async () => {
    const { hWallet, utxo } = await walletWithSingleUtxo();
    const sendTx = await prepareSendAll(hWallet);

    config.setTxMiningUrl(UNREACHABLE_URL);
    const slowReads = slowTxReads(hWallet);
    await expect(sendTx.runFromMining()).rejects.toThrow();

    expect(await hWallet.storage.isUtxoSelectedAsInput(utxo)).toBe(false);

    // The retry can spend the same UTXO.
    slowReads.mockRestore();
    config.setTxMiningUrl(TX_MINING_URL);
    await expect(sendAll(hWallet)).resolves.toBeDefined();
  });

  it('releases the inputs before rejecting when the push request fails', async () => {
    const { hWallet, utxo } = await walletWithSingleUtxo();
    const sendTx = await prepareSendAll(hWallet);
    await sendTx.runFromMining('mine-tx');

    config.setServerUrl(UNREACHABLE_URL);
    const slowReads = slowTxReads(hWallet);
    await expect(sendTx.handlePushTx()).rejects.toThrow();

    expect(await hWallet.storage.isUtxoSelectedAsInput(utxo)).toBe(false);

    slowReads.mockRestore();
    config.setServerUrl(FULLNODE_URL);
    await expect(sendAll(hWallet)).resolves.toBeDefined();
  });

  it('releases the inputs before rejecting when the fullnode rejects the tx', async () => {
    const { hWallet, utxo } = await walletWithSingleUtxo();
    const sendTx = await prepareSendAll(hWallet);
    await sendTx.runFromMining('mine-tx');

    // A timestamp before its parents makes the fullnode refuse the tx.
    sendTx.transaction!.timestamp = 1;
    const slowReads = slowTxReads(hWallet);
    await expect(sendTx.handlePushTx()).rejects.toThrow();

    expect(await hWallet.storage.isUtxoSelectedAsInput(utxo)).toBe(false);

    slowReads.mockRestore();
    await expect(sendAll(hWallet)).resolves.toBeDefined();
  });
});

describe('[Fullnode] PartialTxProposal UTXO reservation', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('addSend reserves its inputs before it resolves', async () => {
    const { hWallet, utxo } = await walletWithSingleUtxo();

    const proposal = new PartialTxProposal(hWallet.storage);
    const slowReads = slowTxReads(hWallet);
    await proposal.addSend(NATIVE_TOKEN_UID, AMOUNT);

    expect(await hWallet.storage.isUtxoSelectedAsInput(utxo)).toBe(true);

    // The reserved UTXO can't be picked by another send.
    slowReads.mockRestore();
    await expect(
      hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), AMOUNT)
    ).rejects.toThrow(/insufficient/i);
  });

  it('unmarkAsSelected releases its inputs before it resolves', async () => {
    const { hWallet, utxo } = await walletWithSingleUtxo();

    const proposal = new PartialTxProposal(hWallet.storage);
    await proposal.addSend(NATIVE_TOKEN_UID, AMOUNT);
    const slowReads = slowTxReads(hWallet);
    await proposal.unmarkAsSelected();

    expect(await hWallet.storage.isUtxoSelectedAsInput(utxo)).toBe(false);

    slowReads.mockRestore();
    await expect(sendAll(hWallet)).resolves.toBeDefined();
  });
});
