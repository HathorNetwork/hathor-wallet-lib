/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { AxiosResponse } from 'axios';
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
export declare class AddressError extends Error {
}
/**
 * Error thrown when output value is invalid
 *
 * @memberof Errors
 * @inner
 */
export declare class OutputValueError extends Error {
}
/**
 * Error thrown when we have insufficient funds
 *
 * @memberof Errors
 * @inner
 */
export declare class InsufficientFundsError extends Error {
}
/**
 * Error thrown when a constant that we get from the server is not set
 *
 * @memberof Errors
 * @inner
 */
export declare class ConstantNotSet extends Error {
}
/**
 * Error thrown when a create token tx has invalid info
 *
 * @memberof Errors
 * @inner
 */
export declare class CreateTokenTxInvalid extends Error {
}
/**
 * Error thrown when validating a registration of new token
 *
 * @memberof Errors
 * @inner
 */
export declare class TokenValidationError extends Error {
}
/**
 * Error thrown when validating a registration of new NFT
 *
 * @memberof Errors
 * @inner
 */
export declare class NftValidationError extends Error {
}
/**
 * Error thrown when transaction has more inputs than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
export declare class MaximumNumberInputsError extends Error {
}
/**
 * Error thrown when transaction has more outputs than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
export declare class MaximumNumberOutputsError extends Error {
}
/**
 * Error thrown when transaction has invalid outputs
 *
 * @memberof Errors
 * @inner
 */
export declare class InvalidOutputsError extends Error {
}
/**
 * Error thrown when transaction has more parents than the maximum allowed
 *
 * @memberof Errors
 * @inner
 */
export declare class MaximumNumberParentsError extends Error {
}
/**
 * Error thrown when the wallet type is invalid
 *
 * @memberof Errors
 * @inner
 */
export declare class WalletTypeError extends Error {
}
/**
 * Error thrown when we are given an invalid xpubkey
 *
 * @memberof Errors
 * @inner
 */
export declare class XPubError extends Error {
}
/**
 * Error thrown when we are given an invalid uncompressed public key
 *
 * @memberof Errors
 * @inner
 */
export declare class UncompressedPubKeyError extends Error {
}
/**
 * Error thrown when the user tries to create a wallet with an invalid sequence of words
 *
 * @memberof Errors
 * @inner
 */
export declare class InvalidWords extends Error {
    invalidWords: string[];
}
/**
 * Error thrown when parsing bytes to an object
 *
 * @memberof Errors
 * @inner
 */
export declare class ParseError extends Error {
}
/**
 * Error thrown when parsing a script bytes
 *
 * @memberof Errors
 * @inner
 */
export declare class ParseScriptError extends ParseError {
}
/**
 * Error thrown when executing wallet operations
 *
 * @memberof Errors
 * @inner
 */
export declare class WalletError extends Error {
    errorCode: string;
}
/**
 * Error thrown when executing wallet requests
 *
 * @memberof Errors
 * @inner
 */
export declare class WalletRequestError extends WalletError {
    cause: unknown;
    constructor(message: string, errorData?: {
        cause: unknown;
    });
}
/**
 * Error thrown when get utxo fails
 *
 * @memberof Errors
 * @inner
 */
export declare class UtxoError extends WalletError {
}
/**
 * Error thrown when sending tx
 *
 * @memberof Errors
 * @inner
 */
export declare class SendTxError extends WalletError {
    errorData: string | {
        txId: string;
        index: number;
    };
}
/**
 * Error thrown when mining tx
 *
 * @memberof Errors
 * @inner
 */
export declare class MineTxError extends WalletError {
}
/**
 * Error thrown when trying to interact with an incomplete or invalid partial transaction.
 *
 * @memberof Errors
 * @inner
 */
export declare class InvalidPartialTxError extends WalletError {
}
/**
 * Error thrown when calling a protected method on an xpub inited wallet
 * Some methods require access to the words or private key
 *
 * @memberof Errors
 * @inner
 */
export declare class WalletFromXPubGuard extends WalletError {
}
/**
 * Error thrown when there is an error getting dag metadata using wallet service
 *
 * @memberof Errors
 * @inner
 */
export declare class GetDagMetadataApiError extends Error {
}
/**
 * Base Error class for Config not set errors
 *
 * @memberof Errors
 * @inner
 */
export declare class ConfigNotSetError extends Error {
}
/**
 * Error thrown when the WalletService URL is not set and a user tries to `get` it
 *
 * @memberof Errors
 * @inner
 */
export declare class GetWalletServiceUrlError extends ConfigNotSetError {
}
/**
 * Error thrown when the WalletService WebSocket URL is not set and a user tries to `get` it
 *
 * @memberof Errors
 * @inner
 */
export declare class GetWalletServiceWsUrlError extends ConfigNotSetError {
}
/**
 *
 *
 * @memberof Errors
 * @inner
 */
export declare class PartialTxError extends Error {
}
/**
 * Error thrown when an input data for a non-existent input is added.
 *
 * @memberof Errors
 * @inner
 */
export declare class IndexOOBError extends PartialTxError {
}
/**
 * Error thrown when an output with script type other than [p2sh, p2pkh] is used on PartialTx.
 *
 * @memberof Errors
 * @inner
 */
export declare class UnsupportedScriptError extends PartialTxError {
}
/**
 * Error thrown when a requested transaction is not found
 *
 * @memberof Errors
 * @inner
 */
export declare class TxNotFoundError extends Error {
}
export declare class InvalidPasswdError extends WalletError {
    errorCode: string;
}
export declare class DecryptionError extends Error {
    errorCode: string;
}
export declare class UnsupportedHasherError extends Error {
    errorCode: string;
}
export declare class UninitializedWalletError extends WalletError {
    errorCode: string;
}
/**
 * Error thrown during any API request
 *
 * @memberof Errors
 * @inner
 */
export declare class RequestError extends Error {
    errorCode: string;
}
/**
 * Error thrown during nano API request
 *
 * @memberof Errors
 * @inner
 */
export declare class NanoRequestError extends RequestError {
    errorCode: string;
    originError: unknown | null;
    response: AxiosResponse | null;
    constructor(message: string, originError?: unknown | null, response?: AxiosResponse | null);
}
/**
 * Error thrown during nano API request for 404
 *
 * @memberof Errors
 * @inner
 */
export declare class NanoRequest404Error extends NanoRequestError {
    errorCode: string;
}
/**
 * Error thrown when PIN is required in a method but it's not set
 *
 * @memberof Errors
 * @inner
 */
export declare class PinRequiredError extends Error {
    errorCode: string;
}
/**
 * Error thrown during the creation of a nano contract transaction
 *
 * @memberof Errors
 * @inner
 */
export declare class NanoContractTransactionError extends Error {
    errorCode: string;
}
/**
 * Error thrown when parsing a nano contract transaction
 *
 * @memberof Errors
 * @inner
 */
export declare class NanoContractTransactionParseError extends Error {
    errorCode: string;
}
/**
 * Error thrown when parsing an oracle script
 *
 * @memberof Errors
 * @inner
 */
export declare class OracleParseError extends Error {
    errorCode: string;
}
export declare class GlobalLoadLockTaskError extends Error {
    taskId: string;
    innerError: Error;
    constructor(taskId: string, innerError: Error);
}
//# sourceMappingURL=errors.d.ts.map