/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Config } from "./config";
import Input from "./models/input";
import FullNodeConnection from './new/connection';

export interface IAddressInfo {
  base58: string;
  bip32AddressIndex: number;
  // Only for p2pkh, undefined for multisig
  publicKey?: string;
}

export interface IAddressMetadata {
  numTransactions: number;
  balance: Map<string, IBalance>;
}

export interface IAddressMetadataAsRecord {
  numTransactions: number,
  balance: Record<string, IBalance>;
}

export interface ITokenData {
  uid: string;
  name: string;
  symbol: string;
}

export interface ITokenMetadata {
  numTransactions: number;
  balance: IBalance;
}

export interface IBalance {
  tokens: ITokenBalance;
  authorities: IAuthoritiesBalance;
}

export interface ITokenBalance {
  locked: number;
  unlocked: number;
}

export interface IAuthoritiesBalance {
  mint: ITokenBalance;
  melt: ITokenBalance;
}

export interface IHistoryTx {
  tx_id: string;
  version: number;
  weight: number;
  timestamp: number;
  is_voided: boolean;
  nonce: number,
  inputs: IHistoryInput[];
  outputs: IHistoryOutput[];
  parents: string[];
  token_name?: string; // For create token transaction
  token_symbol?: string; // For create token transaction
  tokens: string[];
  height?: number;
}

export interface IHistoryInput {
  value: number;
  token_data: number;
  script: string;
  decoded: IHistoryOutputDecoded;
  token: string;
  tx_id: string;
  index: number;
}

// Obs: this will change with nano contracts
export interface IHistoryOutputDecoded {
  type?: string;
  address?: string;
  timelock?: number | null;
  data?: string;
}

export interface IHistoryOutput {
  value: number;
  token_data: number;
  script: string;
  decoded: IHistoryOutputDecoded;
  token: string;
  spent_by: string | null;
}

export interface IDataOutputData {
  type: 'data';
  token: string;
  value: number;
  authorities: number;
  data: string;
};

export function isDataOutputData(output: IDataOutput): output is IDataOutputData {
  return output.type === 'data';
}

export interface IDataOutputAddress {
  type: 'p2pkh'|'p2sh';
  token: string;
  value: number;
  authorities: number;
  address: string;
  timelock: number | null;
}

export function isDataOutputAddress(output: IDataOutput): output is IDataOutputAddress {
  return ['p2pkh', 'p2sh'].includes(output.type);
}

// This is for create token transactions, where we dont have a token uid yet
export interface IDataOutputCreateToken {
  type: 'mint' | 'melt';
  value: number;
  address: string;
  timelock: number|null;
  authorities: number;
}

export function isDataOutputCreateToken(output: IDataOutput): output is IDataOutputCreateToken {
  return ['mint', 'melt'].includes(output.type);
}

export interface IDataOutputOptionals {
  isChange?: boolean;
}

export type IDataOutput = (IDataOutputData | IDataOutputAddress | IDataOutputCreateToken) & IDataOutputOptionals;

export interface IDataInput {
  txId: string;
  index: number;
  value: number;
  authorities: number;
  token: string;
  address: string;
  data?: string;
}

// XXX: This type is meant to be used as an intermediary for building transactions
// It should have everything we need to build and push transactions.
export interface IDataTx {
  version?: number,
  inputs: IDataInput[];
  outputs: IDataOutput[];
  tokens: string[];
  weight?: number;
  nonce?: number;
  timestamp?: number;
  parents?: string[];
  name?: string; // For create token transaction
  symbol?: string; // For create token transaction
}

export interface IUtxoId {
  txId: string;
  index: number;
}

export interface IUtxo {
  txId: string;
  index: number;
  token: string;
  address: string;
  value: number;
  authorities: number;
  timelock: number | null;
  type: number; // tx.version, is the value of the transaction version byte
  height: number | null; // only for block outputs
}

export interface ILockedUtxo {
  tx: IHistoryTx,
  index: number,
}

export enum WalletType {
  P2PKH = 'p2pkh',
  MULTISIG = 'multisig',
}

export enum WALLET_FLAGS {
  READONLY = 0b00000001,
}

export interface IWalletAccessData {
  xpubkey: string;
  mainKey?: IEncryptedData; // encrypted xprivkey (uses pin for encryption)
  acctPathKey?: IEncryptedData; // encrypted account path xprivkey (uses pin for encryption)
  words?: IEncryptedData; // encrypted seed (uses password for encryption)
  authKey?: IEncryptedData; // encrypted auth key, used for authentication with wallet-service (uses pin for encryption)
  multisigData?: IMultisigData;
  walletType: WalletType;
  walletFlags: number;
}

export interface IWalletData {
  lastLoadedAddressIndex: number;
  lastUsedAddressIndex: number;
  currentAddressIndex: number;
  bestBlockHeight: number;
  gapLimit: number;
}

export interface IEncryptedData {
  data: string;
  hash: string;
  salt: string;
  iterations: number;
  pbkdf2Hasher: string;
}

export interface IMultisigData {
  pubkey?: string;
  pubkeys: string[];
  numSignatures: number;
}

