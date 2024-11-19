"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.XPubError = exports.WalletTypeError = exports.WalletRequestError = exports.WalletFromXPubGuard = exports.WalletError = exports.UtxoError = exports.UnsupportedScriptError = exports.UnsupportedHasherError = exports.UninitializedWalletError = exports.UncompressedPubKeyError = exports.TxNotFoundError = exports.TokenValidationError = exports.SendTxError = exports.RequestError = exports.PinRequiredError = exports.PartialTxError = exports.ParseScriptError = exports.ParseError = exports.OutputValueError = exports.OracleParseError = exports.NftValidationError = exports.NanoRequestError = exports.NanoRequest404Error = exports.NanoContractTransactionParseError = exports.NanoContractTransactionError = exports.MineTxError = exports.MaximumNumberParentsError = exports.MaximumNumberOutputsError = exports.MaximumNumberInputsError = exports.InvalidWords = exports.InvalidPasswdError = exports.InvalidPartialTxError = exports.InvalidOutputsError = exports.InsufficientFundsError = exports.IndexOOBError = exports.GlobalLoadLockTaskError = exports.GetWalletServiceWsUrlError = exports.GetWalletServiceUrlError = exports.GetDagMetadataApiError = exports.DecryptionError = exports.CreateTokenTxInvalid = exports.ConstantNotSet = exports.ConfigNotSetError = exports.AddressError = void 0;
var _errorMessages = require("./errorMessages");
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ // eslint-disable-next-line max-classes-per-file -- This file is supposed to export classes
/**
 * Possible errors to be thrown in wallet
 *
 * @namespace Errors
 */

/**
 * Error thrown when address is invalid
 *
 * @memberof Errors
 * @inner
 */
class AddressError extends Error {}

/**
 * Error thrown when output value is invalid
 *
 * @memberof Errors
 * @inner
 */
exports.AddressError = AddressError;
class OutputValueError extends Error {}

/**
 * Error thrown when we have insufficient funds
 *
 * @memberof Errors
 * @inner
 */
exports.OutputValueError = OutputValueError;
class InsufficientFundsError extends Error {}

/**
 * Error thrown when a constant that we get from the server is not set
 *
 * @memberof Errors
 * @inner
 */
exports.InsufficientFundsError = InsufficientFundsError;
class ConstantNotSet extends Error {}

/**
 * Error thrown when a create token tx has invalid info
 *
 * @memberof Errors
 * @inner
 */
exports.ConstantNotSet = ConstantNotSet;
class CreateTokenTxInvalid extends Error {}

/**
 * Error thrown when validating a registration of new token
 *
 * @memberof Errors
 * @inner
 */
exports.CreateTokenTxInvalid = CreateTokenTxInvalid;
class TokenValidationError extends Error {}

/**
 * Error thrown when validating a registration of new NFT
 *
 * @memberof Errors
 * @inner
 */
exports.TokenValidationError = TokenValidationError;
class NftValidationError extends Error {}

/**
 * Error thrown when transaction has more inputs than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
exports.NftValidationError = NftValidationError;
class MaximumNumberInputsError extends Error {}

/**
 * Error thrown when transaction has more outputs than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
exports.MaximumNumberInputsError = MaximumNumberInputsError;
class MaximumNumberOutputsError extends Error {}

/**
 * Error thrown when transaction has invalid outputs
 *
 * @memberof Errors
 * @inner
 */
exports.MaximumNumberOutputsError = MaximumNumberOutputsError;
class InvalidOutputsError extends Error {}

/**
 * Error thrown when transaction has more parents than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
exports.InvalidOutputsError = InvalidOutputsError;
class MaximumNumberParentsError extends Error {}

/**
 * Error thrown when the wallet type is invalid
 *
 * @memberof Errors
 * @inner
 */
exports.MaximumNumberParentsError = MaximumNumberParentsError;
class WalletTypeError extends Error {}

