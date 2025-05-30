/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// eslint-disable-next-line max-classes-per-file -- This file is supposed to export classes
import { AxiosResponse } from 'axios';
import { ErrorMessages } from './errorMessages';

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
export class AddressError extends Error {}

/**
 * Error thrown when output value is invalid
 *
 * @memberof Errors
 * @inner
 */
export class OutputValueError extends Error {}

/**
 * Error thrown when we have insufficient funds
 *
 * @memberof Errors
 * @inner
 */
export class InsufficientFundsError extends Error {}

/**
 * Error thrown when a constant that we get from the server is not set
 *
 * @memberof Errors
 * @inner
 */
export class ConstantNotSet extends Error {}

/**
 * Error thrown when a create token tx has invalid info
 *
 * @memberof Errors
 * @inner
 */
export class CreateTokenTxInvalid extends Error {}

/**
 * Error thrown when validating a registration of new token
 *
 * @memberof Errors
 * @inner
 */
export class TokenValidationError extends Error {}

/**
 * Error thrown when validating a registration of new NFT
 *
 * @memberof Errors
 * @inner
 */
export class NftValidationError extends Error {}

/**
 * Error thrown when transaction has more inputs than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
export class MaximumNumberInputsError extends Error {}

/**
 * Error thrown when transaction has more outputs than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
export class MaximumNumberOutputsError extends Error {}

/**
 * Error thrown when transaction has invalid outputs
 *
 * @memberof Errors
 * @inner
 */
export class InvalidOutputsError extends Error {}

/**
 * Error thrown when transaction has more parents than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
export class MaximumNumberParentsError extends Error {}

/**
 * Error thrown when the wallet type is invalid
 *
 * @memberof Errors
 * @inner
 */
export class WalletTypeError extends Error {}

/**
 * Error thrown when we are given an invalid xpubkey
 *
 * @memberof Errors
 * @inner
 */
export class XPubError extends Error {}

/**
 * Error thrown when we are given an invalid uncompressed public key
 *
 * @memberof Errors
 * @inner
 */
export class UncompressedPubKeyError extends Error {}

/**
 * Error thrown when the user tries to create a wallet with an invalid sequence of words
 *
 * @memberof Errors
 * @inner
 */
export class InvalidWords extends Error {
  invalidWords: string[] = [];
}

/**
 * Error thrown when parsing bytes to an object
 *
 * @memberof Errors
 * @inner
 */
export class ParseError extends Error {}

/**
 * Error thrown when parsing a script bytes
 *
 * @memberof Errors
 * @inner
 */
export class ParseScriptError extends ParseError {}

/**
 * Error thrown when executing wallet operations
 *
 * @memberof Errors
 * @inner
 */
export class WalletError extends Error {
  errorCode: string = ErrorMessages.DEFAULT_WALLET_ERROR;
}

/**
 * Error thrown when executing wallet requests
 *
 * @memberof Errors
 * @inner
 */
export class WalletRequestError extends WalletError {
  cause: unknown = null;

  constructor(message: string, errorData: { cause: unknown } = { cause: null }) {
    super(message);
    this.cause = errorData.cause;
  }
}

/**
 * Error thrown when get utxo fails
 *
 * @memberof Errors
 * @inner
 */
export class UtxoError extends WalletError {}

/**
 * Error thrown when sending tx
 *
 * @memberof Errors
 * @inner
 */
export class SendTxError extends WalletError {
  // XXX: There are only two out of dozens of places where this object is used instead of a string.
  //      This should be made consistently for strings
  errorData: string | { txId: string; index: number } = '';
}

/**
 * Error thrown when mining tx
 *
 * @memberof Errors
 * @inner
 */
export class MineTxError extends WalletError {}

/**
 * Error thrown when trying to interact with an incomplete or invalid partial transaction.
 *
 * @memberof Errors
 * @inner
 */
export class InvalidPartialTxError extends WalletError {}

/**
 * Error thrown when calling a protected method on an xpub inited wallet
 * Some methods require access to the words or private key
 *
 * @memberof Errors
 * @inner
 */