export interface IUtxoFilterOptions {
  token?: string; // default to HTR
  authorities?: number; // default to 0 (funds)
  max_utxos?: number; // default to unlimited
  filter_address?: string;
  target_amount?: number;
  max_amount?: number;
  amount_smaller_than?: number;
  amount_bigger_than?: number;
  only_available_utxos?: boolean;
  filter_method?: (utxo: IUtxo) => boolean;
  reward_lock?: number,
  // Will order utxos by value, asc or desc
  // If not set, will not order
  order_by_value?: 'asc' | 'desc';
}

export type UtxoSelectionAlgorithm = (storage: IStorage, token: string, amount: number) => Promise<{ utxos: IUtxo[], amount: number }>;

export interface IUtxoSelectionOptions {
  token?: string,
  changeAddress?: string,
  chooseInputs?: boolean,
  utxoSelectionMethod?: UtxoSelectionAlgorithm,
}

export interface IFillTxOptions {
  changeAddress?: string,
  skipAuthorities?: boolean,
  chooseInputs?: boolean,
}

export interface ApiVersion {
  version: string;
  network: string;
  // min_weight: number; // DEPRECATED
  min_tx_weight: number;
  min_tx_weight_coefficient: number;
  min_tx_weight_k: number;
  token_deposit_percentage: number;
  reward_spend_min_blocks: number;
  max_number_inputs: number;
  max_number_outputs: number;
}

export interface IStore {
  validate(): Promise<void>;
  // Address methods
  addressIter(): AsyncGenerator<IAddressInfo>;
  getAddress(base58: string): Promise<IAddressInfo|null>;
  getAddressMeta(base58: string): Promise<IAddressMetadata|null>;
  getAddressAtIndex(index: number): Promise<IAddressInfo|null>;
  saveAddress(info: IAddressInfo): Promise<void>;
  addressExists(base58: string): Promise<boolean>;
  addressCount(): Promise<number>;
  editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void>;

  // tx history methods
  historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx>;
  saveTx(tx: IHistoryTx): Promise<void>;
  getTx(txId: string): Promise<IHistoryTx|null>;
  historyCount(): Promise<number>;

  // Tokens methods
  tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
  registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
  getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
  getTokenMeta(tokenUid: string): Promise<ITokenMetadata | null>;
  saveToken(tokenConfig: ITokenData, meta?: ITokenMetadata): Promise<void>;
  registerToken(token: ITokenData): Promise<void>;
  unregisterToken(tokenUid: string): Promise<void>;
  isTokenRegistered(tokenUid: string): Promise<boolean>;
  editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void>;

  // UTXOs methods
  utxoIter(): AsyncGenerator<IUtxo>;
  selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo>;
  saveUtxo(utxo: IUtxo): Promise<void>;
  saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
  iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
  unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;

  // Wallet data
  getAccessData(): Promise<IWalletAccessData|null>;
  saveAccessData(data: IWalletAccessData): Promise<void>;
  getWalletData(): Promise<IWalletData>;
  getLastLoadedAddressIndex(): Promise<number>;
  getLastUsedAddressIndex(): Promise<number>;
  setLastUsedAddressIndex(index: number): Promise<void>;
  getCurrentHeight(): Promise<number>;
  setCurrentHeight(height: number): Promise<void>;
  getCurrentAddress(markAsUsed?: boolean): Promise<string>;
  setCurrentAddressIndex(index: number): Promise<void>;
  setGapLimit(value: number): Promise<void>;
  getGapLimit(): Promise<number>;

  // Generic storage keys
  getItem(key: string): Promise<any>;
  setItem(key: string, value: any): Promise<void>;

  cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean): Promise<void>;
  cleanMetadata(): Promise<void>;
}

export interface IStorage {
  // the actual storage of data
  store: IStore;
  config: Config;
  version: ApiVersion|null;

  // Address methods
  getAllAddresses(): AsyncGenerator<IAddressInfo & IAddressMetadata>;
  getAddressInfo(base58: string): Promise<(IAddressInfo & IAddressMetadata)|null>;
  getAddressAtIndex(index: number): Promise<IAddressInfo|null>;
  saveAddress(info: IAddressInfo): Promise<void>;
  isAddressMine(base58: string): Promise<boolean>;
  getCurrentAddress(markAsUsed?: boolean): Promise<string>;
  getChangeAddress(options?: {changeAddress?: null|string}): Promise<string>;

