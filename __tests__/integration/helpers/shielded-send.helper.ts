/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Helpers for integration tests that check the exact shape of a send: which UTXOs it spends,
 * which transparent and shielded outputs it creates, and the fee it declares.
 *
 * UTXOs are described as `<token>:<kind>:<value>`, where kind is 'public', 'AS' (amount
 * shielded) or 'FS' (fully shielded), and outputs as `<owner>:<token>:<value>` or
 * `<owner>:<token>:<mode>:<value>`, so a whole pool or a whole built tx compares with one
 * `toEqual`. The funding helpers keep a test wallet's pool exact: every UTXO it holds is one the
 * test asked for.
 */

import { GenesisWalletHelper } from './genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import FeeHeader from '../../../src/headers/fee';
import Address from '../../../src/models/address';
import HathorWallet from '../../../src/new/wallet';
import SendTransaction from '../../../src/new/sendTransaction';
import { ProposedOutput, SendManyOutputsOptions } from '../../../src/new/types';
import { OutputKind, ShieldedOutputMode } from '../../../src/shielded/types';
import { IDataTx, IUtxo } from '../../../src/types';

type Wallet = HathorWallet;

/** Token uid -> the short label used in the UTXO and output descriptors. */
export type TokenLabels = Record<string, string>;

/** One shielded UTXO a funding tx creates. */
export interface ShieldedEntry {
  value: bigint;
  mode: ShieldedOutputMode;
}

export function sorted(items: string[]): string[] {
  return [...items].sort();
}

export function legacyAddr(wallet: Wallet, index: number): Promise<string> {
  return wallet.getAddressAtIndex(index, { legacy: true });
}

export function shieldedAddr(wallet: Wallet, index: number): Promise<string> {
  return wallet.getAddressAtIndex(index, { legacy: false });
}

/** The spend-derived P2PKH that a new-format address pays to on chain. */
export function spendAddressOf(wallet: Wallet, newFormatAddress: string): string {
  const address = new Address(newFormatAddress, { network: wallet.getNetworkObject() });
  return address.getSpendAddress().base58;
}

/** 'public', 'AS' or 'FS': only fully shielded UTXOs carry an asset blinding factor. */
export function utxoKind(utxo: IUtxo): string {
  if (!utxo.shielded) {
    return 'public';
  }
  return utxo.assetBlindingFactor !== undefined ? 'FS' : 'AS';
}

/**
 * The wallet's spendable non-authority UTXOs of the labeled tokens, keyed by `txId:index` and
 * described as `<token>:<kind>:<value>`.
 */
export async function snapshotUtxos(
  wallet: Wallet,
  labels: TokenLabels
): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  for (const [token, label] of Object.entries(labels)) {
    for await (const utxo of wallet.storage.selectUtxos({ token, only_available_utxos: true })) {
      snapshot.set(`${utxo.txId}:${utxo.index}`, `${label}:${utxoKind(utxo)}:${utxo.value}`);
    }
  }
  return snapshot;
}

/** The wallet's exact pool of one token, as sorted descriptors. */
export async function poolOf(wallet: Wallet, token: string, label: string): Promise<string[]> {
  return sorted([...(await snapshotUtxos(wallet, { [token]: label })).values()]);
}

export async function unlockedBalance(wallet: Wallet, token: string): Promise<bigint> {
  const [entry] = await wallet.getBalance(token);
  return entry.balance.unlocked;
}

async function ownerOf(address: string, sender: Wallet, recipient: Wallet): Promise<string> {
  if (await sender.isAddressMine(address)) {
    return 'self';
  }
  if (await recipient.isAddressMine(address)) {
    return 'recipient';
  }
  return `unknown(${address})`;
}

/** The shape of a built (not yet broadcast) tx, as sorted descriptors. */
export interface BuiltTxShape {
  /** Descriptors of the spent UTXOs, from the pre-send snapshot. */
  inputs: string[];
  /** Transparent outputs as `<owner>:<token>:<value>`. */
  outputs: string[];
  /** Shielded outputs as `<owner>:<token>:<mode>:<value>`. */
  shielded: string[];
  /** HTR declared in the FeeHeader; 0n when the tx carries none. */
  fee: bigint;
}

export async function describeBuiltTx(
  txData: IDataTx,
  utxosBefore: Map<string, string>,
  { sender, recipient, labels }: { sender: Wallet; recipient: Wallet; labels: TokenLabels }
): Promise<BuiltTxShape> {
  const inputs = txData.inputs.map(
    input =>
      utxosBefore.get(`${input.txId}:${input.index}`) ?? `unknown(${input.txId}:${input.index})`
  );
  const outputs: string[] = [];
  for (const output of txData.outputs) {
    const address = 'address' in output ? output.address : '';
    const token = 'token' in output ? output.token : NATIVE_TOKEN_UID;
    const owner = await ownerOf(address, sender, recipient);
    outputs.push(`${owner}:${labels[token] ?? token}:${output.value}`);
  }
  const shielded: string[] = [];
  for (const output of txData.shieldedOutputs ?? []) {
    const owner = await ownerOf(output.address, sender, recipient);
    const mode = output.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED ? 'FS' : 'AS';
    shielded.push(`${owner}:${labels[output.token] ?? output.token}:${mode}:${output.value}`);
  }
  let fee = 0n;
  for (const header of txData.headers ?? []) {
    if (header instanceof FeeHeader) {
      for (const entry of header.entries) {
        fee += entry.amount;
      }
    }
  }
  return { inputs: sorted(inputs), outputs: sorted(outputs), shielded: sorted(shielded), fee };
}

