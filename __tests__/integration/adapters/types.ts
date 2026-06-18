/* eslint-disable jest/no-export */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { IHathorWallet, FullNodeTxResponse } from '../../../src/wallet/types';
import type { PrecalculatedWalletData } from '../helpers/wallet-precalculation.helper';
import type Transaction from '../../../src/models/transaction';
import type { IHistoryTx, IStorage, TokenVersion, AuthorityType } from '../../../src/types';
import { HathorWallet, HathorWalletServiceWallet } from '../../../src';

/**
 * The codebase has three overlapping wallet types: the {@link IHathorWallet} interface
 * and two concrete classes ({@link HathorWallet}, {@link HathorWalletServiceWallet}).
 * They are not structurally compatible — e.g. `getCurrentAddress()` returns
 * `AddressInfoObject` on the concrete classes but `AddressInfoObject | Promise<unknown>`
 * on the interface — so TypeScript cannot safely narrow between them.
 *
 * - **ConcreteWalletType**: used when the caller needs methods only on the classes
 *   (e.g. `isReady()`), not on the interface.
 * - **FuzzyWalletType**: the adapter boundary type — accepts any of the three so that
 *   shared tests can pass wallets without knowing which facade is under test.
 */
export type ConcreteWalletType = HathorWallet | HathorWalletServiceWallet;
export type FuzzyWalletType = IHathorWallet | ConcreteWalletType;

/**
 * Options for creating a wallet instance via the adapter.
 */
export interface CreateWalletOptions {
  seed?: string;
  xpub?: string;
  xpriv?: string;
  passphrase?: string;
  password?: string;
  pinCode?: string;
  preCalculatedAddresses?: string[];
  multisig?: {
    pubkeys: string[];
    numSignatures: number;
  };
  tokenUid?: string;
  singleAddressMode?: boolean;
}

/**
 * Result of building or creating a wallet instance.
 */
export interface CreateWalletResult {
  wallet: FuzzyWalletType;
  storage: IStorage;
  words?: string;
  addresses?: string[];
}

/**
 * Declares which features each facade supports, allowing shared tests
 * to skip unsupported scenarios with clear messaging.
 */
export interface WalletCapabilities {
  supportsMultisig: boolean;
  supportsTokenScope: boolean;
  supportsXpubReadonly: boolean;
  supportsExternalSigning: boolean;
  supportsRuntimeAddressCalculation: boolean;
  supportsPreStartFunding: boolean;
  requiresExplicitWaitReady: boolean;
  stateEventValues: {
    loading: string | number;
    ready: string | number;
  };
}

/**
 * Adapter interface that abstracts differences between HathorWallet (fullnode)
 * and HathorWalletServiceWallet facades for shared integration tests.
 *
 * Each adapter wraps the existing test helpers for its facade, providing a
 * unified API that shared test factories can call without knowing which
 * implementation is under test.
 */
export interface IWalletTestAdapter {
  /** Human-readable name for describe blocks (e.g. "Fullnode", "Wallet Service") */
  name: string;

  /** Network name the adapter's wallets connect to (e.g. 'testnet') */
  networkName: string;

  /** Feature flags for conditional test execution */
  capabilities: WalletCapabilities;

  /** Default credentials */
  defaultPinCode: string;
  defaultPassword: string;

  /**
   * The server URL that changeServer should revert to after tests.
   * Fullnode: the fullnode connection URL (e.g. FULLNODE_URL)
   * Wallet Service: the wallet-service base URL (e.g. 'http://localhost:3000/dev/')
   */
  originalServerUrl: string;

  /**
   * A real testnet server URL for validating changeServer via getVersionData.
   * Fullnode: a testnet fullnode URL
   * Wallet Service: a testnet wallet-service URL
   */
  testnetServerUrl: string;

  // --- Lifecycle ---

  /** One-time setup for the test suite (e.g. start genesis wallet, init configs) */
  suiteSetup(): Promise<void>;

  /** One-time teardown for the test suite */
  suiteTeardown(): Promise<void>;

  // --- Wallet creation ---

  /**
   * Creates a wallet, starts it, and waits until ready.
   * When called without options, uses a precalculated wallet.
   */
  createWallet(options?: CreateWalletOptions): Promise<CreateWalletResult>;

  /**
   * Builds a wallet instance WITHOUT starting it.
   * Used by validation tests that need to call start() manually.
   */
  buildWalletInstance(options?: CreateWalletOptions): Promise<CreateWalletResult>;

