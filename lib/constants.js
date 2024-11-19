"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WALLET_SERVICE_AUTH_DERIVATION_PATH = exports.TX_WEIGHT_CONSTANTS = exports.TX_HASH_SIZE_BYTES = exports.TOKEN_MINT_MASK = exports.TOKEN_MELT_MASK = exports.TOKEN_INFO_VERSION = exports.TOKEN_INDEX_MASK = exports.TOKEN_DEPOSIT_PERCENTAGE = exports.TOKEN_AUTHORITY_MASK = exports.TIMEOUT = exports.STRATUM_TIMEOUT_RETURN_CODE = exports.SEND_TOKENS_TIMEOUT = exports.SELECT_OUTPUTS_TIMEOUT = exports.POA_BLOCK_VERSION = exports.P2SH_ACCT_PATH = exports.P2PKH_ACCT_PATH = exports.NATIVE_TOKEN_UID = exports.NANO_CONTRACTS_VERSION = exports.NANO_CONTRACTS_INITIALIZE_METHOD = exports.NANO_CONTRACTS_INFO_VERSION = exports.MIN_POLLING_INTERVAL = exports.MIN_API_VERSION = exports.METADATA_RETRY_LIMIT = exports.MERGED_MINED_BLOCK_VERSION = exports.MAX_TOKEN_SYMBOL_SIZE = exports.MAX_TOKEN_NAME_SIZE = exports.MAX_OUTPUT_VALUE_32 = exports.MAX_OUTPUT_VALUE = exports.MAX_OUTPUTS = exports.MAX_INPUTS = exports.MAX_ADDRESSES_GET = exports.LOAD_WALLET_RETRY_SLEEP = exports.LOAD_WALLET_MAX_RETRY = exports.LIMIT_ADDRESS_GENERATION = exports.HD_WALLET_ENTROPY = exports.HATHOR_TOKEN_INDEX = exports.HATHOR_MAGIC_BYTES = exports.HATHOR_BIP44_CODE = exports.HASH_KEY_SIZE = exports.HASH_ITERATIONS = exports.GAP_LIMIT = exports.DOWNLOAD_METADATA_RETRY_INTERVAL = exports.DEFAULT_TX_VERSION = exports.DEFAULT_SIGNAL_BITS = exports.DEFAULT_NATIVE_TOKEN_CONFIG = exports.DEFAULT_ADDRESS_SCANNING_POLICY = exports.DECIMAL_PLACES = exports.CREATE_TOKEN_TX_VERSION = exports.BLOCK_VERSION = exports.AUTHORITY_TOKEN_DATA = void 0;
var _types = require("./types");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Constants defined for the Hathor Wallet
 * @module Constants
 */

/**
 * Quantity of decimal places of tokens amount
 */
const DECIMAL_PLACES = exports.DECIMAL_PLACES = 2;

/**
 * How many addresses we can have without being used
 */
const GAP_LIMIT = exports.GAP_LIMIT = 20;

/**
 * The maximum number of addresses to add in the address_history GET request
 */
const MAX_ADDRESSES_GET = exports.MAX_ADDRESSES_GET = 20;

/**
 * Minimum expected API version
 */
const MIN_API_VERSION = exports.MIN_API_VERSION = '0.37.2';

/**
 * If we should forbid to generate a quantity of unused addresses more than the GAP_LIMIT
 */
const LIMIT_ADDRESS_GENERATION = exports.LIMIT_ADDRESS_GENERATION = true;

/**
 * Hathor address BIP44 code
 * (listed here: https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
 */
const HATHOR_BIP44_CODE = exports.HATHOR_BIP44_CODE = 280;

/**
 * Auth derivation path used for auth on the Wallet Service facade
 */
const WALLET_SERVICE_AUTH_DERIVATION_PATH = exports.WALLET_SERVICE_AUTH_DERIVATION_PATH = `m/${HATHOR_BIP44_CODE}'/${HATHOR_BIP44_CODE}'`;

/**
 * Default signalBits value
 */
const DEFAULT_SIGNAL_BITS = exports.DEFAULT_SIGNAL_BITS = 0;

/**
 * Block version field
 */
const BLOCK_VERSION = exports.BLOCK_VERSION = 0;

