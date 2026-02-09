/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  IStorage,
  ILogger,
  AddressScanPolicyData,
  IHistoryTx,
  OutputValueType,
  TokenVersion,
} from '../types';
import { NanoContractAction } from '../nano_contracts/types';
import WalletConnection from './connection';
import Address from '../models/address';

/**
 * Parameters for HathorWallet constructor
 *
 * @remarks
 * TODO: Future enhancement - Use discriminated unions to enforce "must provide
 * one of seed/xpriv/xpub" at compile time instead of runtime validation.
 * Example approach:
 * ```
 * type WalletInit =
 *   | { seed: string; passphrase?: string; xpriv?: never; xpub?: never }
 *   | { xpriv: string; seed?: never; passphrase?: never; xpub?: never }
 *   | { xpub: string; seed?: never; passphrase?: never; xpriv?: never }
 * ```
 */
export interface HathorWalletConstructorParams {
  // Required
  /** Connection to the fullnode server */
  connection: WalletConnection;

  // Optional - Storage
  /** Storage implementation (defaults to MemoryStore if not provided) */
  storage?: IStorage;

  // Wallet initialization (must provide one of: seed, xpriv, or xpub)
  // Runtime validation enforces this constraint

  /** 24-word mnemonic phrase for wallet initialization */
  seed?: string;
  /** Optional passphrase for additional seed encryption (BIP39) */
  passphrase?: string;
  /** Extended private key (xpriv) for wallet initialization */
  xpriv?: string;
  /** Extended public key (xpub) for read-only wallet */
  xpub?: string;

  // Token configuration
  /** UID of the token to track (defaults to HTR) */
  tokenUid?: string;

  // Security
  /** Password to encrypt the seed in storage */
  password?: string | null;
  /** PIN code to execute wallet actions */
  pinCode?: string | null;

  // Configuration
  /** Enable debug mode for detailed logging */
  debug?: boolean;
  /** Callback executed before reloading wallet data */
  beforeReloadCallback?: (() => void) | null;
  /** Multisig configuration for P2SH wallets */
  multisig?: { pubkeys: string[]; numSignatures: number } | null;
  /** Pre-calculated addresses to load into storage */
  preCalculatedAddresses?: string[] | null;
  /** Address scanning policy configuration */
  scanPolicy?: AddressScanPolicyData | null;
  /** Logger instance for wallet operations */
  logger?: ILogger | null;
}

/**
 * Utxo filtering options
 * @property max_utxos Maximum number of utxos to aggregate. Default to MAX_INPUTS (255)
 * @property token Token to filter the utxos. If not sent, we select only HTR utxos
 * @property authorities Authorities to filter the utxos. If not sent, we select only non authority utxos
 * @property filter_address Address to filter the utxos
 * @property amount_smaller_than Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than or equal to this value. Integer representation of decimals, i.e. 100 = 1.00
 * @property amount_bigger_than Minimum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount bigger than or equal to this value. Integer representation of decimals, i.e. 100 = 1.00
 * @property max_amount Limit the maximum total amount to consolidate summing all utxos. Integer representation of decimals, i.e. 100 = 1.00
 * @property only_available_utxos Use only available utxos (not locked)
 */
export interface UtxoOptions {
  max_utxos?: number;
  token?: string;
  authorities?: number;
  filter_address?: string;
  amount_smaller_than?: bigint;
  amount_bigger_than?: bigint;
  max_amount?: bigint;
  only_available_utxos?: boolean;
}

/**
 * Options for filtering available UTXOs
 * @property token Search for UTXOs of this token UID
 * @property filter_address Address to filter the utxos
 */
export interface GetAvailableUtxosOptions {
  token?: string;
  filter_address?: string;
}

/**
 * Options for getUtxosForAmount
 * @property token Search for UTXOs of this token UID
 * @property filter_address Address to filter the utxos
 */
export interface GetUtxosForAmountOptions {
  token?: string;
  filter_address?: string;
}

/**
 * Options for getting authority UTXOs
 * @property many If should return many utxos or just one (default false)
 * @property only_available_utxos If we should filter for available utxos (default false)
 * @property filter_address Address to filter the utxo to get (default null)
 */
export interface GetAuthorityOptions {
  many?: boolean;
  only_available_utxos?: boolean;
  filter_address?: string | null;
}

/**
 * Options for minting tokens
 * @property address Destination address of the minted token (if not sent we choose the next available address to use)
 * @property changeAddress Address of the change output (if not sent we choose the next available address to use)
 * @property startMiningTx Boolean to trigger start mining (default true)
 * @property createAnotherMint Boolean to create another mint authority or not for the wallet (default true)
 * @property mintAuthorityAddress Address to send the new mint authority created
 * @property allowExternalMintAuthorityAddress Allow the mint authority address to be from another wallet (default false)
 * @property unshiftData Whether to unshift the data script output (default false)
 * @property data List of data strings using utf8 encoding to add each as a data script output (default null)
 * @property signTx Sign transaction instance (default true)
 * @property pinCode Pin to decrypt xpriv information
 */