/**
 * Error thrown when we are given an invalid xpubkey
 *
 * @memberof Errors
 * @inner
 */
exports.WalletTypeError = WalletTypeError;
class XPubError extends Error {}

/**
 * Error thrown when we are given an invalid uncompressed public key
 *
 * @memberof Errors
 * @inner
 */
exports.XPubError = XPubError;
class UncompressedPubKeyError extends Error {}

/**
 * Error thrown when the user tries to create a wallet with an invalid sequence of words
 *
 * @memberof Errors
 * @inner
 */
exports.UncompressedPubKeyError = UncompressedPubKeyError;
class InvalidWords extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "invalidWords", []);
  }
}

/**
 * Error thrown when parsing bytes to an object
 *
 * @memberof Errors
 * @inner
 */
exports.InvalidWords = InvalidWords;
class ParseError extends Error {}

/**
 * Error thrown when parsing a script bytes
 *
 * @memberof Errors
 * @inner
 */
exports.ParseError = ParseError;
class ParseScriptError extends ParseError {}

/**
 * Error thrown when executing wallet operations
 *
 * @memberof Errors
 * @inner
 */
exports.ParseScriptError = ParseScriptError;
class WalletError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.DEFAULT_WALLET_ERROR);
  }
}

/**
 * Error thrown when executing wallet requests
 *
 * @memberof Errors
 * @inner
 */
exports.WalletError = WalletError;
class WalletRequestError extends WalletError {
  constructor(message, errorData = {
    cause: null
  }) {
    super(message);
    _defineProperty(this, "cause", null);
    this.cause = errorData.cause;
  }
}

/**
 * Error thrown when get utxo fails
 *
 * @memberof Errors
 * @inner
 */
exports.WalletRequestError = WalletRequestError;
class UtxoError extends WalletError {}

/**
 * Error thrown when sending tx
 *
 * @memberof Errors
 * @inner
 */
exports.UtxoError = UtxoError;
class SendTxError extends WalletError {
  constructor(...args) {
    super(...args);
    // XXX: There are only two out of dozens of places where this object is used instead of a string.
    //      This should be made consistently for strings
    _defineProperty(this, "errorData", '');
  }
}

/**
 * Error thrown when mining tx
 *
 * @memberof Errors
 * @inner
 */
exports.SendTxError = SendTxError;
class MineTxError extends WalletError {}

/**
 * Error thrown when trying to interact with an incomplete or invalid partial transaction.
 *
 * @memberof Errors
 * @inner
 */
exports.MineTxError = MineTxError;
class InvalidPartialTxError extends WalletError {}

/**
 * Error thrown when calling a protected method on an xpub inited wallet
 * Some methods require access to the words or private key
 *
 * @memberof Errors
 * @inner
 */
exports.InvalidPartialTxError = InvalidPartialTxError;
class WalletFromXPubGuard extends WalletError {}

/**
 * Error thrown when there is an error getting dag metadata using wallet service
 *
 * @memberof Errors
 * @inner
 */
exports.WalletFromXPubGuard = WalletFromXPubGuard;
class GetDagMetadataApiError extends Error {}

/**
 * Base Error class for Config not set errors
 *
 * @memberof Errors
 * @inner
 */
exports.GetDagMetadataApiError = GetDagMetadataApiError;
class ConfigNotSetError extends Error {}

/**
 * Error thrown when the WalletService URL is not set and a user tries to `get` it
 *
 * @memberof Errors
 * @inner
 */
exports.ConfigNotSetError = ConfigNotSetError;
class GetWalletServiceUrlError extends ConfigNotSetError {}

/**
 * Error thrown when the WalletService WebSocket URL is not set and a user tries to `get` it
 *
 * @memberof Errors
 * @inner
 */
exports.GetWalletServiceUrlError = GetWalletServiceUrlError;
class GetWalletServiceWsUrlError extends ConfigNotSetError {}

/**
 *
 *
 * @memberof Errors
 * @inner
 */