  /**
   * Starts a wallet that was built with buildWalletInstance().
   * Does NOT wait for ready — caller can control that separately.
   */
  startWallet(
    wallet: FuzzyWalletType,
    options?: { pinCode?: string; password?: string }
  ): Promise<void>;

  /**
   * Waits for a wallet to reach the ready state.
   * Some facades handle this internally in start(); others require explicit waiting.
   */
  waitForReady(wallet: FuzzyWalletType): Promise<void>;

  /** Stops a single wallet */
  stopWallet(wallet: FuzzyWalletType): Promise<void>;

  /** Stops all wallets started during the current test run */
  stopAllWallets(): Promise<void>;

  // --- Fund injection ---

  /**
   * Sends funds from the genesis wallet to a destination wallet's address.
   * Waits for both genesis and destination wallets to see the tx.
   */
  injectFunds(destWallet: FuzzyWalletType, address: string, amount: bigint): Promise<Transaction>;

  /**
   * Injects funds to an address BEFORE the wallet is started.
   * Returns the tx hash so the caller can verify it appears in history after start.
   */
  injectFundsBeforeStart(address: string, amount: bigint): Promise<string>;

  // --- Tx waiting ---

  /** Waits until a specific tx is visible in the wallet, and optionally on a receiving wallet. */
  waitForTx(wallet: FuzzyWalletType, txId: string, recvWallet?: FuzzyWalletType): Promise<void>;

  // --- Precalculated data ---

  /** Returns a fresh precalculated wallet for tests that need one */
  getPrecalculatedWallet(): Promise<PrecalculatedWalletData>;

  // --- Transaction operations ---

  /**
   * Sends a transaction from the wallet to the given address.
   * Handles pinCode injection for facades that require per-call credentials.
   * Returns the hash and the full Transaction model.
   */
  sendTransaction(
    wallet: FuzzyWalletType,
    address: string,
    amount: bigint,
    options?: SendTransactionOptions
  ): Promise<SendTransactionResult>;

  /**
   * Retrieves a transaction from the wallet's local history.
   * Both facades support `getTx()`.
   */
  getTx(wallet: FuzzyWalletType, txId: string): Promise<IHistoryTx>;

  /**
   * Retrieves the full transaction data from the network node.
   * Both facades support this via the fullnode API.
   */
  getFullTxById(wallet: FuzzyWalletType, txId: string): Promise<FullNodeTxResponse>;

  // --- Token operations ---

  /**
   * Creates a new custom token on the given wallet and waits for it to be confirmed.
   * Handles pinCode injection and tx-waiting differences between facades.
   */
  createToken(
    wallet: FuzzyWalletType,
    name: string,
    symbol: string,
    amount: bigint,
    options?: CreateTokenOptions
  ): Promise<CreateTokenResult>;

  /**
   * Mints additional units of an existing token and waits for the tx.
   * Handles pinCode injection and tx-waiting differences between facades.
   */
  mintTokens(
    wallet: FuzzyWalletType,
    tokenUid: string,
    amount: bigint,
    options?: MintTokensAdapterOptions
  ): Promise<MintMeltResult>;

  /**
   * Melts units of an existing token and waits for the tx.
   * Handles pinCode injection and tx-waiting differences between facades.
   */
  meltTokens(
    wallet: FuzzyWalletType,
    tokenUid: string,
    amount: bigint,
    options?: MeltTokensAdapterOptions
  ): Promise<MintMeltResult>;

  /**
   * Retrieves token metadata for a given token UID.
   * Both facades expose `getTokenDetails()` with structurally identical results,
   * so the adapter returns the common shape directly.
   */
  getTokenDetails(wallet: FuzzyWalletType, tokenUid: string): Promise<TokenDetailsResult>;

  // --- UTXO queries ---

  /**
   * Retrieves unspent transaction outputs for a wallet.
   *
   * Normalizes the two facades' very different surfaces:
   * - Fullnode exposes `getAvailableUtxos()` as an async generator yielding `IUtxo`.
   * - Wallet-service exposes `getUtxos()` returning an object with a `utxos` array.
   *
   * Both are mapped to the shared {@link AdapterUtxo} shape.
   */
  getUtxos(wallet: FuzzyWalletType, options?: GetUtxosAdapterOptions): Promise<GetUtxosResult>;

  /**
   * Selects unspent outputs that cover `amount` for a given token, returning the
   * chosen UTXOs and any change.
   *
   * Both facades implement `getUtxosForAmount()` with the same
   * `{ utxos, changeAmount }` contract and raise the same {@link UtxoError}
   * (with identical messages) from the shared `selectUtxos`, so the behavior is
   * shared. Only the per-UTXO shape differs between facades — it is normalized
   * into {@link AdapterUtxo}. The `address` option maps to the facades'
   * `filter_address` filter.
   */
  getUtxosForAmount(
    wallet: FuzzyWalletType,
    amount: bigint,
    options?: GetUtxosAdapterOptions
  ): Promise<GetUtxosForAmountResult>;

