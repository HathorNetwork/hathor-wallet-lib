/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AddressScanPolicy, OutputValueType, SCANNING_POLICY, TokenVersion } from './types';

/**
 * Constants defined for the Hathor Wallet
 * @module Constants
 */

/**
 * Quantity of decimal places of tokens amount
 */
export const DECIMAL_PLACES: number = 2;

/**
 * How many addresses we can have without being used
 */
export const GAP_LIMIT: number = 20;

/**
 * The maximum number of addresses to add in the address_history GET request
 */
export const MAX_ADDRESSES_GET: number = 20;

/**
 * Minimum expected API version
 */
export const MIN_API_VERSION: string = '0.37.2';

/**
 * If we should forbid to generate a quantity of unused addresses more than the GAP_LIMIT
 */
export const LIMIT_ADDRESS_GENERATION: boolean = true;

/**
 * Hathor address BIP44 code
 * (listed here: https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
 */
export const HATHOR_BIP44_CODE = 280;

/**
 * Auth derivation path used for auth on the Wallet Service facade
 */
export const WALLET_SERVICE_AUTH_DERIVATION_PATH = `m/${HATHOR_BIP44_CODE}'/${HATHOR_BIP44_CODE}'`;

/**
 * Default signalBits value
 */
export const DEFAULT_SIGNAL_BITS = 0;

/**
 * Block version field
 */
export const BLOCK_VERSION = 0;

/**
 * Transaction version field
 */
export const DEFAULT_TX_VERSION = 1;

/**
 * Create token transaction version field
 */
export const CREATE_TOKEN_TX_VERSION = 2;

/**
 * Merged mined block version field
 */
export const MERGED_MINED_BLOCK_VERSION = 3;

/**
 * On chain blueprints transaction version field
 */
export const ON_CHAIN_BLUEPRINTS_VERSION = 6;

/**
 * Proof-of-Authority block version field
 */
export const POA_BLOCK_VERSION = 5;

/**
 * String with the name of the initialize method of all blueprints
 */
export const NANO_CONTRACTS_INITIALIZE_METHOD = 'initialize';

/**
 * On chain blueprints information version
 * If we decide to change the serialization of the object information
 * data, then we can change this version, so we can
 * correctly deserialize all the on chain blueprint transactions
 */
export const ON_CHAIN_BLUEPRINTS_INFO_VERSION = 1;

/**
 * Max value (inclusive) before having to use 8 bytes: 2147483648 ~= 2.14748e+09
 */
export const MAX_OUTPUT_VALUE_32: OutputValueType = 2n ** 31n - 1n;

/**
 * Max accepted value for an output
 */
export const MAX_OUTPUT_VALUE: OutputValueType = 2n ** 63n;

/**
 * Entropy for the new HD wallet words
 */
export const HD_WALLET_ENTROPY: number = 256;

/**
 * Mask to get token index from token data
 */
export const TOKEN_INDEX_MASK: number = 0b01111111;

/**
 * Mask to check if it's authority output (first bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
export const TOKEN_AUTHORITY_MASK: number = 0b10000000;

/**
 * Mask to check if it's mint UTXO (last bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
export const TOKEN_MINT_MASK: OutputValueType = 0b00000001n;

/**
 * Mask to check if it's melt UTXO (second to last bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
export const TOKEN_MELT_MASK: OutputValueType = 0b00000010n;

/**
 * Token data for an authority output of the first token in a transaction.
 * As most transactions with authority outputs have only one token, it may be directly used, as a shortcut.
 */
export const AUTHORITY_TOKEN_DATA = TOKEN_AUTHORITY_MASK | 1;

/**
 * Native token uid
 */
export const NATIVE_TOKEN_UID: string = '00';

/**
 * Default HTR token config
 */
export const DEFAULT_NATIVE_TOKEN_CONFIG = {
  name: 'Hathor',
  symbol: 'HTR',
  version: TokenVersion.NATIVE,
};

/**
 * Hathor token default index
 */
export const HATHOR_TOKEN_INDEX: number = 0;

/**
 * Default timeout for each request in milliseconds
 */
export const TIMEOUT: number = 10000;

/**
 * Default timeout for send tokens request in milliseconds
 */
export const SEND_TOKENS_TIMEOUT: number = 300000;

/**
 * A default value for retrying failed requests, in case a wallet instance does not have it properly set.
 */