/**
 * Transaction version field
 */
const DEFAULT_TX_VERSION = exports.DEFAULT_TX_VERSION = 1;

/**
 * Create token transaction version field
 */
const CREATE_TOKEN_TX_VERSION = exports.CREATE_TOKEN_TX_VERSION = 2;

/**
 * Merged mined block version field
 */
const MERGED_MINED_BLOCK_VERSION = exports.MERGED_MINED_BLOCK_VERSION = 3;

/**
 * Nano Contracts transaction version field
 */
const NANO_CONTRACTS_VERSION = exports.NANO_CONTRACTS_VERSION = 4;

/**
 * Proof-of-Authority block version field
 */
const POA_BLOCK_VERSION = exports.POA_BLOCK_VERSION = 5;

/**
 * Nano Contracts information version
 * If we decide to change the serialization of nano information
 * data, then we can change this version, so we can
 * correctly deserialize all the nano contract transactions
 */
const NANO_CONTRACTS_INFO_VERSION = exports.NANO_CONTRACTS_INFO_VERSION = 1;

/**
 * String with the name of the initialize method of all blueprints
 */
const NANO_CONTRACTS_INITIALIZE_METHOD = exports.NANO_CONTRACTS_INITIALIZE_METHOD = 'initialize';

/**
 * Create token information version
 * so far we expect name and symbol
 */
const TOKEN_INFO_VERSION = exports.TOKEN_INFO_VERSION = 1;

/**
 * Max value (inclusive) before having to use 8 bytes: 2147483648 ~= 2.14748e+09
 */
const MAX_OUTPUT_VALUE_32 = exports.MAX_OUTPUT_VALUE_32 = 2n ** 31n - 1n;

/**
 * Max accepted value for an output
 */
const MAX_OUTPUT_VALUE = exports.MAX_OUTPUT_VALUE = 2n ** 63n;

/**
 * Entropy for the new HD wallet words
 */
const HD_WALLET_ENTROPY = exports.HD_WALLET_ENTROPY = 256;

/**
 * Mask to get token index from token data
 */
const TOKEN_INDEX_MASK = exports.TOKEN_INDEX_MASK = 0b01111111;

/**
 * Mask to check if it's authority output (first bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
const TOKEN_AUTHORITY_MASK = exports.TOKEN_AUTHORITY_MASK = 0b10000000;

/**
 * Mask to check if it's mint UTXO (last bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
const TOKEN_MINT_MASK = exports.TOKEN_MINT_MASK = 0b00000001n;

/**
 * Mask to check if it's melt UTXO (second to last bit indicates it)
 * For further information: https://gitlab.com/HathorNetwork/rfcs/blob/master/text/0004-tokens.md
 */
const TOKEN_MELT_MASK = exports.TOKEN_MELT_MASK = 0b00000010n;

/**
 * Token data for an authority output of the first token in a transaction.
 * As most transactions with authority outputs have only one token, it may be directly used, as a shortcut.
 */
const AUTHORITY_TOKEN_DATA = exports.AUTHORITY_TOKEN_DATA = TOKEN_AUTHORITY_MASK | 1;

/**
 * Native token uid
 */
const NATIVE_TOKEN_UID = exports.NATIVE_TOKEN_UID = '00';

/**
 * Default HTR token config
 */
const DEFAULT_NATIVE_TOKEN_CONFIG = exports.DEFAULT_NATIVE_TOKEN_CONFIG = {
  name: 'Hathor',
  symbol: 'HTR'
};

/**
 * Hathor token default index
 */
const HATHOR_TOKEN_INDEX = exports.HATHOR_TOKEN_INDEX = 0;

/**
 * Default timeout for each request in milliseconds
 */
const TIMEOUT = exports.TIMEOUT = 10000;

/**
 * Default timeout for send tokens request in milliseconds
 */
const SEND_TOKENS_TIMEOUT = exports.SEND_TOKENS_TIMEOUT = 300000;

/**
 * Number of iterations to execute when hashing the password
 *
 * Even though NIST recommeds at least 10,000 iterations (https://pages.nist.gov/800-63-3/sp800-63b.html#sec5),
 * some tests show that it takes ~3s in iPhone 7 and ~1,5s in Galaxy S8.
 * That's why we have decided to keep the default as 1,000 for now.
 */
