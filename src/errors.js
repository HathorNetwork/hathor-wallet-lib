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
