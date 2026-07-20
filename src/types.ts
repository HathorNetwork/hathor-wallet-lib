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
import Header from './headers/base';
import type {
  IShieldedCryptoProvider,
  IShieldedOutput,
  IDataShieldedOutput,
} from './shielded/types';

/**
 * Token version used to identify the type of token during the token creation process.
 */
export enum TokenVersion {
  NATIVE = 0,

  DEPOSIT = 1,

  FEE = 2,
}

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
  // Address type of the signed input, so consumers can render the matching
  // derivation path. 'shielded-spend' inputs are signed with the spend chain
  // (m/44'/280'/2'); undefined/legacy use the P2PKH/P2SH chain.
  addressType?: AddressType | 'shielded-spend';
}

export enum HistorySyncMode {
  POLLING_HTTP_API = 'polling-http-api',
  MANUAL_STREAM_WS = 'manual-stream-ws',
  XPUB_STREAM_WS = 'xpub-stream-ws',
}

/**
 * Wallet state enum
 * Represents the current state of the HathorWallet instance
 */
export enum WalletState {
  /** Wallet is disconnected from the server */
  CLOSED = 0,
  /** Wallet is currently establishing a connection */
  CONNECTING = 1,
  /** Wallet is connected and syncing transaction history */
  SYNCING = 2,
  /** Wallet is synced and ready to be used */
  READY = 3,
  /** Wallet encountered an error */
  ERROR = 4,
  /** Wallet is performing an internal processing task */
  PROCESSING = 5,
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

/**
 * Method signature for an external provider that returns the private key for one of the
 * wallet's addresses (by derivation index). Registered by clients that hold no local key
 * (e.g. a passkey signer) so message and oracle-data signing can obtain a key on demand.
 * Returns a bitcore PrivateKey (typed as unknown here, matching the rest of the lib).
 */
export type PrivateKeyProvider = (
  addressIndex: number,
  storage: IStorage,
  options?: { pinCode?: string | null }
) => Promise<unknown>;

export type HistorySyncFunction = (
  startIndex: number,
  count: number,
  storage: IStorage,
  connection: FullNodeConnection,
  shouldProcessHistory?: boolean,
  // PIN code threaded so processHistory can derive the per-address scan key
  // and decrypt wallet-owned shielded outputs after the history loads.
  pinCode?: string
) => Promise<void>;

/**
 * Valid address types, as returned by `Address.getType()`:
 * the two legacy script types plus the 71-byte shielded address format.
 */
export type AddressType = 'p2pkh' | 'p2sh' | 'shielded';

export interface IAddressInfo {
  base58: string;
  bip32AddressIndex: number;
  // Only for p2pkh, undefined for multisig
  publicKey?: string;
  // Address type: undefined = legacy.
  // 'shielded' = the full 71-byte shielded address string (scan + spend pubkeys);
  //   it has no output script of its own and must NOT be passed to
  //   utils/address getAddressType(), which throws for it.
  // 'shielded-spend' = the on-chain P2PKH derived from HASH160(spend_pubkey);
  //   this is the form getAddressType()/script builders accept.
  addressType?: AddressType | 'shielded-spend';
  // Cross-link between the two records of a shielded address pair (which share
  // the same BIP32 index), so callers translate between them in O(1) without a
  // full-address scan or a parallel index map:
  //   - on a 'shielded' record       → the paired 'shielded-spend' P2PKH base58
  //   - on a 'shielded-spend' record → the paired 'shielded' (71-byte) base58
  // Undefined for legacy records. Set once when the pair is derived
  // (deriveShieldedAddressFromStorage), so `this.addresses` stays the single
  // source of truth for the mapping.
  ctMappingAddress?: string;
}

/**
 * Options for address methods that can operate on either the legacy or shielded address chain.
 * Defaults to legacy (true) for backward compatibility.
 */
export interface IAddressChainOptions {
  legacy?: boolean; // default: true
}

/**
 * A pre-calculated shielded address pair for one BIP32 index (test tooling).
 *
 * Mirrors the pre-calculated legacy addresses passed at wallet construction:
 * carries exactly the fields needed to reconstruct the two storage records
 * that live derivation (deriveShieldedAddressPair) would produce, so injected
 * indexes skip the expensive EC derivation in loadAddresses.
 */
export interface IPrecalculatedShieldedAddress {
  bip32AddressIndex: number;
  /** The user-facing 71-byte shielded address (scan + spend pubkeys) */
  shieldedBase58: string;
  /** The paired on-chain P2PKH derived from HASH160(spend_pubkey) */
  spendBase58: string;
  /** Compressed scan child pubkey, hex */
  scanPubkey: string;
  /** Compressed spend child pubkey, hex */
  spendPubkey: string;
}

export interface IAddressMetadata {
  numTransactions: number;
  balance: Map<string, IBalance>;
  seqnum?: number; // TODO: Confirm if it is really optional for v3
}

export interface IAddressMetadataAsRecord {
  numTransactions: number;
  balance: Record<string, IBalance>;
}

export interface ITokenData {
  uid: string;
  name: string;
  symbol: string;
  version?: TokenVersion;
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
  type: 'grant_authority';
  token_uid: string;
  mint: boolean;
  melt: boolean;
}

export interface IHistoryNanoContractActionAcquireAuthority {
  type: 'acquire_authority';
  token_uid: string;
  mint: boolean;
  melt: boolean;
}

export type IHistoryNanoContractAction =
  | IHistoryNanoContractActionDeposit
  | IHistoryNanoContractActionWithdrawal
  | IHistoryNanoContractActionGrantAuthority
  | IHistoryNanoContractActionAcquireAuthority;

export interface IHistoryNanoContractContext {
  actions: IHistoryNanoContractAction[];
  caller_id: string;
  timestamp?: number | null;
}

/**
 * Fee entry in a Fee Header.
 * Represents a token and amount used to pay transaction fees.
 */
export interface IFeeEntry {
  /**
   * Index of the token in the transaction's tokens array.
   * References tx.tokens[tokenIndex].
   * Must be in the range [0, tx.tokens.length).
   */
  tokenIndex: number;