  // --- Multi-output transactions ---

  /**
   * Sends a transaction with multiple outputs and optional explicit inputs.
   * Both facades support `sendManyOutputsTransaction()`.
   */
  sendManyOutputsTransaction(
    wallet: FuzzyWalletType,
    outputs: AdapterOutput[],
    options?: SendManyOutputsAdapterOptions
  ): Promise<SendTransactionResult>;

  // --- Authority UTXOs ---

  /**
   * Queries authority UTXOs for a given token on the wallet.
   * Normalizes fullnode's `getAuthorityUtxos()` vs service's `getAuthorityUtxo()`.
   */
  getAuthorityUtxos(
    wallet: FuzzyWalletType,
    tokenUid: string,
    type: AuthorityType,
    options?: GetAuthorityUtxosOptions
  ): Promise<AuthorityUtxoResult[]>;

  // --- Authority delegation ---

  /**
   * Delegates a token authority (mint or melt) to a destination address.
   * Both facades support `delegateAuthority()`.
   */
  delegateAuthority(
    wallet: FuzzyWalletType,
    tokenUid: string,
    type: AuthorityType,
    destinationAddress: string,
    options?: DelegateAuthorityAdapterOptions
  ): Promise<DelegateAuthorityResult>;

  // --- Address methods ---

  /**
   * Lists every address known to the wallet, in derivation-index order.
   * Both facades expose `getAllAddresses()` as an async generator with
   * different element shapes — the adapter normalizes them to {@link AdapterAddress}.
   */
  getAllAddresses(wallet: FuzzyWalletType): Promise<AdapterAddress[]>;

  /**
   * Returns the current address (the next unused one) for the wallet.
   * When `markAsUsed` is true, the wallet advances past this address
   * so subsequent calls return the next one.
   */
  getCurrentAddress(
    wallet: FuzzyWalletType,
    options?: { markAsUsed?: boolean }
  ): Promise<AdapterAddress>;

  /**
   * Advances the current address pointer and returns the next address.
   */
  getNextAddress(wallet: FuzzyWalletType): Promise<AdapterAddress>;

  /**
   * Returns the derivation index for an address that belongs to the wallet,
   * or `undefined` when the address is not part of this wallet.
   */
  getAddressIndex(wallet: FuzzyWalletType, address: string): Promise<number | undefined>;

  /**
   * Returns the address at a specific derivation index.
   */
  getAddressAtIndex(wallet: FuzzyWalletType, index: number): Promise<string>;
}

/**
 * Options for sending a transaction via the adapter.
 */
export interface SendTransactionOptions {
  token?: string;
  changeAddress?: string;
  /** If provided, the adapter also waits for the tx on the receiving wallet. */
  recvWallet?: FuzzyWalletType;
}

/**
 * Result of sending a transaction.
 */
export interface SendTransactionResult {
  hash: string;
  transaction: Transaction;
}

/**
 * Options for creating a new token via the adapter.
 */
export interface CreateTokenOptions {
  createMint?: boolean;
  createMelt?: boolean;
  mintAuthorityAddress?: string;
  meltAuthorityAddress?: string;
  address?: string;
  changeAddress?: string;
  tokenVersion?: TokenVersion;
  data?: string[];
}

/**
 * Result of creating a new token.
 */
export interface CreateTokenResult {
  hash: string;
  transaction: Transaction;
}

/**
 * Options for minting tokens via the adapter.
 */
export interface MintTokensAdapterOptions {
  address?: string;
  changeAddress?: string;
  createAnotherMint?: boolean;
  mintAuthorityAddress?: string;
  data?: string[];
  unshiftData?: boolean;
}

/**
 * Options for melting tokens via the adapter.
 */
export interface MeltTokensAdapterOptions {
  address?: string;
  changeAddress?: string;
  createAnotherMelt?: boolean;
  meltAuthorityAddress?: string;
  data?: string[];
  unshiftData?: boolean;
}

/**
 * Result of minting or melting tokens via the adapter.
 */
export interface MintMeltResult {
  hash: string;
  transaction: Transaction;
}

/**
 * Normalized token details shared by both facade implementations.
 * The fullnode and wallet-service `getTokenDetails()` already return the same
 * shape; this interface exists to give shared tests a stable type.
 */
