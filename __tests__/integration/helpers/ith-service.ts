/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ithService — the single, safeguarded client for the hathor-integration-test-helper.
 *
 * All HTTP interaction with the helper (wallet generation AND funding) goes through
 * here so the safeguards both PR #1111 reviewers asked for live in one place:
 *   - per-request timeout (axios `timeout`),
 *   - retry with exponential backoff, driven by the helper's `{retryable}` contract
 *     (retry retryable failures, fail fast on INVALID_REQUEST),
 *   - structured logging via the integration `loggers.test`,
 *   - typed errors ({@link IthServiceError}) instead of raw axios noise.
 */
import axios, { type Method } from 'axios';
import { loggers } from '../utils/logger.util';
import { delay } from '../utils/time.util';
import testConfig from '../configuration/test.config';
import type { IPrecalculatedShieldedAddress, OutputValueType } from '../../../src/types';

export interface SimpleWalletData {
  words: string;
  addresses: string[];
  /**
   * Precalculated shielded address pairs. Optional: older helper versions omit
   * them, and the wallet then derives each pair live (slow under jest).
   */
  shieldedAddresses?: IPrecalculatedShieldedAddress[];
}

/**
 * Mirrors the helper's `POST /fund` response.
 *
 * `amount` is a `bigint` on the wire, serialised by the helper via
 * `JSONBigInt.stringify`, so it is typed `string` here — `JSON.parse` would
 * round it as a `number`. Nothing reads it today; the type exists so the first
 * caller that does is not handed a silently-rounded value.
 */
export interface FundResult {
  txId: string;
  amount: string;
  utxoSource: 'test' | 'leftover' | 'large';
}

/**
 * The helper's readiness report. `ready` is false until it has synced the
 * genesis wallet and split the funding pool; the remaining fields are pool
 * statistics whose exact set varies by helper version.
 */
export interface ReadyStatus {
  ready: boolean;
  readyReason?: string;
  testUtxos?: number;
  [stat: string]: unknown;
}

/** A typed failure from the helper (or the transport), carrying the RFC error contract. */
export class IthServiceError extends Error {
  readonly code: string;

  readonly retryable: boolean;

  readonly status: number;

