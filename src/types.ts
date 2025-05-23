/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Config } from './config';
import Transaction from './models/transaction';
import Input from './models/input';
import FullNodeConnection from './new/connection';

/**
 * Logger interface where each method is a leveled log method.
 */
export interface ILogger {
  debug: (...args) => void;
  info: (...args) => void;
  warn: (...args) => void;
  error: (...args) => void;
}

/**
 * Get the default logger instance, the console
 */
export function getDefaultLogger(): ILogger {
  return console as ILogger;
}

export type OutputValueType = bigint;

export interface ITxSignatureData {
  ncCallerSignature: Buffer | null;
  inputSignatures: IInputSignature[];
}

export interface IInputSignature {
  inputIndex: number;
  addressIndex: number;
  signature: Buffer;
  pubkey: Buffer;
}

export enum HistorySyncMode {
  POLLING_HTTP_API = 'polling-http-api',
  MANUAL_STREAM_WS = 'manual-stream-ws',
  XPUB_STREAM_WS = 'xpub-stream-ws',
}

/**
 * This is the method signature for a method that signs a transaction and
 * returns an array with signature information.
 */
export type EcdsaTxSign = (
  tx: Transaction,
  storage: IStorage,
  pinCode: string
) => Promise<ITxSignatureData>;

export type HistorySyncFunction = (
  startIndex: number,
  count: number,
  storage: IStorage,
  connection: FullNodeConnection,
  shouldProcessHistory?: boolean
) => Promise<void>;

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
  numTransactions: number;
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
  locked: OutputValueType;
  unlocked: OutputValueType;
}

export interface IAuthoritiesBalance {
  mint: ITokenBalance;
  melt: ITokenBalance;
}

export interface IHistoryNanoContractActionWithdrawal {
  type: 'withdrawal';
  token_uid: string;
  amount: OutputValueType;
}

export interface IHistoryNanoContractActionDeposit {
  type: 'deposit';
  token_uid: string;
  amount: OutputValueType;
}

export interface IHistoryNanoContractActionGrantAuthority {
  type: 'GRANT_AUTHORITY';
  token_uid: string;
  mint: boolean;
  melt: boolean;
}

export interface IHistoryNanoContractActionInvokeAuthority {
  type: 'INVOKE_AUTHORITY';
  token_uid: string;
  mint: boolean;
  melt: boolean;
}

export type IHistoryNanoContractAction =
  | IHistoryNanoContractActionDeposit
  | IHistoryNanoContractActionWithdrawal
  | IHistoryNanoContractActionGrantAuthority
  | IHistoryNanoContractActionInvokeAuthority;

export interface IHistoryNanoContractContext {
  actions: IHistoryNanoContractAction[];
  address: string;
  timestamp: number;
}

export interface IHistoryTx {
  tx_id: string;
  signalBits?: number;
  version: number;
  weight: number;
  timestamp: number;
  is_voided: boolean;
  nonce?: number;
  inputs: IHistoryInput[];
  outputs: IHistoryOutput[];
  parents: string[];
  token_name?: string; // For create token transaction
  token_symbol?: string; // For create token transaction
  tokens?: string[];
  height?: number;
  processingStatus?: TxHistoryProcessingStatus;
  nc_id?: string; // For nano contract
  nc_blueprint_id?: string; // For nano contract
  nc_method?: string; // For nano contract
  nc_args?: string; // For nano contract. Args in hex
  nc_address?: string; // For nano contract. address in base58
  nc_pubkey?: string; // For on-chain-blueprints. pubkey DER encoded as hex
  nc_context?: IHistoryNanoContractContext;
  first_block?: string | null;
}

export enum TxHistoryProcessingStatus {
  PROCESSING = 'processing',
  FINISHED = 'finished',
}

export interface IHistoryInput {
  value: OutputValueType;
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
  value: OutputValueType;
  token_data: number;
  script: string;
  decoded: IHistoryOutputDecoded;
  token: string;
  spent_by: string | null;
  selected_as_input?: boolean;
}

export interface IDataOutputData {
  type: 'data';
  token: string;
  value: OutputValueType;
  authorities: OutputValueType;
  data: string;
}

export function isDataOutputData(output: IDataOutput): output is IDataOutputData {
  return output.type === 'data';
}

export interface IDataOutputAddress {
  type: 'p2pkh' | 'p2sh';
  token: string;
  value: OutputValueType;
  authorities: OutputValueType;
  address: string;
  timelock: number | null;
}

export function isDataOutputAddress(output: IDataOutput): output is IDataOutputAddress {
  return ['p2pkh', 'p2sh'].includes(output.type);
}

// This is for create token transactions, where we dont have a token uid yet
export interface IDataOutputCreateToken {
  type: 'mint' | 'melt';
  value: OutputValueType;
  address: string;
  timelock: number | null;
  authorities: OutputValueType;
}

export function isDataOutputCreateToken(output: IDataOutput): output is IDataOutputCreateToken {
  return ['mint', 'melt'].includes(output.type);
}

export interface IDataOutputOptionals {
  isChange?: boolean;
}

