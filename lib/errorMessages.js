"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ErrorMessages = void 0;
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
let ErrorMessages = exports.ErrorMessages = /*#__PURE__*/function (ErrorMessages) {
  ErrorMessages["UNEXPECTED_PUSH_TX_ERROR"] = "unexpected-push-tx-error";
  ErrorMessages["TRANSACTION_IS_NULL"] = "transaction-is-null";
  ErrorMessages["INVALID_INPUT"] = "invalid-input";
  ErrorMessages["NO_UTXOS_AVAILABLE"] = "no-utxos-available";
  ErrorMessages["UNSUPPORTED_TX_TYPE"] = "unsupported-tx-type";
  ErrorMessages["WALLET_STATUS_ERROR"] = "wallet-status-error";
  ErrorMessages["DEFAULT_WALLET_ERROR"] = "wallet-error";
  ErrorMessages["DECRYPTION_ERROR"] = "decrypt-error";
  ErrorMessages["INVALID_PASSWD"] = "invalid-passwd";
  ErrorMessages["UNSUPPORTED_HASHER"] = "unsupported-hasher";
  ErrorMessages["UNINITIALIZED_WALLET"] = "uninitialized-wallet";
  ErrorMessages["REQUEST_ERROR"] = "request-error";
  ErrorMessages["NANO_REQUEST_ERROR"] = "nano-request-error";
  ErrorMessages["NANO_REQUEST_ERROR_404"] = "nano-request-error-404";
  ErrorMessages["NANO_TRANSACTION_CREATE_ERROR"] = "nano-transaction-create-error";
  ErrorMessages["NANO_TRANSACTION_PARSE_ERROR"] = "nano-transaction-parse-error";
  ErrorMessages["NANO_ORACLE_PARSE_ERROR"] = "nano-oracle-parse-error";
  ErrorMessages["PIN_REQUIRED"] = "pin-required";
  return ErrorMessages;
}({});