  constructor(message: string, code: string, retryable: boolean, status: number) {
    super(message);
    this.name = 'IthServiceError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

interface IthConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  readyTimeoutMs: number;
  readyPollIntervalMs: number;
}

function ithConfig(): IthConfig {
  // No `??` fallbacks here: test.config validates and defaults every value, so a
  // second layer would only hide a misconfiguration (and could not catch NaN
  // anyway, since NaN is not nullish).
  return {
    baseUrl: testConfig.walletProviderUrl,
    timeoutMs: testConfig.ithTimeoutMs,
    maxRetries: testConfig.ithMaxRetries,
    retryBaseDelayMs: testConfig.ithRetryBaseDelayMs,
    readyTimeoutMs: testConfig.ithReadyTimeoutMs,
    readyPollIntervalMs: testConfig.ithReadyPollIntervalMs,
  };
}

/** Statuses worth retrying when the response carries no helper error contract. */
const RETRYABLE_BARE_STATUSES = new Set([429, 502, 503, 504]);

/** Keep a non-conforming body in the message — truncated, since it may be an HTML page. */
function describeBody(data: unknown): string {
  try {
    const asText = typeof data === 'string' ? data : JSON.stringify(data);
    if (!asText) {
      return '';
    }
    return ` — body: ${asText.length > 300 ? `${asText.slice(0, 300)}…` : asText}`;
  } catch {
    return '';
  }
}

interface RequestOptions {
  /**
   * Whether replaying this request is harmless. `false` confines retries to
   * failures the helper *declared* retryable — every such code is raised before,
   * or together with, a released reservation and no accepted broadcast. Blind
   * transport retries (a timeout may mean the request succeeded and the response
   * was lost) are allowed only for idempotent calls.
   */
  idempotent: boolean;
}

/**
 * Perform an HTTP request against the helper with timeout + retry.
 *
 * Retries on the helper's `retryable:true` responses always, and on transport
 * errors only when the call is idempotent; backs off exponentially and surfaces
 * everything else as an {@link IthServiceError}.
 */
async function request<T>(
  method: Method,
  path: string,
  options: RequestOptions,
  body?: unknown
): Promise<T> {
  const { baseUrl, timeoutMs, maxRetries, retryBaseDelayMs } = ithConfig();
  const url = `${baseUrl}${path}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let err: IthServiceError;
    try {
      const res = await axios.request<T>({
        method,
        url,
        data: body,
        timeout: timeoutMs,
        validateStatus: () => true, // we map status ourselves
      });

      if (res.status >= 200 && res.status < 300) {
        return res.data;
      }

      // Helper error body: { error, message, retryable }
      const errorBody = res.data as { error?: string; message?: string; retryable?: boolean };
      const conforms = typeof errorBody?.error === 'string' && 'retryable' in (errorBody ?? {});
      err = new IthServiceError(
        conforms
          ? errorBody.message ?? `Request to ${path} failed with HTTP ${res.status}`
          : `Request to ${path} failed with HTTP ${res.status}${describeBody(res.data)}`,
        conforms ? errorBody.error! : 'UNKNOWN',
        // A body that doesn't match the contract carries no verdict, so fall back
        // to the status. This is where an operator most needs the raw body, hence
        // describeBody above.
        conforms ? Boolean(errorBody.retryable) : RETRYABLE_BARE_STATUSES.has(res.status),
        res.status
      );
    } catch (transportError) {
      // Timeout / connection refused / DNS. Retryable only for idempotent calls:
      // a timed-out POST /fund may already have reserved a UTXO and broadcast.
      err = new IthServiceError(
        (transportError as Error).message,
        'TRANSPORT',
        options.idempotent,
        0
      );
    }

    if (!err.retryable || attempt === maxRetries) {
      loggers.test?.error(
        `ithService ${method} ${path} failed: ${err.code} (${err.status}) — ${err.message}`
      );
      throw err;
    }

    const backoff = retryBaseDelayMs * 2 ** attempt;
    loggers.test?.warn(
      `ithService ${method} ${path} retryable ${err.code}; retry ${attempt + 1}/${maxRetries} in ${backoff}ms`
    );
    await delay(backoff);
  }

  // Unreachable: the loop returns, or throws on its final attempt.
  throw new Error(`ithService ${method} ${path}: retry loop exited without a result`);
}

export const ithService = {
  /**
   * GET /simpleWallet — a fresh precalculated wallet.
   *
   * Idempotent: repeating it only costs the helper one wallet from its supply.
   */
  async getSimpleWallet(): Promise<SimpleWalletData> {
    const data = await request<SimpleWalletData>('get', '/simpleWallet', { idempotent: true });
    if (!data?.words || !Array.isArray(data?.addresses)) {
      throw new IthServiceError(
        `GET /simpleWallet returned an unexpected shape${describeBody(data)}`,
        'MALFORMED_RESPONSE',
        false,
        200
      );
    }
    return data;
  },

  /**
   * POST /fund — reserve a pool UTXO and send `amount` to `address`.
   *
   * bigint amounts are sent as digit-strings (the helper parses them beyond the
   * JS safe-integer range).
   *
   * NOT idempotent, and there is no idempotency key in the wire contract: each
   * accepted call reserves a UTXO and broadcasts. A blindly retried timeout
   * would double-fund the address and make every downstream balance assertion
   * nondeterministic, so transport failures are not replayed here — only
   * failures the helper itself declared retryable.
   */
  async fund(address: string, amount?: OutputValueType): Promise<FundResult> {
    const payload: { address: string; amount?: string } = { address };
    if (amount !== undefined) {
      payload.amount = amount.toString();
    }
    const result = await request<FundResult>('post', '/fund', { idempotent: false }, payload);
    // A 2xx is not proof of a usable body: a proxy error page or a renamed field
    // would otherwise reach waitForTxReceived as `undefined` and hang for the
    // full timeout with nothing pointing back at funding.
    if (!result?.txId) {
      throw new IthServiceError(
        `POST /fund returned no txId${describeBody(result)}`,
        'MALFORMED_RESPONSE',
        false,
        200
      );
    }
    return result;
  },

  /**
   * GET /ready — readiness probe.
   *
   * Deliberately does NOT go through {@link request}: a 503 here is the
   * helper's documented "not ready yet" answer, not a failure, and it carries
   * no `retryable` field — so the generic path would fail fast on the one
   * response a caller most expects to see. Reports the state instead of
   * throwing, and folds a transport error into the same "not ready" shape,
   * since a helper that is not listening yet is indistinguishable from one
   * that is still warming up to anybody who is polling.
   */
  async ready(): Promise<ReadyStatus> {
    const { baseUrl, timeoutMs } = ithConfig();
    try {
      const res = await axios.get<ReadyStatus>(`${baseUrl}/ready`, {
        timeout: timeoutMs,
        validateStatus: () => true,
      });
      return { ...res.data, ready: res.status === 200 && res.data?.ready === true };
    } catch (transportError) {
      return { ready: false, readyReason: (transportError as Error).message };
    }
  },

  /** Poll {@link ready} until the helper reports ready, or throw at the deadline. */
  async waitUntilReady(
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<ReadyStatus> {
    const { readyTimeoutMs, readyPollIntervalMs } = ithConfig();
    const timeoutMs = options.timeoutMs ?? readyTimeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? readyPollIntervalMs;
    const deadline = Date.now() + timeoutMs;

    let status: ReadyStatus = { ready: false, readyReason: 'not yet polled' };
    for (;;) {
      status = await this.ready();
      if (status.ready) {
        return status;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `The integration-test-helper did not become ready within ${timeoutMs}ms ` +
            `(last reported: ${status.readyReason ?? 'no reason given'}). ` +
            `Check that the wallet-provider container is running and healthy.`
        );
      }
      await delay(pollIntervalMs);
    }
  },
};
