/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { retryOnTransientWalletError } from '../../src/wallet/walletServiceRetry';
import { WalletRequestError } from '../../src/errors';

/**
 * Unit tests for the `retryOnTransientWalletError` helper.
 *
 * These tests focus on the retry policy in isolation — they do not touch any
 * wallet state or HTTP calls. The helper is deliberately small and generic so
 * it can be re-used by any code path that talks to the wallet-service and
 * wants bounded tolerance for transient non-2xx responses.
 */
describe('retryOnTransientWalletError', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return the result on first success without retrying', async () => {
    const op = jest.fn().mockResolvedValue('ok');

    const result = await retryOnTransientWalletError(op, { maxAttempts: 3, intervalMs: 10 });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should retry on WalletRequestError and return the eventual success value', async () => {
    const transient = new WalletRequestError('transient', { cause: { status: 400 } });
    const op = jest
      .fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue('ok-after-retries');

    const promise = retryOnTransientWalletError(op, { maxAttempts: 5, intervalMs: 10 });
    // Flush pending timers so the inter-attempt delays resolve.
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok-after-retries');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('should propagate non-WalletRequestError immediately without retrying', async () => {
    const op = jest.fn().mockRejectedValue(new TypeError('bug'));

    await expect(
      retryOnTransientWalletError(op, { maxAttempts: 5, intervalMs: 10 })
    ).rejects.toBeInstanceOf(TypeError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should throw the last WalletRequestError once maxAttempts is exhausted', async () => {
    const firstError = new WalletRequestError('first', { cause: { status: 400 } });
    const lastError = new WalletRequestError('last', { cause: { status: 400 } });
    const op = jest
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(lastError);

    const promise = retryOnTransientWalletError(op, { maxAttempts: 3, intervalMs: 10 });
    // Attach a handler eagerly so the rejection isn't flagged as unhandled
    // while we advance fake timers. The assertion below is the real check.
    promise.catch(() => {});
    await jest.runAllTimersAsync();

    // The rejection carries the *most recent* transient error, so the caller
    // sees the freshest diagnostic information.
    await expect(promise).rejects.toBe(lastError);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('should wait intervalMs between attempts (not before the first, not after the last)', async () => {
    const transient = new WalletRequestError('retry me', { cause: { status: 400 } });
    const op = jest
      .fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue('done');

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const promise = retryOnTransientWalletError(op, { maxAttempts: 5, intervalMs: 750 });
    await jest.runAllTimersAsync();
    await promise;

    // 2 failed attempts → 2 inter-attempt delays, each for 750ms.
    const delayCalls = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 750);
    expect(delayCalls).toHaveLength(2);
  });

  it('should throw an Error when maxAttempts < 1 (caller misuse guard)', async () => {
    const op = jest.fn();

    await expect(
      retryOnTransientWalletError(op, { maxAttempts: 0, intervalMs: 10 })
    ).rejects.toThrow(/maxAttempts/);
    expect(op).not.toHaveBeenCalled();
  });
});
