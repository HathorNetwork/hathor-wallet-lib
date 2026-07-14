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
 * Native token uid as 32-byte hex (used in cryptographic operations such as shielded outputs)
 */
export const NATIVE_TOKEN_UID_HEX: string = '00'.repeat(32);

/**
 * Zero blinding factor (32 zero bytes) representing transparent (unblinded)
 * inputs/outputs in Pedersen commitment balance equations.
 */
export const ZERO_TWEAK: Buffer = Buffer.alloc(32, 0);

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
 * Shape of the per-network weight constants consumed by
 * {@link Transaction.calculateWeight}. Network values arrive via the
 * fullnode's /version response and are normalised by
 * `transactionUtils.getWeightConstantsFromStorage`; the hardcoded
 * {@link TX_WEIGHT_CONSTANTS} below is the fallback used when the
 * version data hasn't been fetched yet.
 */
export interface TxWeightConstants {
  txMinWeight: number;
  txWeightCoefficient: number;
  txMinWeightK: number;
}

/**
 * Constants to calculate weight
 */
export const TX_WEIGHT_CONSTANTS: TxWeightConstants = {
  txMinWeight: 14,
  txWeightCoefficient: 1.6,
  txMinWeightK: 100,
};

/**
 * Maximum number of inputs
 */
export const MAX_INPUTS: number = 255;

/**
 * Maximum number of transparent outputs
 */
export const MAX_OUTPUTS: number = 255;

/**
 * Maximum number of shielded outputs
 */
export const MAX_SHIELDED_OUTPUTS: number = 32;

/**
 * Decoded byte length of a legacy (P2PKH/P2SH) address:
 * version(1) + hash(20) + checksum(4)
 */
export const LEGACY_ADDRESS_SIZE_BYTES: number = 25;

/**
 * Decoded byte length of a shielded address:
 * version(1) + scan_pubkey(33) + spend_pubkey(33) + checksum(4)
 */
export const SHIELDED_ADDRESS_SIZE_BYTES: number = 71;

/**
 * Maximum serialized size (bytes) of a shielded output's range proof.
 * Mirrors hathor-core's MAX_RANGE_PROOF_SIZE.
 */
export const MAX_RANGE_PROOF_SIZE: number = 3328;

/**
 * Maximum serialized size (bytes) of a FullShielded output's surjection proof.
 * Mirrors hathor-core's MAX_SURJECTION_PROOF_SIZE.
 */
export const MAX_SURJECTION_PROOF_SIZE: number = 4096;

/**
 * Maximum serialized size (bytes) of a shielded output's locking script.
 * Mirrors hathor-core's MAX_SHIELDED_OUTPUT_SCRIPT_SIZE.
 */
export const MAX_SHIELDED_OUTPUT_SCRIPT_SIZE: number = 1024;

/**
 * Maximum surjection-proof domain size (one entry per input generator).
 * secp256k1-zkp aborts UNCATCHABLY (SIGABRT) past this limit, so the wallet
 * must reject oversized domains before calling the prover.
 */
export const MAX_SURJECTION_DOMAIN: number = 256;

/**
 * Exclusive upper bound for a shielded output value. The shipped range proof
 * (`@hathor/ct-crypto-node`, min_bits=40) covers `[1, 2^40)`; the fullnode
 * enforces no explicit value ceiling (only a range-proof byte-size cap), so the
 * wallet is the only place an over-cap value can be caught (balance is verified
 * by commitment, never by cleartext value).
 */
export const MAX_SHIELDED_OUTPUT_VALUE: OutputValueType = 1n << 40n;

/**
 * Byte length of a secp256k1 scalar (a blinding factor / tweak).
 */
export const BLINDING_FACTOR_SIZE_BYTES: number = 32;

/**
 * Maximum number of fee entries in a FeeHeader
 */
export const MAX_FEE_HEADER_ENTRIES: number = 16;

