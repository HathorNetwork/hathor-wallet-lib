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
