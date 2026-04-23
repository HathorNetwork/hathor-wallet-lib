/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { WalletRequestError } from '../errors';

/**
 * Options for {@link retryOnTransientWalletError}.
 */
export interface RetryOnTransientWalletErrorOptions {
  /**
   * Total number of attempts, including the initial one. Must be >= 1.
   *
   * Example: `maxAttempts: 3` performs one initial attempt plus up to two
   * retries, for a maximum of three operation invocations.
   */
  maxAttempts: number;

  /**
   * Milliseconds to wait between attempts. The delay is applied *between*
   * attempts only — not before the first attempt and not after the final
   * (failed) attempt.
   */
  intervalMs: number;
}

/**
 * Runs `operation` and retries it on transient wallet-service errors.
 *
 * A "transient" error is a {@link WalletRequestError}: the wallet-service
 * responded with a non-2xx status code or similarly reachable-but-unhappy
 * signal. These failures are expected to be short-lived — for example, the
 * brief window right after wallet creation during which the `/auth/token`
 * endpoint can return an error before the wallet's backend state settles.
 *
 * Any other rejection (network failures, programming errors, schema
 * mismatches) is considered permanent and propagates immediately without
 * consuming retry budget. This keeps fail-fast behaviour for real bugs while
 * tolerating genuine race conditions against the wallet-service.
 *
 * Why this helper exists:
 *   The old fire-and-forget auth-token renewal path silently caught *all*
 *   errors and nulled `this.authToken`, which turned transient server
 *   failures into permanent 403s for the next authenticated request. This
 *   PR removes that silent catch; this helper replaces the implicit retry
 *   that the old catch-and-retry-from-interceptor dance used to provide,
 *   but does so explicitly, with a bounded budget and a clear contract.
 *
 * @param operation - An async function performing a single wallet-service
 *                    call. Must be idempotent (the helper may invoke it
 *                    multiple times).
 * @param opts      - Retry policy. See {@link RetryOnTransientWalletErrorOptions}.
 *
 * @returns The first successful result of `operation`.
 *
 * @throws The last {@link WalletRequestError} if every attempt fails with a
 *         transient error, or the original error unchanged if a
 *         non-transient error is encountered.
 */
export async function retryOnTransientWalletError<T>(
  operation: () => Promise<T>,
  opts: RetryOnTransientWalletErrorOptions
): Promise<T> {
  if (opts.maxAttempts < 1) {
    throw new Error(
      `retryOnTransientWalletError: maxAttempts must be >= 1, got ${opts.maxAttempts}`
    );
  }

  let lastTransientError: WalletRequestError | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design
      return await operation();
    } catch (err) {
      if (!(err instanceof WalletRequestError)) {
        // Non-transient: propagate immediately without consuming retry budget.
        throw err;
      }
      lastTransientError = err;
      const isLastAttempt = attempt === opts.maxAttempts;
      if (isLastAttempt) break;
      // eslint-disable-next-line no-await-in-loop -- sequential by design
      await new Promise<void>(resolve => {
        setTimeout(resolve, opts.intervalMs);
      });
    }
  }

  // Every path that exits the loop without returning has populated
  // `lastTransientError`; this guard is for TypeScript control-flow analysis
  // and satisfies `no-throw-literal`.
  if (!lastTransientError) {
    throw new Error('retryOnTransientWalletError: invariant violated — no error captured');
  }
  throw lastTransientError;
}