  /**
   * Amount of the fee in the smallest unit ("cents").
   * Must be positive.
   * MUST be a multiple of (1 / TOKEN_DEPOSIT_PERCENTAGE).
   */
  amount: OutputValueType;
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
  token_version?: TokenVersion; // For create token transaction
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
  nc_seqnum?: number; // For nano contract
  first_block?: string | null;
  shielded_outputs?: IHistoryShieldedOutput[]; // For confidential transactions
  /**
   * Tx-level headers persisted from the wire payload (FeeHeader,
   * UnshieldBalanceHeader, ...). The wallet keeps them as the original
   * untyped on-chain shape (each entry has `id` + header-specific
   * fields like `entries[]` for FeeHeader); reconstructing the typed
   * `Header` instance here would force `processNewTx` to call into the
   * tx parser unnecessarily. Display layers can read the entries and
   * compute network fees directly.
   */
  headers?: { id?: number; entries?: { tokenIndex?: number; amount?: bigint }[] }[];
}

// The history/storage shape of a shielded output: structurally the wire
// `IShieldedOutput` (shielded/types.ts) plus spend tracking. It overrides
// `decoded` with the richer `IHistoryOutputDecoded` (which adds the `data?`
// field) and adds `spent_by`. Extending keeps the crypto wire fields
// (mode/commitment/range_proof/…) single-source, so the two shapes cannot
// drift out of sync.
export interface IHistoryShieldedOutput extends Omit<IShieldedOutput, 'decoded'> {
  decoded: IHistoryOutputDecoded;
  // Set by the fullnode when the shielded output is spent by another tx.
  // Null when the slot is still unspent. Mirrors the transparent
  // `IHistoryOutput.spent_by` semantics — see hathor-core's
  // `_shielded_output_to_json` + `meta.get_output_spent_by` in
  // `base_transaction.py`. Threaded through normalizeShieldedOutputs and
  // the processNewTx decryption append so the wallet treats shielded
  // and transparent outputs identically when checking spend status.
  spent_by?: string | null;
  // ─── owned-marker fields (SEPARATED model) ───────────────────────────────
  // Populated IN PLACE on this entry when the wallet decrypts a shielded
  // output it owns (received or change). The single ownership gate is
  // `value !== undefined`: a slot with `value === undefined` is non-owned (or
  // not yet decrypted) and is excluded from balance/credit/sign. `decoded`
  // (address) is NOT an ownership signal — the fullnode emits a decoded
  // address for non-owned outputs too, so keying ownership off `decoded`
  // would let the wallet sign foreign inputs. `decoded` stays REQUIRED.
  value?: OutputValueType;
  token?: string;
  blindingFactor?: string; // hex, 32 bytes — value blinding factor (after decryption)
  assetBlindingFactor?: string; // hex, 32 bytes — asset blinding factor (FullShielded only)
}

export enum TxHistoryProcessingStatus {
  PROCESSING = 'processing',
  FINISHED = 'finished',
}

export interface IHistoryInput {
  // These fields are resolved from the spent output.
  // For shielded inputs (spending shielded outputs), they may be absent
  // because the spent output's value/token are hidden in commitments.
  value?: OutputValueType;
  token_data?: number;
  script?: string;
  decoded?: IHistoryOutputDecoded;
  token?: string;
  // Always present:
  tx_id: string;
  index: number;
  // Set to 'shielded' when this input spends a shielded output. The
  // fullnode emits this on the wire for inputs in `address_history` /
  // `/transaction?id=…` responses; the wallet's sender-local insert
  // (`txUtils.convertTransactionToHistoryTx`) also stamps it so
  // self-sent shielded spends carry the discriminator before any
  // WebSocket re-delivery. The alpha fullnode stamps 'transparent' on
  // ordinary inputs; older nodes omit the field entirely.
  type?: 'shielded' | 'transparent';
  // Shielded inputs carry their own commitment on the wire; surfaced
  // here so the explorer's unblinding verifier (and any future
  // re-derive flows) can read it without round-tripping the full tx.
  commitment?: string;
}

// Obs: this will change with nano contracts
export interface IHistoryOutputDecoded {
  type?: string;
  address?: string;
  timelock?: number | null;
  data?: string;
}

export interface ITransparentOutput {
  value: OutputValueType;
  token_data: number;
  script: string;
  decoded: IHistoryOutputDecoded;
  token: string;
  spent_by: string | null;
  selected_as_input?: boolean;
}

// SEPARATED model: `outputs[]` is transparent-only as a POST-NORMALIZE
// internal invariant. Shielded outputs live in their own on-chain-ordered
// `shielded_outputs[]` list (see `IHistoryShieldedOutput`); the on-chain
// absolute index of `shielded_outputs[s]` is `outputs.length + s`. Resolve
// "what does an input spend" via `resolveSpentOutput` (utils/transaction.ts),
// never positional `outputs[idx]` for an idx that may be ≥ outputs.length.
export type IHistoryOutput = ITransparentOutput;

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
  type: AuthorityType;
  value: OutputValueType;
  address: string;
  timelock: number | null;
  authorities: OutputValueType;
}

