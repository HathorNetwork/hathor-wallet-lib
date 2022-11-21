/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// import Output from "../../models/output";
import Input from "./models/input";
import Transaction from "./models/transaction";

export interface IStorageAddress {
  base58: string;
  bip32AddressIndex: number;
  publicKey?: string;
  numTransactions?: number;
}

export interface IStorageToken {
  uid: string;
  name: string;
  symbol: string;
}

export interface IStorageTokenMetadata {
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

// XXX
export interface IStorageTx {
  tx_id: string;
  version: number;
  weight: number;
  timestamp: number;
  is_voided: boolean;
  parents: string[];
  inputs: IStorageInput[];
  outputs: IStorageOutput[];
}

export interface IStorageInput {
  tx_id: string;
  index: number;
  token: string;
  token_data: number;
  value: number;
  script: string;
  decoded: IStorageOutputDecoded;
}

// Obs: this will change with nano contracts
export interface IStorageOutputDecoded {
  type: string;
  address: string;
  timelock: number|null;
}

export interface IStorageOutput {
  token: string;
  token_data: number;
  value: number;
  script: string;
  decoded: IStorageOutputDecoded;
  spent_by: string|null;
}

export interface UtxoId {
  txId: string;
  index: number;
}

export interface IStorageUTXO {
  txId: string;
  index: number;
  token: string;
  value: number;
  authorities: number;
  address: string;
  type: number; // tx.version, used to identify block and transaction utxos
  timelock: number;
  heightlock: number; // only for blocks
}

export interface IStorageWalletData {
  xpubkey: string;
  mainKey?: IStorageEncryptedData; // encrypted xprivkey (uses pin for encryption)
  words?: IStorageEncryptedData; // encrypted seed (uses password for encryption)
  authKey?: IStorageEncryptedData; // encrypted auth key, used for authentication with wallet-service (uses pin for encryption)
  multisigData?: IMultisigData;
  // When starting wallet in unsafe mode:
  xprivkey?: string;
  authprivkey?: string;
}

export interface IStorageEncryptedData {
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
  max_utxos?: number; // default to 255 (MAX_INPUTS)
  filter_address?: string;
  target_amount?: number;
  max_amount?: number;
  amount_smaller_than?: number;
  amount_bigger_than?: number;
}

export interface IStorage {
  // Address methods
  addressIter(): AsyncGenerator<IStorageAddress>;
  getAddress(base58: string): Promise<IStorageAddress|null>;
  getAddressAtIndex(index: number): Promise<IStorageAddress>;
  saveAddress(info: IStorageAddress): Promise<void>;
  updateAddress(base58: string, options: {numTransactions: number}): Promise<void>;
  addressExists(base58: string): Promise<boolean>;

  // tx history methods
  historyIter(tokenUid?: string): AsyncGenerator<IStorageTx>;
  saveTx(tx: IStorageTx): Promise<void>;
  getTx(txId: string): Promise<IStorageTx|null>;

  // Tokens methods
  tokenIter(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>>;
  registeredTokenIter(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>>;
  getToken(tokenUid: string): Promise<(IStorageToken & Partial<IStorageTokenMetadata>) | null>;
  saveToken(tokenConfig: IStorageToken, meta?: IStorageTokenMetadata): Promise<void>;
  registerToken(token: IStorageToken): Promise<void>;
  unregisterToken(tokenUid: string): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
  editToken(tokenUid: string, meta: IStorageTokenMetadata): Promise<void>;

  // UTXOs methods
  utxoIter(): AsyncGenerator<IStorageUTXO>;
  selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IStorageUTXO>;
  saveUtxo(utxo: IStorageUTXO): Promise<void>;

  // Wallet data
  getAccessData(): Promise<IStorageWalletData|null>;
  saveAccessData(data: IStorageWalletData): Promise<void>;
  getLastLoadedAddressIndex(): Promise<number>;
  getLastUsedAddressIndex(): Promise<number>;

  // Generic storage keys
  getItem(key: string): Promise<any>;
  setItem(key: string, value: any): Promise<void>;
}

export interface IStore {
  // the actual storage of data
  storage: IStorage;

  // Address methods
  getAllAddresses(): AsyncGenerator<IStorageAddress>;
  getAddressInfo(base58: string): Promise<IStorageAddress|null>;
  getAddressAtIndex(index: number): Promise<IStorageAddress>;
  saveAddress(info: IStorageAddress): Promise<void>;
  isAddressMine(base58: string): Promise<boolean>;

  // Transaction methods
  txHistory(): AsyncGenerator<IStorageTx>;
  tokenHistory(tokenUid?: string): AsyncGenerator<IStorageTx>;
  getTx(txId: string): Promise<IStorageTx|null>;
  getSpentTxs(inputs: Input[]): AsyncGenerator<IStorageTx>;
  addTx(tx: IStorageTx): Promise<void>;

  // Tokens
  addToken(data: IStorageToken): Promise<void>;
  editToken(tokenUid: string, meta: IStorageTokenMetadata): Promise<void>;
  registerToken(token: IStorageToken): Promise<void>;
  unregisterToken(tokenUid: string): Promise<void>;
  getToken(uid: string): Promise<(IStorageToken & Partial<IStorageTokenMetadata>) | null>;
  getAllTokens(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>>;
  getRegisteredTokens(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>>;

  // UTXOs
  getAllUtxos(): AsyncGenerator<IStorageUTXO>;
  selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IStorageUTXO>;
  fillTx(tx: Transaction): Promise<void>;
  utxoSelectAsInput(utxo: IStorageUTXO, markAs: boolean, ttl?: number): void;

  // Wallet access data
  getAccessData(): Promise<IStorageWalletData|null>;
  saveAccessData(data: IStorageWalletData): Promise<void>;
}