export interface MintTokensOptions {
  address?: string | null;
  changeAddress?: string | null;
  startMiningTx?: boolean;
  createAnotherMint?: boolean;
  mintAuthorityAddress?: string | null;
  allowExternalMintAuthorityAddress?: boolean;
  unshiftData?: boolean;
  data?: string[] | null;
  signTx?: boolean;
  pinCode?: string | null;
}

/**
 * Options for melting tokens
 * @property address Address of the HTR deposit back (if not sent we choose the next available address to use)
 * @property changeAddress Address of the change output (if not sent we choose the next available address to use)
 * @property createAnotherMelt Create another melt authority or not (default true)
 * @property meltAuthorityAddress Where to send the new melt authority created (default null)
 * @property allowExternalMeltAuthorityAddress Allow the melt authority address to be from another wallet (default false)
 * @property unshiftData Add the data outputs in the start of the output list (default false)
 * @property data List of data script output to add, UTF-8 encoded (default null)
 * @property pinCode Pin to decrypt xpriv information
 * @property signTx Sign transaction instance (default true)
 * @property startMiningTx Boolean to trigger start mining (default true)
 */
export interface MeltTokensOptions {
  address?: string | null;
  changeAddress?: string | null;
  createAnotherMelt?: boolean;
  meltAuthorityAddress?: string | null;
  allowExternalMeltAuthorityAddress?: boolean;
  unshiftData?: boolean;
  data?: string[] | null;
  pinCode?: string | null;
  signTx?: boolean;
  startMiningTx?: boolean;
}

/**
 * Options for delegating authority
 * @property createAnother Should create another authority for the wallet (default true)
 * @property startMiningTx Boolean to trigger start mining (default true)
 * @property pinCode Pin to decrypt xpriv information
 */
export interface DelegateAuthorityOptions {
  createAnother?: boolean;
  startMiningTx?: boolean;
  pinCode?: string | null;
}

/**
 * Options for destroying authority
 * @property startMiningTx Boolean to trigger start mining (default true)
 * @property pinCode Pin to decrypt xpriv information
 */
export interface DestroyAuthorityOptions {
  startMiningTx?: boolean;
  pinCode?: string | null;
}

/**
 * Options for starting the wallet
 * @property pinCode PIN code to decrypt the private key
 * @property password Password to decrypt the seed
 */
export interface WalletStartOptions {
  pinCode?: string | null;
  password?: string | null;
}

/**
 * Options for stopping the wallet
 * @property cleanStorage Clean storage data (default true)
 * @property cleanAddresses Clean address data (default false)
 * @property cleanTokens Clean token data (default false)
 */
export interface WalletStopOptions {
  cleanStorage?: boolean;
  cleanAddresses?: boolean;
  cleanTokens?: boolean;
}

/**
 * WebSocket message data structure for wallet updates
 * @property type Type of WebSocket message
 * @property history Transaction history data for wallet:address_history messages
 */
export interface WalletWebSocketData {
  type: string;
  history?: IHistoryTx;
}

/**
 * Options for creating nano contract transactions
 * @property pinCode PIN to decrypt the private key
 */
export interface CreateNanoTxOptions {
  pinCode?: string | null;
}

/**
 * Data for creating nano contract transactions
 * @property blueprintId ID of the blueprint to create the nano contract. Required if method is 'initialize'
 * @property ncId ID of the nano contract to execute method. Required if method is not initialize
 * @property actions List of actions to execute in the nano contract transaction
 * @property args List of arguments for the method to be executed in the transaction
 */
export interface CreateNanoTxData {
  blueprintId?: string | null;
  ncId?: string | null;
  actions?: NanoContractAction[];
  args?: unknown[] | null;
}

/**
 * Options for creating nano contract create token transactions
 * @property name Token name
 * @property symbol Token symbol
 * @property amount Token mint amount
 * @property contractPaysTokenDeposit If the contract will pay for the token deposit fee
 * @property mintAddress Address to send the minted tokens
 * @property changeAddress Change address to send change values
 * @property createMint If should create a mint authority output
 * @property mintAuthorityAddress The address to send the mint authority output to
 * @property allowExternalMintAuthorityAddress If should accept an external mint authority address
 * @property createMelt If should create a melt authority output
 * @property meltAuthorityAddress The address to send the melt authority output to
 * @property allowExternalMeltAuthorityAddress If should accept an external melt authority address
 * @property data List of data strings to create data outputs
 * @property isCreateNFT If this token is an NFT
 */
export interface CreateNanoTokenTxOptions {
  name: string;
  symbol: string;
  amount: OutputValueType;
  contractPaysTokenDeposit?: boolean;
  mintAddress?: string | null;
  changeAddress?: string | null;
  createMint?: boolean;
  mintAuthorityAddress?: string | null;
  allowExternalMintAuthorityAddress?: boolean;
  createMelt?: boolean;
  meltAuthorityAddress?: string | null;
  allowExternalMeltAuthorityAddress?: boolean;
  data?: string[] | null;
  isCreateNFT?: boolean;
}

/**
 * Options for creating on-chain blueprint transactions
 * @property pinCode PIN to decrypt the private key
 */
export interface CreateOnChainBlueprintTxOptions {
  pinCode?: string | null;
}