export function isDataOutputCreateToken(output: IDataOutput): output is IDataOutputCreateToken {
  return output.type === AuthorityType.MINT || output.type === AuthorityType.MELT;
}

export interface IDataOutputOptionals {
  isChange?: boolean;
}

export type IDataOutput = (IDataOutputData | IDataOutputAddress | IDataOutputCreateToken) &
  IDataOutputOptionals;

export type IDataOutputWithToken = IDataOutput & { token: string };

export interface IDataInput {
  txId: string;
  index: number;
  value: OutputValueType;
  authorities: OutputValueType;
  token: string;
  address: string;
  data?: string;
}

interface IDataTokenCreationTx {
  name: string;
  symbol: string;
  tokenVersion?: TokenVersion; // `tokenVersion` cannot be named `version` because it conflicts with the `version` property of the `IDataTx` interface
}

// XXX: This type is meant to be used as an intermediary for building transactions
// It should have everything we need to build and push transactions.
export interface IDataTx extends Partial<IDataTokenCreationTx> {
  signalBits?: number;
  version?: number;
  inputs: IDataInput[];
  outputs: IDataOutput[];
  tokens: string[];
  shieldedOutputs?: IDataShieldedOutput[];
  /**
   * 32-byte excess blinding factor for a full-unshield transaction
   * (shielded inputs → transparent outputs only, no shielded outputs).
   *
   * When present, `prepareTransaction` attaches an `UnshieldBalanceHeader`
   * (id 0x13) to the built Transaction. Mutually exclusive with
   * `shieldedOutputs`; the fullnode rejects a tx that carries both, and
   * rejects a tx with shielded inputs but no shielded outputs and no
   * excess. See hathor-core
   * `hathor/transaction/headers/unshield_balance_header.py` and
   * Section 2.4 of the shielded outputs client guide.
   */
  excessBlindingFactor?: Buffer;
  weight?: number;
  nonce?: number;
  timestamp?: number;
  parents?: string[];
  headers?: Header[];
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
  shielded?: boolean; // marks this as a shielded UTXO (confidential transaction)
  blindingFactor?: string; // hex, 32 bytes — value blinding factor from decryption
  assetBlindingFactor?: string; // hex, 32 bytes — asset blinding factor (FullShielded only)
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
  // Shielded address key material. Optional: absent on wallets created
  // before the shielded feature AND on wallets without root-key access —
  // the scan/spend chains are hardened accounts (1'/2'), derivable only
  // from the root xpriv, so xpub-only (read-only) wallets and wallets
  // initialized from an account-level xpriv can never populate these.
  scanXpubkey?: string; // xpub at m/44'/280'/1'/0 (scan chain — view-only access)
  scanMainKey?: IEncryptedData; // encrypted xpriv at m/44'/280'/1'/0
  spendXpubkey?: string; // xpub at m/44'/280'/2'/0 (spend chain — signing authority)
  spendMainKey?: IEncryptedData; // encrypted xpriv at m/44'/280'/2'/0
}