export type IDataOutput = (IDataOutputData | IDataOutputAddress | IDataOutputCreateToken) &
  IDataOutputOptionals;

export interface IDataInput {
  txId: string;
  index: number;
  value: OutputValueType;
  authorities: OutputValueType;
  token: string;
  address: string;
  data?: string;
}

// XXX: This type is meant to be used as an intermediary for building transactions
// It should have everything we need to build and push transactions.
export interface IDataTx {
  signalBits?: number;
  version?: number;
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
  value: OutputValueType;
  authorities: OutputValueType;
  timelock: number | null;
  type: number; // tx.version, is the value of the transaction version byte
  height: number | null; // only for block outputs
}

export interface ILockedUtxo {
  tx: IHistoryTx;
  index: number;
}

export enum WalletType {
  P2PKH = 'p2pkh',
  MULTISIG = 'multisig',
}

export enum WALLET_FLAGS {
  READONLY = 0b00000001,
  HARDWARE = 0b00000010,
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

export enum SCANNING_POLICY {
  GAP_LIMIT = 'gap-limit',
  INDEX_LIMIT = 'index-limit',
}

export interface IGapLimitAddressScanPolicy {
  policy: SCANNING_POLICY.GAP_LIMIT;
  gapLimit: number;
}

export interface IIndexLimitAddressScanPolicy {
  policy: SCANNING_POLICY.INDEX_LIMIT;
  startIndex: number;
  endIndex: number;
}

/**
 * This is a request from the scanning policy to load `count` addresses starting from nextIndex.
 */
export interface IScanPolicyLoadAddresses {
  nextIndex: number;
  count: number;
}

export type AddressScanPolicy = SCANNING_POLICY.GAP_LIMIT | SCANNING_POLICY.INDEX_LIMIT;

export type AddressScanPolicyData = IGapLimitAddressScanPolicy | IIndexLimitAddressScanPolicy;

export function isGapLimitScanPolicy(
  scanPolicyData: AddressScanPolicyData
): scanPolicyData is IGapLimitAddressScanPolicy {
  return scanPolicyData.policy === SCANNING_POLICY.GAP_LIMIT;
}

export function isIndexLimitScanPolicy(
  scanPolicyData: AddressScanPolicyData
): scanPolicyData is IIndexLimitAddressScanPolicy {
  return scanPolicyData.policy === SCANNING_POLICY.INDEX_LIMIT;
}

export interface IWalletData {
  lastLoadedAddressIndex: number;
  lastUsedAddressIndex: number;
  currentAddressIndex: number;
  bestBlockHeight: number;
  scanPolicyData: AddressScanPolicyData;
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
  authorities?: OutputValueType; // default to 0 (funds)
  max_utxos?: number; // default to unlimited
  filter_address?: string;
  target_amount?: OutputValueType;
  max_amount?: OutputValueType;
  amount_smaller_than?: OutputValueType;
  amount_bigger_than?: OutputValueType;
  only_available_utxos?: boolean;
  filter_method?: (utxo: IUtxo) => boolean;
  reward_lock?: number;
  // Will order utxos by value, asc or desc
  // If not set, will not order
  order_by_value?: 'asc' | 'desc';
}

export type UtxoSelectionAlgorithm = (
  storage: IStorage,
  token: string,
  amount: OutputValueType
) => Promise<{ utxos: IUtxo[]; amount: OutputValueType; available?: OutputValueType }>;

export interface IUtxoSelectionOptions {
  token?: string;
  changeAddress?: string;
  chooseInputs?: boolean;
  utxoSelectionMethod?: UtxoSelectionAlgorithm;
}

export interface IFillTxOptions {
  changeAddress?: string;
  skipAuthorities?: boolean;
  chooseInputs?: boolean;
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
  decimal_places: number;
  native_token: Omit<ITokenData, 'uid'> | null | undefined;
}

export interface IStore {
  validate(): Promise<void>;
  preProcessHistory(): Promise<void>;
  // Address methods
  addressIter(): AsyncGenerator<IAddressInfo>;
  getAddress(base58: string): Promise<IAddressInfo | null>;
  getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
  getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
  saveAddress(info: IAddressInfo): Promise<void>;
  addressExists(base58: string): Promise<boolean>;
  addressCount(): Promise<number>;
  editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void>;

  // tx history methods
  historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx>;
  saveTx(tx: IHistoryTx): Promise<void>;
  getTx(txId: string): Promise<IHistoryTx | null>;
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
  deleteUtxo(utxoId: IUtxo): Promise<void>;

  // Wallet data
  getAccessData(): Promise<IWalletAccessData | null>;
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
  getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
  getScanningPolicy(): Promise<AddressScanPolicy>;
  setScanningPolicyData(data: AddressScanPolicyData): Promise<void>;
  getScanningPolicyData(): Promise<AddressScanPolicyData>;

  // Nano Contract methods
  isNanoContractRegistered(ncId: string): Promise<boolean>;
  registeredNanoContractsIter(): AsyncGenerator<INcData>;
  getNanoContract(ncId: string): Promise<INcData | null>;
  registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
  unregisterNanoContract(ncId: string): Promise<void>;
  updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;

