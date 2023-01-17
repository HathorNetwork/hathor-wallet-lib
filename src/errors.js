/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
export class InvalidWords extends Error {}

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
export class WalletError extends Error {}

/**
 * Error thrown when executing wallet requests
 *
 * @memberof Errors
 * @inner
 */
export class WalletRequestError extends WalletError {}

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
export class SendTxError extends WalletError {}

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
export class WalletFromXPubGuard extends Error {}

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
export class TxNotFoundError extends Error {};