export enum SCANNING_POLICY {
  GAP_LIMIT = 'gap-limit',
  INDEX_LIMIT = 'index-limit',
  SINGLE_ADDRESS = 'single-address',
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

export interface ISingleAddressAddressScanPolicy {
  policy: SCANNING_POLICY.SINGLE_ADDRESS;
}

/**
 * This is a request from the scanning policy to load `count` addresses starting from nextIndex.
 */
export interface IScanPolicyLoadAddresses {
  nextIndex: number;
  count: number;
}

export type AddressScanPolicy =
  | SCANNING_POLICY.GAP_LIMIT
  | SCANNING_POLICY.INDEX_LIMIT
  | SCANNING_POLICY.SINGLE_ADDRESS;

export type AddressScanPolicyData =
  | IGapLimitAddressScanPolicy
  | IIndexLimitAddressScanPolicy
  | ISingleAddressAddressScanPolicy;

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

export function isSingleAddressScanPolicy(
  scanPolicyData: AddressScanPolicyData
): scanPolicyData is ISingleAddressAddressScanPolicy {
  return scanPolicyData.policy === SCANNING_POLICY.SINGLE_ADDRESS;
}

export interface IWalletData {
  lastLoadedAddressIndex: number;
  lastUsedAddressIndex: number;
  currentAddressIndex: number;
  // Shielded address chain tracking (separate gap-limit scanning)
  shieldedLastLoadedAddressIndex: number;
  shieldedLastUsedAddressIndex: number;
  shieldedCurrentAddressIndex: number;
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
  // Filter by shielded status:
  // undefined (default) → all UTXOs (transparent + shielded)
  // true → only shielded UTXOs
  // false → only transparent UTXOs
  shielded?: boolean;
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
  /** @deprecated */
  min_weight: number;
  min_tx_weight: number;
  min_tx_weight_coefficient: number;
  min_tx_weight_k: number;
  /** @deprecated Prefer the numerator/denominator fraction below (integer precision). Optional: fullnodes will stop sending it. */
  token_deposit_percentage?: number;
  /** Token deposit percentage numerator (parts per billion). Absent on older fullnodes. */
  token_deposit_percentage_numerator?: number;
  /** Token deposit percentage denominator (parts per billion). Absent on older fullnodes. */
  token_deposit_percentage_denominator?: number;
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
  addressIter(opts?: IAddressChainOptions): AsyncGenerator<IAddressInfo>;
  getAddress(base58: string): Promise<IAddressInfo | null>;
  getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
  getSeqnumMeta(base58: string): Promise<number | null>;
  getAddressAtIndex(index: number, opts?: IAddressChainOptions): Promise<IAddressInfo | null>;
  saveAddress(info: IAddressInfo): Promise<void>;
  addressExists(base58: string): Promise<boolean>;
  addressCount(opts?: IAddressChainOptions): Promise<number>;
  editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void>;
  editSeqnumMeta(base58: string, seqnum: number): Promise<void>;

  // tx history methods
  /**
   * Yield txs from the local history.
   *
   * @param tokenUid Optional. If set, only yield txs that involve this token
   *   on a wallet-owned address (input or output).
   * @param options.order `'desc'` (default) yields newest-first — the order
   *   the wallet UI consumes. `'asc'` yields oldest-first, used by
   *   `processHistory` to replay txs chronologically so a tx that spends a
   *   previous tx's UTXO finds it already saved.
   */
  historyIter(tokenUid?: string, options?: { order?: 'asc' | 'desc' }): AsyncGenerator<IHistoryTx>;
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
  getUtxo(utxoId: IUtxoId): Promise<IUtxo | null>;
  saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
  iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
  unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
  deleteUtxo(utxoId: IUtxo): Promise<void>;