  // Generic storage keys
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;

  cleanStorage(
    cleanHistory?: boolean,
    cleanAddresses?: boolean,
    cleanTokens?: boolean
  ): Promise<void>;
  cleanMetadata(): Promise<void>;
}

export interface IStorage {
  // the actual storage of data
  store: IStore;
  config: Config;
  version: ApiVersion | null;
  logger: ILogger;

  setApiVersion(version: ApiVersion): void;
  getDecimalPlaces(): number;
  saveNativeToken(): Promise<void>;
  getNativeTokenData(): ITokenData;
  setLogger(logger: ILogger): void;

  hasTxSignatureMethod(): boolean;
  setTxSignatureMethod(txSign: EcdsaTxSign): void;
  getTxSignatures(tx: Transaction, pinCode: string): Promise<ITxSignatureData>;

  // Address methods
  getAllAddresses(): AsyncGenerator<IAddressInfo & IAddressMetadata>;
  getAddressInfo(base58: string): Promise<(IAddressInfo & IAddressMetadata) | null>;
  getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
  getAddressPubkey(index: number): Promise<string>;
  saveAddress(info: IAddressInfo): Promise<void>;
  isAddressMine(base58: string): Promise<boolean>;
  getCurrentAddress(markAsUsed?: boolean): Promise<string>;
  getChangeAddress(options?: { changeAddress?: null | string }): Promise<string>;

  // Transaction methods
  txHistory(): AsyncGenerator<IHistoryTx>;
  tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx>;
  getTx(txId: string): Promise<IHistoryTx | null>;
  getSpentTxs(inputs: Input[]): AsyncGenerator<{ tx: IHistoryTx; input: Input; index: number }>;
  addTx(tx: IHistoryTx): Promise<void>;
  processHistory(): Promise<void>;
  processNewTx(tx: IHistoryTx): Promise<void>;

  // Tokens
  addToken(data: ITokenData): Promise<void>;
  isTokenRegistered(tokenUid: string): Promise<boolean>;
  registerToken(token: ITokenData): Promise<void>;
  unregisterToken(tokenUid: string): Promise<void>;
  getToken(uid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
  getAllTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
  getRegisteredTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;

  // UTXOs
  getAllUtxos(): AsyncGenerator<IUtxo>;
  selectUtxos(options: Omit<IUtxoFilterOptions, 'reward_lock'>): AsyncGenerator<IUtxo>;
  fillTx(
    token: string,
    tx: IDataTx,
    options: IFillTxOptions
  ): Promise<{ inputs: IDataInput[]; outputs: IDataOutput[] }>;
  utxoSelectAsInput(utxo: IUtxoId, markAs: boolean, ttl?: number): Promise<void>;
  isUtxoSelectedAsInput(utxo: IUtxoId): Promise<boolean>;
  utxoSelectedAsInputIter(): AsyncGenerator<IUtxoId>;
  unlockUtxos(height: number): Promise<void>;
  processLockedUtxos(height: number): Promise<void>;

  // Wallet operations
  getAccessData(): Promise<IWalletAccessData | null>;
  saveAccessData(data: IWalletAccessData): Promise<void>;
  getMainXPrivKey(pinCode: string): Promise<string>;
  getAcctPathXPrivKey(pinCode: string): Promise<string>;
  getAuthPrivKey(pinCode: string): Promise<string>;
  getWalletData(): Promise<IWalletData>;
  getWalletType(): Promise<WalletType>;
  getCurrentHeight(): Promise<number>;
  setCurrentHeight(height: number): Promise<void>;
  isReadonly(): Promise<boolean>;
  changePin(oldPin: string, newPin: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  setGapLimit(value: number): Promise<void>;
  getGapLimit(): Promise<number>;
  getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
  cleanStorage(
    cleanHistory?: boolean,
    cleanAddresses?: boolean,
    cleanTokens?: boolean
  ): Promise<void>;
  handleStop(options: {
    connection?: FullNodeConnection;
    cleanStorage?: boolean;
    cleanAddresses?: boolean;
  }): Promise<void>;
  getTokenDepositPercentage(): number;
  checkPin(pinCode: string): Promise<boolean>;
  checkPassword(password: string): Promise<boolean>;
  isHardwareWallet(): Promise<boolean>;
  getScanningPolicy(): Promise<AddressScanPolicy>;
  getScanningPolicyData(): Promise<AddressScanPolicyData>;
  setScanningPolicyData(data: AddressScanPolicyData | null): Promise<void>;

  // Nano Contract methods
  isNanoContractRegistered(ncId: string): Promise<boolean>;
  getRegisteredNanoContracts(): AsyncGenerator<INcData>;
  getNanoContract(ncId: string): Promise<INcData | null>;
  registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
  unregisterNanoContract(ncId: string): Promise<void>;
  updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
}

export interface AddressIndexValidateResponse {
  firstIndex: number;
  lastIndex: number;
}

export interface HistoryIndexValidateResponse {
  count: number;
}

export interface INcData {
  ncId: string;
  address: string;
  blueprintId: string;
  blueprintName: string;
}
