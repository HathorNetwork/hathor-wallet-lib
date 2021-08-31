/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import SendTransactionWalletService from './sendTransactionWalletService';
import Input from '../models/input';
import Output from '../models/output';

export interface GetAddressesObject {
  address: string; // Address in base58
  index: number; // derivation index of the address
  transactions: number; // quantity of transactions
}

export interface GetBalanceObject {
  token: TokenInfo; // Information about the token
  balance: Balance; // Balance information
  tokenAuthorities: AuthoritiesBalance; // Authorities mint/melt availability
  transactions: number; // quantity of transactions
  lockExpires: number | null; // When next lock expires, if has a timelock
}

export interface TokenInfo {
  id: string; // Token id
  name: string; // Token name
  symbol: string; // Token symbol
}

export interface Balance {
  unlocked: number; // Available amount
  locked: number; // Locked amount
}

export interface AuthoritiesBalance {
  unlocked: Authority; // unlocked mint/melt
  locked: Authority; // locked mint/melt
}

export interface Authority {
  mint: boolean; // if has mint authority
  melt: boolean; // if has melt authority
}

export interface GetHistoryObject {
  txId: string; // Transaction ID
  balance: number; // Balance of this tx in this wallet (can be negative)
  timestamp: number; // Transaction timestamp
  voided: boolean; // If transaction is voided
}

export interface AddressInfoObject {
  address: string; // Address in base58
  index: number; // derivation index of the address
  addressPath: string; // Path of the address
  info: string | undefined; // Optional extra info when getting address info
}

export interface WalletStatusResponseData {
  success: boolean;
  status: WalletStatus;
  error: string | undefined; // Optional error code when there is a problem creating the wallet
}

export interface WalletStatus {
  walletId: string; // wallet service id of the wallet
  xpubkey: string; // xpubkey of the wallet
  status: string; // wallet ready status (creating, ready, error)
  maxGap: number; // gap limit of the wallet
  createdAt: number; // wallet creation timestamp
  readyAt: number | null; // wallet timestamp when it got ready
}

export interface AddressesResponseData {
  success: boolean;
  addresses: GetAddressesObject[];
}

export interface NewAddressesResponseData {
  success: boolean;
  addresses: AddressInfoObject[];
}

export interface BalanceResponseData {
  success: boolean;
  balances: GetBalanceObject[];
}

export interface HistoryResponseData {
  success: boolean;
  history: GetHistoryObject[];
}

export interface TxProposalCreateResponseData {
  success: boolean;
  txProposalId: string; // Id of the tx proposal
  inputs: TxProposalInputs[]; // Inputs data of the tx proposal
  outputs: TxProposalOutputs[]; // Outputs data of the tx proposal
  tokens: string[];
}

export interface TxProposalInputs {
  txId: string; // tx id of the input
  index: number; // index of the input
  addressPath: string; // derivation path of the output address being spent
}

export interface TxProposalOutputs {
  address: string; // output address
  value: number; // output value
  token: string; // output token
  timelock: number | null; // output timelock
}

export interface TxProposalUpdateResponseData {
  success: boolean;
  txProposalId: string; // Id of the tx proposal
  txHex: string; // Hex of the serialized tx
}

export interface RequestError {
  success: boolean;
  error: string; // Error code
}

export interface InputRequestObject {
  txId: string; // tx id of the input
  index: number; // index of the input
}

export interface SendManyTxOptionsParam {
  inputs: InputRequestObject[] | undefined;
  changeAddress: string | undefined;
}

export interface SendTxOptionsParam {
  token: string | undefined;
  changeAddress: string | undefined;
}

export interface UtxoResponseData {
  success: boolean;
  utxos: Utxo[];
}

export interface Utxo {
  txId: string; // output transaction id
  index: number; // output index
  tokenId: string; // output token
  address: string; // output address
  value: number; // output value
  authorities: number; // 0 for no authority, 1 for mint authority and 2 for melt authority
  timelock: number | null; // output timelock
  heightlock: number | null; // output heightlock
  locked: boolean; // if output is locked
  addressPath: string; // path to generate output address
}

export interface AuthTokenResponseData {
  success: boolean;
  token: string; // jwt token
}

export interface OutputRequestObj {
  address: string; // output address
  value: number; // output value
  token: string; // output token
  timelock?: number | null; // output timelock
}

export interface InputRequestObj {
  txId: string; // transaction id of the output being spent
  index: number; // index of the output being spent using this input
}

export interface TokensResponseData {
  success: boolean;
  tokens: string[];
}

export interface SendTransactionEvents {
  success: boolean;
  sendTransaction: SendTransactionWalletService;
}

export interface SendTransactionResponse {
  success: boolean;
  transaction: Transaction;
}

export interface TokenAmountMap {
  [token: string]: number; // For each token we have the amount
}

export interface TransactionFullObject {
  tx_id: string;
  version: number;
  timestamp: number;
  is_voided: boolean;
  inputs: Input[];
  outputs: Output[];
  parents: string[];
}

export interface IHathorWallet {
  start();
  getAllAddresses(): AsyncGenerator<GetAddressesObject>;
  getBalance(token: string | null): Promise<GetBalanceObject[]>;
  getTokens(): Promise<string[]>;
  getTxHistory(options: { token_id?: string, count?: number, skip?: number }): Promise<GetHistoryObject[]>;
  sendManyOutputsTransaction(outputs: OutputRequestObj[], options: { inputs?: InputRequestObj[], changeAddress?: string }): Promise<Transaction>;
  sendTransaction(address: string, value: number, options: { token?: string, changeAddress?: string }): Promise<Transaction>;
  stop();
  getAddressAtIndex(index: number): string;
  getCurrentAddress({ markAsUsed: boolean }): AddressInfoObject;
  getNextAddress(): AddressInfoObject;
  prepareCreateNewToken(name: string, symbol: string, amount: number, options): Promise<CreateTokenTransaction>;
  createNewToken(name: string, symbol: string, amount: number, options): Promise<Transaction>;
  createNFT(name: string, symbol: string, amount: number, data: string, options): Promise<Transaction>;
  prepareMintTokensData(token: string, amount: number, options): Promise<Transaction>;
  mintTokens(token: string, amount: number, options): Promise<Transaction>;
  prepareMeltTokensData(token: string, amount: number, options): Promise<Transaction>;
  meltTokens(token: string, amount: number, options): Promise<Transaction>;
  prepareDelegateAuthorityData(token: string, type: string, address: string, options): Promise<Transaction>;
  delegateAuthority(token: string, type: string, address: string, options): Promise<Transaction>;
  prepareDestroyAuthorityData(token: string, type: string, count: number): Promise<Transaction>;
  destroyAuthority(token: string, type: string, count: number): Promise<Transaction>;
  getFullHistory(): TransactionFullObject[];
}

export interface ISendTransaction {
  run(until: string | null): Promise<Transaction>;
  runFromMining(until: string | null): Promise<Transaction>;
}