/** Builds a send up to 'prepare-tx', so the tx the wallet assembled can be inspected. */
export async function prepareSend(
  wallet: Wallet,
  outputs: ProposedOutput[],
  options: SendManyOutputsOptions = {}
): Promise<{ sendTx: SendTransaction; txData: IDataTx }> {
  const sendTx = await wallet.sendManyOutputsSendTransaction(outputs, options);
  await sendTx.run('prepare-tx');
  if (!sendTx.fullTxData) {
    throw new Error('prepare-tx left no tx data to inspect');
  }
  return { sendTx, txData: sendTx.fullTxData };
}

/** Signs, mines and pushes a prepared send, then waits until every wallet processed it. */
export async function broadcast(sendTx: SendTransaction, wallets: Wallet[]): Promise<string> {
  const tx = await sendTx.run();
  if (!tx.hash) {
    throw new Error('The pushed transaction has no hash');
  }
  for (const wallet of wallets) {
    await waitForTxReceived(wallet, tx.hash);
  }
  await waitUntilNextTimestamp(wallets[0], tx.hash);
  return tx.hash;
}

/** A funding send: waits until both the funder and the funded wallet processed it. */
export async function fund(
  funder: Wallet,
  wallet: Wallet,
  outputs: ProposedOutput[],
  options: SendManyOutputsOptions = {}
): Promise<void> {
  const tx = await funder.sendManyOutputsTransaction(outputs, options);
  if (!tx?.hash) {
    throw new Error('The funding send returned no transaction');
  }
  await waitForTxReceived(funder, tx.hash);
  await waitForTxReceived(wallet, tx.hash);
  await waitUntilNextTimestamp(funder, tx.hash);
}

/** A fresh wallet holding 50 public HTR, used only to fund test wallets. */
export async function startFunder(): Promise<Wallet> {
  const funder = await generateWalletHelper();
  await GenesisWalletHelper.injectFunds(funder, await legacyAddr(funder, 0), 50n);
  return funder;
}

/**
 * Sends the wallet one shielded UTXO of `token` per entry, at its shielded addresses
 * `firstIndex`, `firstIndex + 1`, ... in a single tx. A single entry is paired with a 1 HTR
 * amount-shielded output to the funder's own shielded address: as the tx's only shielded output
 * it would be split into two halves, and the funded wallet would hold two UTXOs instead of the
 * one asked for. The funder's change is pinned transparent, so the tx's shielded outputs are
 * exactly these. With no entries, nothing is sent.
 */
export async function fundShielded(
  funder: Wallet,
  wallet: Wallet,
  token: string,
  entries: ShieldedEntry[],
  firstIndex: number = 0
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const outputs: ProposedOutput[] = [];
  for (const [offset, { value, mode }] of entries.entries()) {
    const address = await shieldedAddr(wallet, firstIndex + offset);
    outputs.push({ address, value, token, shielded: mode });
  }
  if (outputs.length < 2) {
    const address = await shieldedAddr(funder, 0);
    outputs.push({
      address,
      value: 1n,
      token: NATIVE_TOKEN_UID,
      shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
    });
  }
  await fund(funder, wallet, outputs, { changeShieldedMode: OutputKind.TRANSPARENT });
}

/**
 * A test wallet holding exactly one public 10 of a fresh DEPOSIT custom token, the given
 * shielded HTR UTXOs and, unless `publicHtr` is 0n, one public HTR UTXO of `publicHtr`, plus a
 * fresh recipient and the funder, which can fund more.
 *
 * The token's public 10 comes from the funder in its own tx, the shielded HTR in another (see
 * `fundShielded`), and the public HTR from the genesis wallet.
 */
export async function setupCustomTokenWallet(
  publicHtr: bigint,
  shieldedHtr: ShieldedEntry[]
): Promise<{
  wallet: Wallet;
  recipient: Wallet;
  funder: Wallet;
  custom: string;
  labels: TokenLabels;
}> {
  const wallet = await generateWalletHelper();
  const recipient = await generateWalletHelper();
  const funder = await startFunder();

  const tokenResponse = await createTokenHelper(funder, 'Shape Custom', 'SHC', 100n, {
    address: await legacyAddr(funder, 1),
  });
  const custom: string = tokenResponse.hash;

  await fund(funder, wallet, [{ address: await legacyAddr(wallet, 0), value: 10n, token: custom }]);
  await fundShielded(funder, wallet, NATIVE_TOKEN_UID, shieldedHtr);
  if (publicHtr > 0n) {
    await GenesisWalletHelper.injectFunds(wallet, await legacyAddr(wallet, 1), publicHtr);
  }

  return {
    wallet,
    recipient,
    funder,
    custom,
    labels: { [NATIVE_TOKEN_UID]: 'HTR', [custom]: 'CUSTOM' },
  };
}
