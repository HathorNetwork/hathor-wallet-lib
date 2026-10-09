/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export enum ErrorMessages {
  UNEXPECTED_PUSH_TX_ERROR = 'unexpected-push-tx-error',
  TRANSACTION_IS_NULL = 'transaction-is-null',
  INVALID_INPUT = 'invalid-input',
  NO_UTXOS_AVAILABLE = 'no-utxos-available',
  UNSUPPORTED_TX_TYPE = 'unsupported-tx-type',
  WALLET_STATUS_ERROR = 'wallet-status-error',
  // Default error code for wallet errors
  DEFAULT_WALLET_ERROR = 'wallet-error',
  // When the password/pin is correct but the encrypted data is corrupted
  DECRYPTION_ERROR = 'decrypt-error',
  // When the given password/pin is invalid
  INVALID_PASSWD = 'invalid-passwd',
  // PBKDF2 encryption requires a hasher algo and we currently support:
  // sha1, sha256
  UNSUPPORTED_HASHER = 'unsupported-hasher',
  // When access data is not set
  UNINITIALIZED_WALLET = 'uninitialized-wallet',
  // Any request error
  REQUEST_ERROR = 'request-error',
  // Any request error for nano contracts APIs
  NANO_REQUEST_ERROR = 'nano-request-error',
  // 404 request error for nano contracts APIs
  NANO_REQUEST_ERROR_404 = 'nano-request-error-404',
  // Error when creating nano contract transaction
  NANO_TRANSACTION_CREATE_ERROR = 'nano-transaction-create-error',
  // Error when parsing nano contract transaction
  NANO_TRANSACTION_PARSE_ERROR = 'nano-transaction-parse-error',
  // Error when parsing an oracle script
  NANO_ORACLE_PARSE_ERROR = 'nano-oracle-parse-error',
  // When PIN is required in a method and not set
  PIN_REQUIRED = 'pin-required',
  HAS_TX_OUTSIDE_FIRST_ADDRESS = 'has-tx-outside-first-address',
  // Shielded key errors (ShieldedKeyError.errorCode)
  // The password does not decrypt the words the shielded keys are derived from
  SHIELDED_WRONG_PASSWORD = 'shielded-wrong-password',
  // The PIN does not decrypt the wallet's keys
  SHIELDED_WRONG_PIN = 'shielded-wrong-pin',
  // The words and passphrase give a root that does not derive the wallet's own keys
  SHIELDED_PASSPHRASE_MISMATCH = 'shielded-passphrase-mismatch',
  // The record has no encrypted scan key, or no scan xpub to check it against
  SHIELDED_NO_KEYS = 'shielded-no-keys',
  // The PIN decrypts the scan key record, but it holds no valid extended private key
  SHIELDED_CORRUPT_KEY = 'shielded-corrupt-key',
  // The scan key the PIN decrypts is not the key of the record's scan xpub
  SHIELDED_KEY_MISMATCH = 'shielded-key-mismatch',
  // The wallet is not started, or it was stopped or started again meanwhile
  SHIELDED_NOT_STARTED = 'shielded-not-started',
  // The wallet is multisig, whose shielded keys are single-signature keys
  SHIELDED_MULTISIG = 'shielded-multisig',
  // The wallet's scan key is not unlocked, so it cannot decode its shielded outputs
  SHIELDED_LOCKED = 'shielded-locked',
  // The wallet's shielded keys do not match each other, so they are not used
  SHIELDED_INTEGRITY = 'shielded-integrity',
  // No shielded crypto provider is registered
  SHIELDED_NO_PROVIDER = 'shielded-no-provider',
  // The wallet cannot process its history in its current state
  SHIELDED_NOT_READY = 'shielded-not-ready',
}