  // Transaction methods
  txHistory(): AsyncGenerator<IHistoryTx>;
  tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx>;
  getTx(txId: string): Promise<IHistoryTx|null>;
  getSpentTxs(inputs: Input[]): AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}>;
  addTx(tx: IHistoryTx): Promise<void>;
  processHistory(): Promise<void>;

  // Tokens
  isTokenRegistered(tokenUid: string): Promise<boolean>;
  registerToken(token: ITokenData): Promise<void>;
  unregisterToken(tokenUid: string): Promise<void>;
  getToken(uid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
  getAllTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
  getRegisteredTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;

  // UTXOs
  getAllUtxos(): AsyncGenerator<IUtxo>;
  selectUtxos(options: Omit<IUtxoFilterOptions, 'reward_lock'>): AsyncGenerator<IUtxo>;
  fillTx(token: string, tx: IDataTx, options: IFillTxOptions): Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>;
  utxoSelectAsInput(utxo: IUtxoId, markAs: boolean, ttl?: number): Promise<void>;
  isUtxoSelectedAsInput(utxo: IUtxoId): Promise<boolean>;
  utxoSelectedAsInputIter(): AsyncGenerator<IUtxoId>;
  unlockUtxos(height: number): Promise<void>;
  processLockedUtxos(height: number): Promise<void>;

  // Wallet operations
  getAccessData(): Promise<IWalletAccessData|null>;
  saveAccessData(data: IWalletAccessData): Promise<void>;
  getMainXPrivKey(pinCode: string): Promise<string>;
  getAcctPathXPrivKey(pinCode: string): Promise<string>;
  getAuthPrivKey(pinCode: string): Promise<string>;
  getWalletData(): Promise<IWalletData>;
  getWalletType(): Promise<WalletType>;
  getCurrentHeight(): Promise<number>;
  setCurrentHeight(height: number): Promise<void>;
  isReadonly(): Promise<boolean>;
  setApiVersion(version: ApiVersion): void;
  changePin(oldPin: string, newPin: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  setGapLimit(value: number): Promise<void>;
  getGapLimit(): Promise<number>;
  cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean): Promise<void>;
  handleStop(options: {connection?: FullNodeConnection, cleanStorage?: boolean, cleanAddresses?: boolean}): Promise<void>;
  getTokenDepositPercentage(): number;
}

/**
 */
export interface IKVStoreIndex<TValidate> {
  indexVersion: string;
  validate(): Promise<TValidate>;
  checkVersion(): Promise<void>;
  close(): Promise<void>;
}

export interface AddressIndexValidateResponse {
  firstIndex: number;
  lastIndex: number;
}

export interface IKVAddressIndex extends IKVStoreIndex<AddressIndexValidateResponse> {
  getAddressInfo(base58: string): Promise<IAddressInfo | null>;
  addressExists(base58: string): Promise<boolean>;
  addressIter(): AsyncGenerator<IAddressInfo>;
  setAddressMeta(uid: string, meta: IAddressMetadata): Promise<void>;
  getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
  getAddressAtIndex(index: number): Promise<string|null>;
  saveAddress(info: IAddressInfo): Promise<void>;
  addressCount(): Promise<number>;
  clearMeta(): Promise<void>;
  clear(): Promise<void>;
}

export interface HistoryIndexValidateResponse {
  count: number,
}

export interface IKVHistoryIndex extends IKVStoreIndex<HistoryIndexValidateResponse> {
  historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx>;
  getTx(txId: string): Promise<IHistoryTx|null>;
  saveTx(tx: IHistoryTx): Promise<void>;
  historyCount(): Promise<number>;
  clear(): Promise<void>;
}

export interface IKVUtxoIndex extends IKVStoreIndex<void> {
  utxoIter(): AsyncGenerator<IUtxo>;
  selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo>;
  saveUtxo(utxo: IUtxo): Promise<void>;
  saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
  iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
  unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
  clear(): Promise<void>;
}

export interface IKVTokenIndex extends IKVStoreIndex<void> {
  tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
  registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
  hasToken(tokenUid: string): Promise<boolean>;
  getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
  getTokenMetadata(tokenUid: string): Promise<ITokenMetadata|null>;
  saveToken(tokenConfig: ITokenData): Promise<void>;
  saveMetadata(uid: string, meta: ITokenMetadata): Promise<void>;
  registerToken(token: ITokenData): Promise<void>;
  unregisterToken(tokenUid: string): Promise<void>;
  isTokenRegistered(tokenUid: string): Promise<boolean>;
  deleteTokens(tokens: string[]): Promise<void>;
  editTokenMeta(tokenUid: string, meta: Partial<ITokenMetadata>): Promise<void>;
  clearMeta(): Promise<void>;
  clear(): Promise<void>;
}

export interface IKVWalletIndex extends IKVStoreIndex<void> {
  getAccessData(): Promise<IWalletAccessData|null>;
  saveAccessData(data: IWalletAccessData): Promise<void>;
  getWalletData(): Promise<IWalletData>;
  getLastLoadedAddressIndex(): Promise<number>;
  setLastLoadedAddressIndex(value: number): Promise<void>;
  getLastUsedAddressIndex(): Promise<number>;
  setLastUsedAddressIndex(value: number): Promise<void>;
  getCurrentHeight(): Promise<number>;
  setCurrentHeight(height: number): Promise<void>;
  setCurrentAddressIndex(value: number): Promise<void>;
  getCurrentAddressIndex(): Promise<number>;
  setGapLimit(value: number): Promise<void>;
  getGapLimit(): Promise<number>;

  getItem(key: string): Promise<any>;
  setItem(key: string, value: any): Promise<void>;

  cleanAccessData(): Promise<void>;
  cleanWalletData(clear: boolean): Promise<void>;
}