export const REQUEST_DEFAULT_MAX_RETRIES = 3;
/**
 * A default base delay in milliseconds for retrying failed requests, in case a wallet instance does not have it properly set.
 */
export const REQUEST_DEFAULT_RETRY_DELAY_BASE_MS = 100;
/**
 * A default maximum delay in milliseconds for retrying failed requests, in case a wallet instance does not have it properly set.
 */
export const REQUEST_DEFAULT_RETRY_DELAY_MAX_MS = 1000;

/**
 * Number of iterations to execute when hashing the password
 *
 * Even though NIST recommeds at least 10,000 iterations (https://pages.nist.gov/800-63-3/sp800-63b.html#sec5),
 * some tests show that it takes ~3s in iPhone 7 and ~1,5s in Galaxy S8.
 * That's why we have decided to keep the default as 1,000 for now.
 */
export const HASH_ITERATIONS: number = 1000;

/**
 * Size of the key to hash the password (in bits).
 *
 * CryptoJS expects the size in words so this will be converted in code.
 * The conversion is done by dividing by 32, so HASH_KEY_SIZE needs to be a multiple of 32.
 *
 * Actual keySize will be 256/32 = 8 words.
 */
export const HASH_KEY_SIZE: number = 256;

/**
 * Return code of the send_tokens response when there is a stratum timeout
 */
export const STRATUM_TIMEOUT_RETURN_CODE = 'stratum_timeout';

/**
 * Minimum job status poll to update job data when mining a tx
 */
export const MIN_POLLING_INTERVAL: number = 0.5;

/**
 * Constants to calculate weight
 */
export const TX_WEIGHT_CONSTANTS = {
  txMinWeight: 14,
  txWeightCoefficient: 1.6,
  txMinWeightK: 100,
};

/**
 * Maximum number of inputs
 */
export const MAX_INPUTS: number = 255;

/**
 * Maximum number of outputs
 */
export const MAX_OUTPUTS: number = 255;

/**
 * Maximum number of fee entries in a FeeHeader
 */
export const MAX_FEE_HEADER_ENTRIES: number = 16;

/**
 * Percentage of Hathor to deposit when creating a token
 */
export const TOKEN_DEPOSIT_PERCENTAGE: number = 0.01;

/**
 * Timeout in milliseconds to call the method to set all selected outputs of a tx as 'selected': false
 */
export const SELECT_OUTPUTS_TIMEOUT: number = 1000 * 60;

/**
 * Size in bytes of a transaction hash (32 bytes)
 */
export const TX_HASH_SIZE_BYTES: number = 32;

/**
 * Maximum number of retries allowed when an error different
 * from client timeout happens when loading wallet history
 */
export const LOAD_WALLET_MAX_RETRY: number = 5;

/**
 * Time in milliseconds between each load wallet retry
 */
export const LOAD_WALLET_RETRY_SLEEP: number = 5000;

/**
 * Limit of retries when downloading token metadata
 */
export const METADATA_RETRY_LIMIT: number = 3;

/**
 * Interval between metadata download retries in milliseconds
 */
export const DOWNLOAD_METADATA_RETRY_INTERVAL: number = 5000;

/**
 * Maximum characters of created token name
 */
export const MAX_TOKEN_NAME_SIZE: number = 30;

/**
 * Maximum characters of created token symbol
 */
export const MAX_TOKEN_SYMBOL_SIZE: number = 5;

/**
 * Account path for P2SH MultiSig
 * account is the last hardened level
 */
export const P2SH_ACCT_PATH = `m/45'/${HATHOR_BIP44_CODE}'/0'`;

/**
 * Account path for P2PKH
 * account is the last hardened level
 */
export const P2PKH_ACCT_PATH = `m/44'/${HATHOR_BIP44_CODE}'/0'`;

/**
 * String to be prefixed before signed messages using bitcore-message
 */
export const HATHOR_MAGIC_BYTES = 'Hathor Signed Message:\n';

/**
 * Default address scanning policy
 */
export const DEFAULT_ADDRESS_SCANNING_POLICY: AddressScanPolicy = SCANNING_POLICY.GAP_LIMIT;

/**
 * Fee per output
 */
export const FEE_PER_OUTPUT: bigint = 1n;

/**
 * Max argument length in bytes (64Kib)
 */
export const NC_ARGS_MAX_BYTES_LENGTH = 2n ** 16n;
