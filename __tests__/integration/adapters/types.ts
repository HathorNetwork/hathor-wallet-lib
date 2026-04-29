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
  password?: string | null;
  pinCode?: string | null;
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
  buildWalletInstance(options?: CreateWalletOptions): CreateWalletResult;

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
  getPrecalculatedWallet(): PrecalculatedWalletData;

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

  // --- UTXO queries ---

  /**
   * Retrieves unspent transaction outputs for a wallet.
   * Both facades support `getUtxos()`.
   */
  getUtxos(wallet: FuzzyWalletType, options?: GetUtxosAdapterOptions): Promise<GetUtxosResult>;

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
 * Options for querying UTXOs via the adapter.
 */
export interface GetUtxosAdapterOptions {
  token?: string;
  max_utxos?: number;
  filter_address?: string;
  amount_smaller_than?: bigint;
  amount_bigger_than?: bigint;
}

/**
 * A single UTXO entry returned by the adapter.
 */
export interface AdapterUtxo {
  address: string;
  amount: bigint;
  tx_id: string;
  locked: boolean;
  index: number;
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
 * An output for sendManyOutputsTransaction.
 */
export interface AdapterOutput {
  address: string;
  value: bigint;
  token: string;
  timelock?: number;
}

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