exports.GetWalletServiceWsUrlError = GetWalletServiceWsUrlError;
class PartialTxError extends Error {}

/**
 * Error thrown when an input data for a non-existent input is added.
 *
 * @memberof Errors
 * @inner
 */
exports.PartialTxError = PartialTxError;
class IndexOOBError extends PartialTxError {}

/**
 * Error thrown when an output with script type other than [p2sh, p2pkh] is used on PartialTx.
 *
 * @memberof Errors
 * @inner
 */
exports.IndexOOBError = IndexOOBError;
class UnsupportedScriptError extends PartialTxError {}

/**
 * Error thrown when a requested transaction is not found
 *
 * @memberof Errors
 * @inner
 */
exports.UnsupportedScriptError = UnsupportedScriptError;
class TxNotFoundError extends Error {}
exports.TxNotFoundError = TxNotFoundError;
class InvalidPasswdError extends WalletError {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.INVALID_PASSWD);
  }
}
exports.InvalidPasswdError = InvalidPasswdError;
class DecryptionError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.DECRYPTION_ERROR);
  }
}
exports.DecryptionError = DecryptionError;
class UnsupportedHasherError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.UNSUPPORTED_HASHER);
  }
}
exports.UnsupportedHasherError = UnsupportedHasherError;
class UninitializedWalletError extends WalletError {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.UNINITIALIZED_WALLET);
  }
}

/**
 * Error thrown during any API request
 *
 * @memberof Errors
 * @inner
 */
exports.UninitializedWalletError = UninitializedWalletError;
class RequestError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.REQUEST_ERROR);
  }
}

/**
 * Error thrown during nano API request
 *
 * @memberof Errors
 * @inner
 */
exports.RequestError = RequestError;
class NanoRequestError extends RequestError {
  constructor(message, originError = null, response = null) {
    super(message);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.NANO_REQUEST_ERROR);
    _defineProperty(this, "originError", null);
    _defineProperty(this, "response", null);
    this.originError = originError;
    this.response = response;
  }
}

/**
 * Error thrown during nano API request for 404
 *
 * @memberof Errors
 * @inner
 */
exports.NanoRequestError = NanoRequestError;
class NanoRequest404Error extends NanoRequestError {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.NANO_REQUEST_ERROR_404);
  }
}

/**
 * Error thrown when PIN is required in a method but it's not set
 *
 * @memberof Errors
 * @inner
 */
exports.NanoRequest404Error = NanoRequest404Error;
class PinRequiredError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.PIN_REQUIRED);
  }
}

/**
 * Error thrown during the creation of a nano contract transaction
 *
 * @memberof Errors
 * @inner
 */
exports.PinRequiredError = PinRequiredError;
class NanoContractTransactionError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.NANO_TRANSACTION_CREATE_ERROR);
  }
}

/**
 * Error thrown when parsing a nano contract transaction
 *
 * @memberof Errors
 * @inner
 */
exports.NanoContractTransactionError = NanoContractTransactionError;
class NanoContractTransactionParseError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.NANO_TRANSACTION_PARSE_ERROR);
  }
}

/**
 * Error thrown when parsing an oracle script
 *
 * @memberof Errors
 * @inner
 */
exports.NanoContractTransactionParseError = NanoContractTransactionParseError;
class OracleParseError extends Error {
  constructor(...args) {
    super(...args);
    _defineProperty(this, "errorCode", _errorMessages.ErrorMessages.NANO_ORACLE_PARSE_ERROR);
  }
}
exports.OracleParseError = OracleParseError;
class GlobalLoadLockTaskError extends Error {
  constructor(taskId, innerError) {
    super(`${taskId} has failed with ${innerError}`);
    _defineProperty(this, "taskId", void 0);
    _defineProperty(this, "innerError", void 0);
    this.taskId = taskId;
    this.innerError = innerError;
  }
}
exports.GlobalLoadLockTaskError = GlobalLoadLockTaskError;