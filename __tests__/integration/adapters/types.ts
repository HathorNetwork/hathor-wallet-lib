/* eslint-disable jest/no-export */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { IHathorWallet } from '../../../src/wallet/types';
import type { PrecalculatedWalletData } from '../helpers/wallet-precalculation.helper';
import type Transaction from '../../../src/models/transaction';
import type { IStorage } from '../../../src/types';
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

  /** Waits until a specific tx is visible in the wallet */
  waitForTx(wallet: FuzzyWalletType, txId: string): Promise<void>;

  // --- Precalculated data ---

  /** Returns a fresh precalculated wallet for tests that need one */
  getPrecalculatedWallet(): PrecalculatedWalletData;
}