  // Wallet data
  getAccessData(): Promise<IWalletAccessData | null>;
  saveAccessData(data: IWalletAccessData): Promise<void>;
  getWalletData(): Promise<IWalletData>;
  getLastLoadedAddressIndex(opts?: IAddressChainOptions): Promise<number>;
  getLastUsedAddressIndex(opts?: IAddressChainOptions): Promise<number>;
  setLastUsedAddressIndex(index: number, opts?: IAddressChainOptions): Promise<void>;
  getCurrentHeight(): Promise<number>;
  setCurrentHeight(height: number): Promise<void>;
  getCurrentAddress(markAsUsed?: boolean, opts?: IAddressChainOptions): Promise<string>;
  setCurrentAddressIndex(index: number, opts?: IAddressChainOptions): Promise<void>;
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

  // Shielded (confidential transaction) crypto provider
  shieldedCryptoProvider?: IShieldedCryptoProvider;
  setShieldedCryptoProvider(provider?: IShieldedCryptoProvider): void;
  // Get the provider, or throw if it has not been configured. Confidential
  // code paths require it; a missing provider is a setup error, not a
  // condition to silently default around.
  getShieldedCryptoProvider(): IShieldedCryptoProvider;

  setApiVersion(version: ApiVersion): void;
  getDecimalPlaces(): number;
  saveNativeToken(): Promise<void>;
  getNativeTokenData(): ITokenData;
  setLogger(logger: ILogger): void;

  hasTxSignatureMethod(): boolean;
  setTxSignatureMethod(txSign: EcdsaTxSign | null): void;
  getTxSignatures(tx: Transaction, pinCode: string): Promise<ITxSignatureData>;

  hasPrivateKeyMethod(): boolean;
  setPrivateKeyMethod(getPrivKey: PrivateKeyProvider | null): void;
  getExternalPrivateKey(
    addressIndex: number,
    options?: { pinCode?: string | null }
  ): Promise<unknown>;

  // Address methods
  getAllAddresses(opts?: IAddressChainOptions): AsyncGenerator<IAddressInfo & IAddressMetadata>;
  getAddressInfo(base58: string): Promise<(IAddressInfo & IAddressMetadata) | null>;
  getAddressAtIndex(index: number, opts?: IAddressChainOptions): Promise<IAddressInfo | null>;
  getAddressPubkey(index: number): Promise<string>;
  saveAddress(info: IAddressInfo): Promise<void>;
  isAddressMine(base58: string): Promise<boolean>;
  getCurrentAddress(markAsUsed?: boolean, opts?: IAddressChainOptions): Promise<string>;
  getChangeAddress(options?: { changeAddress?: null | string }): Promise<string>;

  // Transaction methods
  txHistory(): AsyncGenerator<IHistoryTx>;
  tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx>;
  getTx(txId: string): Promise<IHistoryTx | null>;
  getSpentTxs(inputs: Input[]): AsyncGenerator<{ tx: IHistoryTx; input: Input; index: number }>;
  addTx(tx: IHistoryTx): Promise<void>;
  // pinCode is threaded so the scan-key derivation can decrypt wallet-owned
  // shielded outputs while (re)processing the history.
  processHistory(pinCode?: string): Promise<void>;
  processNewTx(tx: IHistoryTx, pinCode?: string): Promise<void>;
  getUtxo(utxoId: IUtxoId): Promise<IUtxo | null>;

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

  // Shielded key methods (return undefined if wallet was created before shielded feature)
  getScanXPrivKey(pinCode: string): Promise<string>;
  getSpendXPrivKey(pinCode: string): Promise<string>;
  getScanXPubKey(): Promise<string | undefined>;
  getSpendXPubKey(): Promise<string | undefined>;
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
    cleanTokens?: boolean;
  }): Promise<void>;
  getTokenDepositPercentage(): number;
  getTokenDepositPercentageFraction(): { numerator: bigint; denominator: bigint };
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

export enum AuthorityType {
  MINT = 'mint',
  MELT = 'melt',
}

export function isAuthorityType(value?: string): value is AuthorityType {
  return Object.values(AuthorityType).includes(value as AuthorityType);
}

export enum WalletAddressMode {
  SINGLE = 'single',
  MULTI = 'multi',
}
