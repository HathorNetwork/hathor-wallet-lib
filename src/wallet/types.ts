/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import bitcore from 'bitcore-lib';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import SendTransactionWalletService from './sendTransactionWalletService';
import Input from '../models/input';
import Output from '../models/output';
import { OutputValueType } from '../types';

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
  unlocked: OutputValueType; // Available amount
  locked: OutputValueType; // Locked amount
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
  balance: OutputValueType; // Balance of this tx in this wallet (can be negative)
  timestamp: number; // Transaction timestamp
  voided: boolean; // If transaction is voided
  version: number; // Transaction version
}

export interface AddressInfoObject {
  address: string; // Address in base58
  index: number; // derivation index of the address
  addressPath: string; // Path of the address
  info?: string | undefined; // Optional extra info when getting address info
}

export interface WalletStatusResponseData {
  success: boolean;
  status: WalletStatus;
  error?: string | undefined; // Optional error code when there is a problem creating the wallet
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

export interface CheckAddressesMineResponseData {
  success: boolean;
  addresses: WalletAddressMap;
}

export interface NewAddressesResponseData {
  success: boolean;
  addresses: AddressInfoObject[];
}

export interface BalanceResponseData {
  success: boolean;
  balances: GetBalanceObject[];
}

export interface TokenDetailsResponseData {
  success: boolean;
  details: TokenDetailsObject;
}

export interface TokenDetailsAuthoritiesObject {
  mint: boolean;
  melt: boolean;
}

export interface TokenDetailsObject {
  tokenInfo: TokenInfo;
  totalSupply: OutputValueType;
  totalTransactions: number;
  authorities: TokenDetailsAuthoritiesObject;
}

export interface HistoryResponseData {
  success: boolean;
  history: GetHistoryObject[];
}

export interface TxProposalCreateResponseData {
  success: boolean;
  txProposalId: string; // Id of the tx proposal
  inputs: TxProposalInputs[]; // Inputs data of the tx proposal
}

export interface TxProposalInputs {
  txId: string; // tx id of the input
  index: number; // index of the input
  addressPath: string; // derivation path of the output address being spent
}

export interface TxProposalOutputs {
  address: string; // output address
  value: OutputValueType; // output value
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

export interface TxOutputResponseData {
  success: boolean;
  txOutputs: Utxo[];
}

export interface Utxo {
  txId: string; // output transaction id
  index: number; // output index
  tokenId: string; // output token
  address: string; // output address
  value: OutputValueType; // output value
  authorities: OutputValueType; // 0 for no authority, 1 for mint authority and 2 for melt authority
  timelock: number | null; // output timelock
  heightlock: number | null; // output heightlock
  locked: boolean; // if output is locked
  addressPath: string; // path to generate output address
}

export interface AuthorityTxOutput {
  txId: string; // output transaction id
  index: number; // output index
  address: string; // output address
  authorities: OutputValueType; // output authorities
}

export interface AuthTokenResponseData {
  success: boolean;
  token: string; // jwt token
}

export interface OutputRequestObj {
  address: string; // output address
  value: OutputValueType; // output value
  token: string; // output token
  timelock?: number | null; // output timelock
}

export interface DataScriptOutputRequestObj {
  type: 'data'; // output type
  data: string; // data to store in the output script
}

// This is the output object to be used in the SendTransactionWalletService class
export interface OutputSendTransaction {
  type: string; // output type (in this case will be 'data')
  value: OutputValueType; // output value. Optional because we add fixed value of 1 to the output.
  token: string; // output token. Optional because we add fixed value of HTR token to the output.
  address?: string; // output address. required for p2pkh or p2sh
  timelock?: number | null; // output timelock
  data?: string; // data to store in the output script. required for data script.
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

export interface WalletAddressMap {
  [address: string]: boolean;
}

export interface TokenAmountMap {
  [token: string]: OutputValueType; // For each token we have the amount
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

export interface IStopWalletParams {
  cleanStorage?: boolean;
  cleanAddresses?: boolean;
}

export interface DelegateAuthorityOptions {
  anotherAuthorityAddress: string | null;
  createAnother: boolean;
  pinCode: string | null;
}

export interface DestroyAuthorityOptions {
  pinCode: string | null;
}

export interface IHathorWallet {
  start(options: { pinCode: string; password: string }): Promise<void>;
  getAllAddresses(): AsyncGenerator<GetAddressesObject>;
  getBalance(token: string | null): Promise<GetBalanceObject[]>;
  getTokens(): Promise<string[]>;
  getTxHistory(options: {
    token_id?: string;
    count?: number;
    skip?: number;
  }): Promise<GetHistoryObject[]>;
  sendManyOutputsTransaction(
    outputs: OutputRequestObj[],
    options: { inputs?: InputRequestObj[]; changeAddress?: string }
  ): Promise<Transaction>;
  sendTransaction(
    address: string,
    value: OutputValueType,
    options: { token?: string; changeAddress?: string }
  ): Promise<Transaction>;
  stop(params?: IStopWalletParams): void;
  getAddressAtIndex(index: number): Promise<string>;
  getCurrentAddress(options: { markAsUsed: boolean }): AddressInfoObject;
  getNextAddress(): AddressInfoObject;
  getAddressPrivKey(pinCode: string, addressIndex: number): Promise<bitcore.PrivateKey>;
  signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string>;
  prepareCreateNewToken(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options
  ): Promise<CreateTokenTransaction>;
  createNewToken(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options
  ): Promise<Transaction>;
  createNFT(
    name: string,
    symbol: string,
    amount: OutputValueType,
    data: string,
    options
  ): Promise<Transaction>;
  prepareMintTokensData(token: string, amount: OutputValueType, options): Promise<Transaction>;
  mintTokens(token: string, amount: OutputValueType, options): Promise<Transaction>;
  prepareMeltTokensData(token: string, amount: OutputValueType, options): Promise<Transaction>;
  meltTokens(token: string, amount: OutputValueType, options): Promise<Transaction>;
  prepareDelegateAuthorityData(
    token: string,
    type: string,
    address: string,
    options: DelegateAuthorityOptions
  ): Promise<Transaction>;
  delegateAuthority(
    token: string,
    type: string,
    address: string,
    options: DelegateAuthorityOptions
  ): Promise<Transaction>;
  prepareDestroyAuthorityData(
    token: string,
    type: string,
    count: number,
    options: DestroyAuthorityOptions
  ): Promise<Transaction>;
  destroyAuthority(
    token: string,
    type: string,
    count: number,
    options: DestroyAuthorityOptions
  ): Promise<Transaction>;
  getFullHistory(): TransactionFullObject[];
  getTxBalance(tx: WsTransaction, optionsParams): Promise<{ [tokenId: string]: OutputValueType }>;
  onConnectionChangedState(newState: ConnectionState): void;
  getTokenDetails(tokenId: string): Promise<TokenDetailsObject>;
  getVersionData(): Promise<FullNodeVersionData>;
  checkAddressesMine(addresses: string[]): Promise<WalletAddressMap>;
  getFullTxById(txId: string): Promise<FullNodeTxResponse>;
  getTxConfirmationData(txId: string): Promise<FullNodeTxConfirmationDataResponse>;
  graphvizNeighborsQuery(txId: string, graphType: string, maxLevel: number): Promise<string>;
  checkPin(pin: string): Promise<boolean>;
  checkPassword(password: string): Promise<boolean>;
  checkPinAndPassword(pin: string, password: string): Promise<boolean>;
}

export interface ISendTransaction {
  run(until: string | null): Promise<Transaction>;
  runFromMining(until: string | null): Promise<Transaction>;
}

export interface MineTxSuccessData {
  nonce: number;
  weight: number;
  timestamp: number;
  parents: string[];
}

export interface DecodedOutput {
  type: string;
  address: string;
  timelock: number | null;
}

export interface TxOutput {
  value: OutputValueType;
  script: {
    type: 'Buffer';
    data: number[];
  };
  token: string;
  decoded: DecodedOutput;
  token_data: number;
  locked: boolean;
  index: number;
  tokenData: number;
  decodedScript: null;
}

export interface TxInput {
  // eslint-disable-next-line camelcase
  tx_id: string;
  index: number;
  value: OutputValueType;
  // eslint-disable-next-line camelcase
  token_data: number;
  script: {
    type: 'Buffer';
    data: number[];
  };
  token: string;
  decoded: DecodedOutput;
}

export interface WsTransaction {
  // eslint-disable-next-line camelcase
  tx_id: string;
  nonce: number;
  timestamp: number;
  // eslint-disable-next-line camelcase
  signal_bits: number;
  version: number;
  weight: number;
  parents: string[];
  inputs: TxInput[];
  outputs: TxOutput[];
  height?: number;
  // eslint-disable-next-line camelcase
  token_name?: string;
  // eslint-disable-next-line camelcase
  token_symbol?: string;
}

export interface CreateWalletAuthData {
  xpub: bitcore.HDPublicKey;
  xpubkeySignature: string;
  authXpub: string;
  authXpubkeySignature: string;
  timestampNow: number;
  firstAddress: string;
  authDerivedPrivKey: bitcore.HDPrivateKey;
}

export interface FullNodeVersionData {
  timestamp: number;
  version: string;
  network: string;
  minWeight: number;
  minTxWeight: number;
  minTxWeightCoefficient: number;
  minTxWeightK: number;
  tokenDepositPercentage: number;
  rewardSpendMinBlocks: number;
  maxNumberInputs: number;
  maxNumberOutputs: number;
}

export interface TxByIdTokenData {
  txId: string;
  timestamp: number;
  version: number;
  voided: boolean;
  height?: number | null;
  weight: number;
  balance: bigint;
  tokenId: string;
  tokenName: string;
  tokenSymbol: string;
}

export interface TxByIdTokensResponseData {
  success: boolean;
  txTokens: TxByIdTokenData[];
}

export interface WalletServiceServerUrls {
  walletServiceBaseUrl: string;
  walletServiceWsUrl: string;
}

export enum ConnectionState {
  CLOSED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
}

export enum OutputType {
  P2PKH = 'p2pkh',
  P2SH = 'p2sh',
  DATA = 'data',
}

export interface FullNodeToken {
  uid: string;
  // Hathor will return name: null and symbol: null
  name: string | null;
  symbol: string | null;
}

export interface FullNodeDecodedInput {
  type: string;
  address: string;
  timelock?: number | null;
  value: OutputValueType;
  token_data: number;
}

export interface FullNodeDecodedOutput {
  type: string;
  address?: string;
  timelock?: number | null;
  value: OutputValueType;
  token_data?: number;
}

export interface FullNodeInput {
  value: OutputValueType;
  token_data: number;
  script: string;
  decoded: FullNodeDecodedInput;
  tx_id: string;
  index: number;
  token?: string | null;
  spent_by?: string | null;
}

export interface FullNodeOutput {
  value: OutputValueType;
  token_data: number;
  script: string;
  decoded: FullNodeDecodedOutput;
  token?: string | null;
  spent_by?: string | null;
}

export interface FullNodeTx {
  hash: string;
  nonce: string;
  timestamp: number;
  version: number;
  weight: number;
  parents: string[];
  inputs: FullNodeInput[];
  outputs: FullNodeOutput[];
  tokens: FullNodeToken[];
  token_name?: string | null;
  token_symbol?: string | null;
  raw: string;
}

export interface FullNodeMeta {
  hash: string;
  spent_outputs: Array<[number, Array<string>]>;
  received_by: string[];
  children: string[];
  conflict_with: string[];
  voided_by: string[];
  twins: string[];
  accumulated_weight: number;
  score: number;
  height: number;
  validation?: string;
  first_block?: string | null;
  first_block_height?: number | null;
}

export interface FullNodeTxResponse {
  tx: FullNodeTx;
  meta: FullNodeMeta;
  success: boolean;
  message?: string;
  spent_outputs?: Record<string, string>;
}

export interface FullNodeTxConfirmationDataResponse {
  success: boolean;
  accumulated_weight: number;
  accumulated_bigger: boolean;
  stop_value: number;
  confirmation_level: number;
}