export interface TokenDetailsResult {
  totalSupply: bigint;
  totalTransactions: number;
  tokenInfo: {
    id: string;
    name: string;
    symbol: string;
    version?: TokenVersion;
  };
  authorities: { mint: boolean; melt: boolean };
}

/**
 * Options for querying UTXOs via the adapter.
 *
 * Only the filters exercised by the shared suite are exposed. Amount/count
 * filters (`max_utxos`, `amount_smaller_than`, `amount_bigger_than`) are tested
 * per-facade against the concrete APIs, so they are intentionally absent here to
 * keep both adapters' contracts symmetric and honest.
 */
export interface GetUtxosAdapterOptions {
  token?: string;
  address?: string;
}

/**
 * A single UTXO entry returned by the adapter.
 *
 * Common fields across both facades (fullnode and wallet-service). Facade-specific
 * extras (e.g. `addressPath`, `authorities`, `heightlock`) are deliberately omitted
 * so shared tests can assert against a single, stable shape.
 *
 * `tokenId` is derived from the query option rather than the underlying APIs
 * (neither facade includes it on individual UTXO entries) so callers always know
 * which token a returned UTXO belongs to.
 */
export interface AdapterUtxo {
  txId: string;
  index: number;
  value: bigint;
  address: string;
  tokenId: string;
  locked: boolean;
}

/**
 * Result of a getUtxos query.
 */
export interface GetUtxosResult {
  total_amount_available: bigint;
  total_utxos_available: bigint;
  utxos: AdapterUtxo[];
}

/**
 * Result of an adapter `getUtxosForAmount` query.
 *
 * Both facades return `{ utxos, changeAmount }`, but the per-UTXO shapes differ
 * (fullnode yields `IUtxo` with `addressPath`/`height` extras; wallet-service
 * yields its own `Utxo`). The adapter maps both into the shared
 * {@link AdapterUtxo} shape so callers assert against a single contract.
 */
export interface GetUtxosForAmountResult {
  changeAmount: bigint;
  utxos: AdapterUtxo[];
}

/**
 * An address-based output for sendManyOutputsTransaction.
 */
export interface AdapterAddressOutput {
  address: string;
  value: bigint;
  token: string;
  timelock?: number;
}

/**
 * A data-script output for sendManyOutputsTransaction. The on-chain output
 * burns 0.01 HTR and carries the supplied data as the script payload.
 */
export interface AdapterDataOutput {
  type: 'data';
  data: string;
}

/**
 * An output for sendManyOutputsTransaction. Both facades accept the union;
 * the wallet routes data outputs through the data-script pipeline and
 * address outputs through normal UTXO selection.
 */
export type AdapterOutput = AdapterAddressOutput | AdapterDataOutput;

/**
 * An explicit input for sendManyOutputsTransaction.
 */
export interface AdapterInput {
  txId: string;
  index: number;
  token?: string;
}

/**
 * Options for sendManyOutputsTransaction via the adapter.
 */
export interface SendManyOutputsAdapterOptions {
  inputs?: AdapterInput[];
  changeAddress?: string;
  /** If provided, the adapter also waits for the tx on the receiving wallet. */
  recvWallet?: FuzzyWalletType;
}

/**
 * Normalized authority UTXO result — the common fields
 * returned by both facade implementations.
 */
export interface AuthorityUtxoResult {
  txId: string;
  index: number;
  address: string;
  authorities: bigint;
}

/**
 * Options for querying authority UTXOs via the adapter.
 */
export interface GetAuthorityUtxosOptions {
  many?: boolean;
  filter_address?: string;
}

/**
 * Options for delegating authority via the adapter.
 */
export interface DelegateAuthorityAdapterOptions {
  createAnother?: boolean;
}

/**
 * Result of delegating authority.
 */
export interface DelegateAuthorityResult {
  hash: string;
}

/**
 * Normalized address entry returned by the adapter's address methods.
 *
 * Both facades expose address objects with subtly different shapes:
 * - Fullnode `getAllAddresses()` yields `{ address, index, transactions }`.
 * - Service `getAllAddresses()` yields `{ address, index, transactions }` too,
 *   but `getCurrentAddress()` / `getNextAddress()` return `{ address, index, addressPath, info? }`.
 *
 * `AdapterAddress` keeps only the fields that are unambiguous on both facades.
 * Callers that need facade-specific extras (like `info: 'GAP_LIMIT_REACHED'`
 * or `transactions`) should use facade-specific tests.
 */
export interface AdapterAddress {
  address: string;
  index: number;
  /** Derivation path (e.g. `m/44'/280'/0'/0/3`); both facades expose this. */
  addressPath: string;
}