export class WalletFromXPubGuard extends WalletError {}

/**
 * Error thrown when there is an error getting dag metadata using wallet service
 *
 * @memberof Errors
 * @inner
 */
export class GetDagMetadataApiError extends Error {}

/**
 * Base Error class for Config not set errors
 *
 * @memberof Errors
 * @inner
 */
export class ConfigNotSetError extends Error {}

/**
 * Error thrown when the WalletService URL is not set and a user tries to `get` it
 *
 * @memberof Errors
 * @inner
 */
export class GetWalletServiceUrlError extends ConfigNotSetError {}

/**
 * Error thrown when the WalletService WebSocket URL is not set and a user tries to `get` it
 *
 * @memberof Errors
 * @inner
 */
export class GetWalletServiceWsUrlError extends ConfigNotSetError {}

/**
 *
 *
 * @memberof Errors
 * @inner
 */
export class PartialTxError extends Error {}

/**
 * Error thrown when an input data for a non-existent input is added.
 *
 * @memberof Errors
 * @inner
 */
export class IndexOOBError extends PartialTxError {}

/**
 * Error thrown when an output with script type other than [p2sh, p2pkh] is used on PartialTx.
 *
 * @memberof Errors
 * @inner
 */
export class UnsupportedScriptError extends PartialTxError {}

/**
 * Error thrown when a requested transaction is not found
 *
 * @memberof Errors
 * @inner
 */
export class TxNotFoundError extends Error {}

export class InvalidPasswdError extends WalletError {
  errorCode: string = ErrorMessages.INVALID_PASSWD;
}

export class DecryptionError extends Error {
  errorCode: string = ErrorMessages.DECRYPTION_ERROR;
}

export class UnsupportedHasherError extends Error {
  errorCode: string = ErrorMessages.UNSUPPORTED_HASHER;
}

export class UninitializedWalletError extends WalletError {
  errorCode: string = ErrorMessages.UNINITIALIZED_WALLET;
}

/**
 * Error thrown during any API request
 *
 * @memberof Errors
 * @inner
 */
export class RequestError extends Error {
  errorCode: string = ErrorMessages.REQUEST_ERROR;
}

/**
 * Error thrown during nano API request
 *
 * @memberof Errors
 * @inner
 */
export class NanoRequestError extends RequestError {
  errorCode: string = ErrorMessages.NANO_REQUEST_ERROR;

  originError: unknown | null = null;

  response: AxiosResponse | null = null;

  constructor(
    message: string,
    originError: unknown | null = null,
    response: AxiosResponse | null = null
  ) {
    super(message);
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
export class NanoRequest404Error extends NanoRequestError {
  errorCode: string = ErrorMessages.NANO_REQUEST_ERROR_404;
}

/**
 * Error thrown when PIN is required in a method but it's not set
 *
 * @memberof Errors
 * @inner
 */
export class PinRequiredError extends Error {
  errorCode: string = ErrorMessages.PIN_REQUIRED;
}

/**
 * Error thrown during the creation of a nano contract transaction
 *
 * @memberof Errors
 * @inner
 */
export class NanoContractTransactionError extends Error {
  errorCode: string = ErrorMessages.NANO_TRANSACTION_CREATE_ERROR;
}

/**
 * Error thrown when parsing a nano contract transaction
 *
 * @memberof Errors
 * @inner
 */
export class NanoContractTransactionParseError extends Error {
  errorCode: string = ErrorMessages.NANO_TRANSACTION_PARSE_ERROR;
}

/**
 * Error thrown when parsing an oracle script
 *
 * @memberof Errors
 * @inner
 */
export class OracleParseError extends Error {
  errorCode: string = ErrorMessages.NANO_ORACLE_PARSE_ERROR;
}

export class GlobalLoadLockTaskError extends Error {
  taskId: string;

  innerError: Error;

  constructor(taskId: string, innerError: Error) {
    super(`${taskId} has failed with ${innerError}`);
    this.taskId = taskId;
    this.innerError = innerError;
  }
}

export class NanoHeaderNotFound extends Error {}
