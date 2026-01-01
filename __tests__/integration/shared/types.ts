/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../../src/new/wallet';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import Transaction from '../../../src/models/transaction';

/**
 * Union type for all supported wallet facades
 */
export type SupportedWallet = HathorWallet | HathorWalletServiceWallet;

/**
 * Factory function that creates and initializes a wallet instance.
 * Returns the wallet instance along with any additional resources that may need cleanup.
 */
export interface WalletFactory<T extends SupportedWallet = SupportedWallet> {
  /**
   * Creates and starts a wallet with the provided options
   * @param options Configuration options for wallet creation
   * @returns Object containing the wallet and optional cleanup resources
   */
  create(options?: WalletCreationOptions): Promise<WalletFactoryResult<T>>;

  start(options: WalletStartOptions): Promise<void>;
}

/**
 * Options for creating a wallet instance
 */
export interface WalletCreationOptions {
  /**
   * Seed words for the wallet (24 words separated by space)
   */
  seed?: string;

  /**
   * Pre-calculated addresses to speed up wallet initialization
   */
  preCalculatedAddresses?: string[];

  /**
   * Password to encrypt the seed
   */
  password?: string;

  /**
   * PIN code to execute wallet actions
   */
  pinCode?: string;

  /**
   * xpub for read-only wallets
   */
  xpub?: string;

  /**
   * Multisig configuration
   */
  multisig?: {
    pubkeys: string[];
    numSignatures: number;
  };

  /**
   * Whether to enable WebSocket connection (WalletService only)
   */
  enableWs?: boolean;

  /**
   * Password for requests (WalletService only)
   */
  passwordForRequests?: string;
}

export interface WalletStartOptions {
  wallet: SupportedWallet;
  pinCode?: string;
  password?: string;
}

/**
 * Result of wallet factory creation
 */
export interface WalletFactoryResult<T extends SupportedWallet = SupportedWallet> {
  /**
   * The created wallet instance
   */
  wallet: T;

  /**
   * Seed words used for this wallet, if it was initialized by words
   */
  words?: string;

  /**
   * Precalculated addresses used for this wallet, if it had any
   */
  preCalculatedAddresses?: string[];

  /**
   * Optional cleanup function to be called after tests
   */
  cleanup?: () => Promise<void>;
}

/**
 * Helper functions that adapt facade-specific behavior
 */
export interface WalletHelperAdapter<T extends SupportedWallet = SupportedWallet> {
  /**
   * Injects funds into a wallet address and waits for confirmation
   */
  injectFunds(wallet: T, address: string, amount: bigint): Promise<Transaction>;

  /**
   * Waits for a transaction to be received and processed by the wallet
   */
  waitForTx(wallet: T, txId: string, timeout?: number): Promise<void>;

  /**
   * Gets an address at a specific index, handling both async and sync methods
   */
  getAddressAtIndex(wallet: T, index: number): Promise<string>;

  /**
   * Checks if an address belongs to the wallet, handling both async and sync methods
   */
  isAddressMine(wallet: T, address: string): Promise<boolean>;

  /**
   * Gets all addresses from the wallet, handling both async and sync methods
   */
  getAllAddresses(wallet: T): Promise<string[]>;
}