/**
 * Percentage of Hathor to deposit when creating a token.
 *
 * Kept as a float for display purposes and backwards compatibility. Deposit and withdraw
 * amounts are computed from the integer {@link TOKEN_DEPOSIT_PERCENTAGE_NUMERATOR} /
 * {@link TOKEN_DEPOSIT_PERCENTAGE_DENOMINATOR} fraction to avoid float precision loss.
 */
export const TOKEN_DEPOSIT_PERCENTAGE: number = 0.01;

/**
 * Token deposit/withdraw percentage expressed as an integer fraction in parts per billion,
 * where 10**7 / 10**9 = 0.01 = 1%. Representing the percentage as a numerator/denominator pair
 * (instead of a float) lets the deposit and withdraw amounts be computed with exact integer math.
 */
export const TOKEN_DEPOSIT_PERCENTAGE_NUMERATOR: bigint = 10n ** 7n;
export const TOKEN_DEPOSIT_PERCENTAGE_DENOMINATOR: bigint = 10n ** 9n;

/**
 * Timeout in milliseconds to call the method to set all selected outputs of a tx as 'selected': false
 */
export const SELECT_OUTPUTS_TIMEOUT: number = 1000 * 60;

/**
 * Size in bytes of a transaction hash (32 bytes).
 *
 * Also the size of a token UID, because a token's UID is the hash of the
 * transaction that created it.
 */
export const TX_HASH_SIZE_BYTES: number = 32;

/**
 * Size in bytes of a compressed SEC1-encoded EC public key (33 bytes:
 * 1 prefix byte indicating Y parity + 32 X-coordinate bytes).
 *
 * Used for shielded scan/spend pubkeys and any other compressed
 * secp256k1 public key the wallet validates at a trust boundary.
 */
export const COMPRESSED_PUBKEY_SIZE_BYTES: number = 33;

/**
 * Byte length of a raw secp256k1 private key (a 32-byte scalar).
 *
 * Used when materializing a derived key as raw bytes for the native ct-crypto
 * (ECDH) boundary, where `{ size }` zero-pads keys with leading zeros.
 * Numerically equal to BLINDING_FACTOR_SIZE_BYTES (both are secp256k1 scalars)
 * but kept distinct for call-site clarity.
 */
export const PRIVATE_KEY_SIZE_BYTES: number = 32;

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
 * Account path for shielded scan keys (ECDH / view-only access to shielded outputs).
 * Uses a separate account from legacy P2PKH (account 0') so that the scan key only
 * grants read access to shielded outputs, not spending authority over legacy funds.
 * This separation is critical for view key delegation (e.g., scanning services) and
 * prevents compromising legacy address signing keys when debugging shielded decryption.
 */
export const SHIELDED_SCAN_ACCT_PATH = `m/44'/${HATHOR_BIP44_CODE}'/1'`;

/**
 * Account path for shielded spend keys (signing/spending authority).
 * Uses account 2' to remain separate from both legacy (0') and scan (1') keys.
 */
export const SHIELDED_SPEND_ACCT_PATH = `m/44'/${HATHOR_BIP44_CODE}'/2'`;

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
 * Fee per AmountShielded output (in HTR base units).
 * Defined by hathor-core shielded transaction protocol (no external docs yet).
 */
export const FEE_PER_AMOUNT_SHIELDED_OUTPUT: bigint = 1n;

/**
 * Fee per FullShielded output (in HTR base units).
 * Defined by hathor-core shielded transaction protocol (no external docs yet).
 */
export const FEE_PER_FULL_SHIELDED_OUTPUT: bigint = 2n;

/**
 * Fee divisor
 */
export const FEE_DIVISOR: number = Number(
  TOKEN_DEPOSIT_PERCENTAGE_DENOMINATOR / TOKEN_DEPOSIT_PERCENTAGE_NUMERATOR
);

/**
 * Max argument length in bytes (64Kib)
 */
export const NC_ARGS_MAX_BYTES_LENGTH = 2n ** 16n;