const HASH_ITERATIONS = exports.HASH_ITERATIONS = 1000;

/**
 * Size of the key to hash the password (in bits).
 *
 * CryptoJS expects the size in words so this will be converted in code.
 * The conversion is done by dividing by 32, so HASH_KEY_SIZE needs to be a multiple of 32.
 *
 * Actual keySize will be 256/32 = 8 words.
 */
const HASH_KEY_SIZE = exports.HASH_KEY_SIZE = 256;

/**
 * Return code of the send_tokens response when there is a stratum timeout
 */
const STRATUM_TIMEOUT_RETURN_CODE = exports.STRATUM_TIMEOUT_RETURN_CODE = 'stratum_timeout';

/**
 * Minimum job status poll to update job data when mining a tx
 */
const MIN_POLLING_INTERVAL = exports.MIN_POLLING_INTERVAL = 0.5;

/**
 * Constants to calculate weight
 */
const TX_WEIGHT_CONSTANTS = exports.TX_WEIGHT_CONSTANTS = {
  txMinWeight: 14,
  txWeightCoefficient: 1.6,
  txMinWeightK: 100
};

/**
 * Maximum number of inputs
 */
const MAX_INPUTS = exports.MAX_INPUTS = 255;

/**
 * Maximum number of outputs
 */
const MAX_OUTPUTS = exports.MAX_OUTPUTS = 255;

/**
 * Percentage of Hathor to deposit when creating a token
 */
const TOKEN_DEPOSIT_PERCENTAGE = exports.TOKEN_DEPOSIT_PERCENTAGE = 0.01;

/**
 * Timeout in milliseconds to call the method to set all selected outputs of a tx as 'selected': false
 */
const SELECT_OUTPUTS_TIMEOUT = exports.SELECT_OUTPUTS_TIMEOUT = 1000 * 60;

/**
 * Size in bytes of a transaction hash (32 bytes)
 */
const TX_HASH_SIZE_BYTES = exports.TX_HASH_SIZE_BYTES = 32;

/**
 * Maximum number of retries allowed when an error different
 * from client timeout happens when loading wallet history
 */
const LOAD_WALLET_MAX_RETRY = exports.LOAD_WALLET_MAX_RETRY = 5;

/**
 * Time in milliseconds between each load wallet retry
 */
const LOAD_WALLET_RETRY_SLEEP = exports.LOAD_WALLET_RETRY_SLEEP = 5000;

/**
 * Limit of retries when downloading token metadata
 */
const METADATA_RETRY_LIMIT = exports.METADATA_RETRY_LIMIT = 3;

/**
 * Interval between metadata download retries in milliseconds
 */
const DOWNLOAD_METADATA_RETRY_INTERVAL = exports.DOWNLOAD_METADATA_RETRY_INTERVAL = 5000;

/**
 * Maximum characters of created token name
 */
const MAX_TOKEN_NAME_SIZE = exports.MAX_TOKEN_NAME_SIZE = 30;

/**
 * Maximum characters of created token symbol
 */
const MAX_TOKEN_SYMBOL_SIZE = exports.MAX_TOKEN_SYMBOL_SIZE = 5;

/**
 * Account path for P2SH MultiSig
 * account is the last hardened level
 */
const P2SH_ACCT_PATH = exports.P2SH_ACCT_PATH = `m/45'/${HATHOR_BIP44_CODE}'/0'`;

/**
 * Account path for P2PKH
 * account is the last hardened level
 */
const P2PKH_ACCT_PATH = exports.P2PKH_ACCT_PATH = `m/44'/${HATHOR_BIP44_CODE}'/0'`;

/**
 * String to be prefixed before signed messages using bitcore-message
 */
const HATHOR_MAGIC_BYTES = exports.HATHOR_MAGIC_BYTES = 'Hathor Signed Message:\n';

/**
 * Default address scanning policy
 */
const DEFAULT_ADDRESS_SCANNING_POLICY = exports.DEFAULT_ADDRESS_SCANNING_POLICY = _types.SCANNING_POLICY.GAP_LIMIT;