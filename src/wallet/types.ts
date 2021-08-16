/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
}

export interface AddressInfoObject {
  address: string; // Address in base58
  index: number; // derivation index of the address
  error: string | undefined; // Optional error code when getting address info
}

export interface WalletStatusResponse {
  status: number; // Response status code
  data: WalletStatusResponseData;
}

export interface WalletStatusResponseData {
  success: boolean;
  status: WalletStatus;
}

export interface WalletStatus {
  walletId: string; // wallet service id of the wallet
  xpubkey: string; // xpubkey of the wallet
  status: string; // wallet ready status (creating, ready, error)
  maxGap: number; // gap limit of the wallet
  createdAt: number; // wallet creation timestamp
  readyAt: number | null; // wallet timestamp when it got ready
}

export interface AddressesResponse {
  status: number; // Response status code
  data: AddressesResponseData;
}

export interface AddressesResponseData {
  success: boolean;
  addresses: GetAddressesObject[];
}

export interface AddressesToUseResponse {
  status: number; // Response status code
  data: AddressesToUseResponseData;
}

export interface AddressesToUseResponseData {
  success: boolean;
  addresses: AddressInfoObject[];
}

export interface BalanceResponse {
  status: number; // Response status code
  data: BalanceResponseData;
}

export interface BalanceResponseData {
  success: boolean;
  balances: GetBalanceObject[];
}

export interface HistoryResponse {
  status: number; // Response status code
  data: HistoryResponseData;
}

export interface HistoryResponseData {
  success: boolean;
  history: GetHistoryObject[];
}

export interface TxProposalCreateResponse {
  status: number; // Response status code
  data: TxProposalCreateResponseData;
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

export interface TxProposalUpdateResponse {
  status: number; // Response status code
  data: TxProposalUpdateResponseData;
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