/**
 * Options for building a transaction template
 * @property signTx If the transaction should be signed
 * @property pinCode PIN to decrypt the private key
 */
export interface BuildTxTemplateOptions {
  signTx?: boolean;
  pinCode?: string | null;
}

/**
 * Options for starting wallet in read-only mode
 * @property skipAddressFetch Skip fetching addresses on startup
 */
export interface StartReadOnlyOptions {
  skipAddressFetch?: boolean;
}

export interface UtxoDetails {
  total_amount_available: bigint;
  total_utxos_available: bigint;
  total_amount_locked: bigint;
  total_utxos_locked: bigint;
  utxos: {
    address: string;
    amount: bigint;
    tx_id: string;
    locked: boolean;
    index: number;
  }[];
}

/**
 * Proposed output for a transaction
 * @property address Destination address for the output
 * @property value Value of the output
 * @property timelock Optional timelock for the output
 * @property token Token UID for the output
 */
export interface ProposedOutput {
  address: string;
  value: OutputValueType;
  timelock?: number;
  token: string;
}

/**
 * Proposed input for a transaction
 * @property txId Transaction ID of the input
 * @property index Index of the output being spent
 * @property token Token UID of the input
 */
export interface ProposedInput {
  txId: string;
  index: number;
  token: string;
}

export interface SendTransactionFullnodeOptions {
  changeAddress?: string | null;
  token?: string;
  pinCode?: string | null;
}

/**
 * Options for sending many outputs transaction
 * @property inputs Optional array of proposed inputs to use
 * @property changeAddress Address for change output
 * @property startMiningTx Boolean to trigger start mining (default true)
 * @property pinCode Pin to decrypt xpriv information
 */
export interface SendManyOutputsOptions {
  inputs?: ProposedInput[];
  changeAddress?: string | null;
  startMiningTx?: boolean;
  pinCode?: string | null;
}

/**
 * Options for creating a token
 * @property address Destination address for the minted tokens
 * @property changeAddress Address for change output
 * @property startMiningTx Boolean to trigger start mining (default true)
 * @property pinCode Pin to decrypt xpriv information
 * @property createMint If should create a mint authority output
 * @property mintAuthorityAddress Address to send the mint authority output to
 * @property allowExternalMintAuthorityAddress Allow the mint authority address to be from another wallet
 * @property createMelt If should create a melt authority output
 * @property meltAuthorityAddress Address to send the melt authority output to
 * @property allowExternalMeltAuthorityAddress Allow the melt authority address to be from another wallet
 * @property data List of data strings to create data outputs
 * @property signTx Sign transaction instance (default true)
 * @property isCreateNFT If this token is an NFT
 * @property tokenVersion Version of the token to create
 */
export interface CreateTokenOptions {
  address?: string | null;
  changeAddress?: string | null;
  startMiningTx?: boolean;
  pinCode?: string | null;
  createMint?: boolean;
  mintAuthorityAddress?: string | null;
  allowExternalMintAuthorityAddress?: boolean;
  createMelt?: boolean;
  meltAuthorityAddress?: string | null;
  allowExternalMeltAuthorityAddress?: boolean;
  data?: string[] | null;
  signTx?: boolean;
  isCreateNFT?: boolean;
  tokenVersion?: TokenVersion;
}

export type CreateNFTOptions = Omit<CreateTokenOptions, 'data' | 'isCreateNFT'>;

/**
 * Return type for getBalance method
 */
export interface GetBalanceFullnodeFacadeReturnType {
  token: { id: string; name: string; symbol: string; version?: TokenVersion };
  balance: { unlocked: bigint; locked: bigint };
  transactions?: number;
  lockExpires: null;
  tokenAuthorities: {
    unlocked: { mint: bigint; melt: bigint };
    locked: { mint: bigint; melt: bigint };
  };
}

/**
 * Return type for getTxHistory method - individual transaction summary
 */
export interface GetTxHistoryFullnodeFacadeReturnType {
  txId: string;
  balance: bigint;
  timestamp: number;
  voided: boolean;
  version: number;
  ncId?: string;
  ncMethod?: string;
  ncCaller?: Address; // Address type
  firstBlock?: string;
}

/**
 * Return type for getTokenDetails method
 */
export interface GetTokenDetailsFullnodeFacadeReturnType {
  totalSupply: bigint;
  totalTransactions: number;
  tokenInfo: { id: string; name: string; symbol: string; version?: TokenVersion };
  authorities: { mint: boolean; melt: boolean };
}

/**
 * Return type for getTxById method - individual token details in transaction
 */
export interface GetTxByIdTokenDetails {
  txId: string;
  timestamp: number;
  version: number;
  voided: boolean;
  weight: number;
  tokenId: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  balance: bigint;
}

/**
 * Return type for getTxById method
 */
export interface GetTxByIdFullnodeFacadeReturnType {
  success: boolean;
  txTokens: GetTxByIdTokenDetails[];
}

export interface IWalletInputInfo {
  inputIndex: number;
  addressIndex: number;
  addressPath: string;
}

export interface ISignature extends IWalletInputInfo {
  signature: string;
  pubkey: string;
}
