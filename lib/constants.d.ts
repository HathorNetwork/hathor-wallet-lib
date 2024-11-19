/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { AddressScanPolicy, OutputValueType } from './types';
/**
 * Constants defined for the Hathor Wallet
 * @module Constants
 */
/**
 * Quantity of decimal places of tokens amount
 */
export declare const DECIMAL_PLACES: number;
/**
 * How many addresses we can have without being used
 */
export declare const GAP_LIMIT: number;
/**
 * The maximum number of addresses to add in the address_history GET request
 */
export declare const MAX_ADDRESSES_GET: number;
/**
 * Minimum expected API version
 */
export declare const MIN_API_VERSION: string;
/**
 * If we should forbid to generate a quantity of unused addresses more than the GAP_LIMIT
 */
export declare const LIMIT_ADDRESS_GENERATION: boolean;
/**
 * Hathor address BIP44 code
 * (listed here: https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
 */
export declare const HATHOR_BIP44_CODE = 280;
/**
 * Auth derivation path used for auth on the Wallet Service facade
 */
export declare const WALLET_SERVICE_AUTH_DERIVATION_PATH = "m/280'/280'";
/**
 * Default signalBits value
 */
export declare const DEFAULT_SIGNAL_BITS = 0;
/**
 * Block version field
 */
export declare const BLOCK_VERSION = 0;
/**
 * Transaction version field
 */
export declare const DEFAULT_TX_VERSION = 1;
/**
 * Create token transaction version field
 */
export declare const CREATE_TOKEN_TX_VERSION = 2;
/**
 * Merged mined block version field
 */
export declare const MERGED_MINED_BLOCK_VERSION = 3;
/**
 * Nano Contracts transaction version field
 */
export declare const NANO_CONTRACTS_VERSION = 4;
/**
 * Proof-of-Authority block version field
 */
export declare const POA_BLOCK_VERSION = 5;
/**
 * Nano Contracts information version
 * If we decide to change the serialization of nano information
 * data, then we can change this version, so we can
 * correctly deserialize all the nano contract transactions
 */
export declare const NANO_CONTRACTS_INFO_VERSION = 1;
/**
 * String with the name of the initialize method of all blueprints
 */
export declare const NANO_CONTRACTS_INITIALIZE_METHOD = "initialize";
/**
 * Create token information version
 * so far we expect name and symbol
 */
export declare const TOKEN_INFO_VERSION = 1;
/**
 * Max value (inclusive) before having to use 8 bytes: 2147483648 ~= 2.14748e+09
 */
export declare const MAX_OUTPUT_VALUE_32: OutputValueType;
/**
 * Max accepted value for an output
 */
export declare const MAX_OUTPUT_VALUE: OutputValueType;
/**
 * Entropy for the new HD wallet words
 */
export declare const HD_WALLET_ENTROPY: number;
/**
 * Mask to get token index from token data
 */
export declare const TOKEN_INDEX_MASK: number;
/**
 * Mask to check if it's authority output (first bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
export declare const TOKEN_AUTHORITY_MASK: number;
/**
 * Mask to check if it's mint UTXO (last bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
export declare const TOKEN_MINT_MASK: OutputValueType;
/**
 * Mask to check if it's melt UTXO (second to last bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
export declare const TOKEN_MELT_MASK: OutputValueType;
/**
 * Token data for an authority output of the first token in a transaction.
 * As most transactions with authority outputs have only one token, it may be directly used, as a shortcut.
 */
export declare const AUTHORITY_TOKEN_DATA: number;
/**
 * Native token uid
 */
export declare const NATIVE_TOKEN_UID: string;
/**
 * Default HTR token config
 */
export declare const DEFAULT_NATIVE_TOKEN_CONFIG: {
    name: string;
    symbol: string;
};
/**
 * Hathor token default index
 */
export declare const HATHOR_TOKEN_INDEX: number;
/**
 * Default timeout for each request in milliseconds
 */
export declare const TIMEOUT: number;
/**
 * Default timeout for send tokens request in milliseconds
 */
export declare const SEND_TOKENS_TIMEOUT: number;
/**
 * Number of iterations to execute when hashing the password
 *
 * Even though NIST recommeds at least 10,000 iterations (https://pages.nist.gov/800-63-3/sp800-63b.html#sec5),
 * some tests show that it takes ~3s in iPhone 7 and ~1,5s in Galaxy S8.
 * That's why we have decided to keep the default as 1,000 for now.
 */
export declare const HASH_ITERATIONS: number;
/**
 * Size of the key to hash the password (in bits).
 *
 * CryptoJS expects the size in words so this will be converted in code.
 * The conversion is done by dividing by 32, so HASH_KEY_SIZE needs to be a multiple of 32.
 *
 * Actual keySize will be 256/32 = 8 words.
 */
export declare const HASH_KEY_SIZE: number;
/**
 * Return code of the send_tokens response when there is a stratum timeout
 */
export declare const STRATUM_TIMEOUT_RETURN_CODE = "stratum_timeout";
/**
 * Minimum job status poll to update job data when mining a tx
 */
export declare const MIN_POLLING_INTERVAL: number;
/**
 * Constants to calculate weight
 */
export declare const TX_WEIGHT_CONSTANTS: {
    txMinWeight: number;
    txWeightCoefficient: number;
    txMinWeightK: number;
};
/**
 * Maximum number of inputs
 */
export declare const MAX_INPUTS: number;
/**
 * Maximum number of outputs
 */
export declare const MAX_OUTPUTS: number;
/**
 * Percentage of Hathor to deposit when creating a token
 */
export declare const TOKEN_DEPOSIT_PERCENTAGE: number;
/**
 * Timeout in milliseconds to call the method to set all selected outputs of a tx as 'selected': false
 */
export declare const SELECT_OUTPUTS_TIMEOUT: number;
/**
 * Size in bytes of a transaction hash (32 bytes)
 */
export declare const TX_HASH_SIZE_BYTES: number;
/**
 * Maximum number of retries allowed when an error different
 * from client timeout happens when loading wallet history
 */
export declare const LOAD_WALLET_MAX_RETRY: number;
/**
 * Time in milliseconds between each load wallet retry
 */
export declare const LOAD_WALLET_RETRY_SLEEP: number;
/**
 * Limit of retries when downloading token metadata
 */
export declare const METADATA_RETRY_LIMIT: number;
/**
 * Interval between metadata download retries in milliseconds
 */
export declare const DOWNLOAD_METADATA_RETRY_INTERVAL: number;
/**
 * Maximum characters of created token name
 */
export declare const MAX_TOKEN_NAME_SIZE: number;
/**
 * Maximum characters of created token symbol
 */
export declare const MAX_TOKEN_SYMBOL_SIZE: number;
/**
 * Account path for P2SH MultiSig
 * account is the last hardened level
 */
export declare const P2SH_ACCT_PATH = "m/45'/280'/0'";
/**
 * Account path for P2PKH
 * account is the last hardened level
 */
export declare const P2PKH_ACCT_PATH = "m/44'/280'/0'";
/**
 * String to be prefixed before signed messages using bitcore-message
 */
export declare const HATHOR_MAGIC_BYTES = "Hathor Signed Message:\n";
/**
 * Default address scanning policy
 */
export declare const DEFAULT_ADDRESS_SCANNING_POLICY: AddressScanPolicy;
//# sourceMappingURL=constants.d.ts.map