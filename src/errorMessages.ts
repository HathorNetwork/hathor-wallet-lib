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
  // When PIN is required in a method and not set
  PIN_REQUIRED = 'pin-required',
}
