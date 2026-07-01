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
import type { OutputValueType } from '../../../src/types';

// test.config.ts is CommonJS.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const testConfig = require('../configuration/test.config');

export interface SimpleWalletData {
  words: string;
  addresses: string[];
}

export interface FundResult {
  txId: string;
  amount: number;
  utxoSource: 'test' | 'leftover' | 'large';
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
}

function ithConfig(): IthConfig {
  return {
    baseUrl: testConfig.walletProviderUrl,
    timeoutMs: testConfig.ithTimeoutMs ?? 15000,
    maxRetries: testConfig.ithMaxRetries ?? 5,
    retryBaseDelayMs: testConfig.ithRetryBaseDelayMs ?? 500,
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Perform an HTTP request against the helper with timeout + retry.
 * Retries on transport errors and on the helper's `retryable:true` responses,
 * with exponential backoff; surfaces everything else as an {@link IthServiceError}.
 */
async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const { baseUrl, timeoutMs, maxRetries, retryBaseDelayMs } = ithConfig();
  const url = `${baseUrl}${path}`;
  let lastError: IthServiceError | undefined;

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
      err = new IthServiceError(
        errorBody?.message ?? `Request to ${path} failed with HTTP ${res.status}`,
        errorBody?.error ?? 'UNKNOWN',
        Boolean(errorBody?.retryable),
        res.status
      );
    } catch (transportError) {
      // Timeout / connection refused / DNS — treat as retryable transport failure.
      err = new IthServiceError((transportError as Error).message, 'TRANSPORT', true, 0);
    }

    if (!err.retryable || attempt === maxRetries) {
      loggers.test?.error(
        `ithService ${method} ${path} failed: ${err.code} (${err.status}) — ${err.message}`
      );
      throw err;
    }

    const backoff = retryBaseDelayMs * 2 ** attempt;
    loggers.test?.info(
      `ithService ${method} ${path} retryable ${err.code}; retry ${attempt + 1}/${maxRetries} in ${backoff}ms`
    );
    lastError = err;
    await sleep(backoff);
  }

  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw lastError;
}

export const ithService = {
  /** GET /simpleWallet — a fresh precalculated wallet. */
  async getSimpleWallet(): Promise<SimpleWalletData> {
    const data = await request<SimpleWalletData>('get', '/simpleWallet');
    if (!data?.words || !Array.isArray(data?.addresses)) {
      throw new Error(`Wallet provider returned an unexpected response: ${JSON.stringify(data)}`);
    }
    return data;
  },

  /**
   * POST /fund — reserve a pool UTXO and send `amount` to `address`.
   * bigint amounts are sent as digit-strings (the helper parses them beyond the
   * JS safe-integer range).
   */
  async fund(address: string, amount?: OutputValueType): Promise<FundResult> {
    const payload: { address: string; amount?: number | string } = { address };
    if (amount !== undefined && amount !== null) {
      payload.amount = typeof amount === 'bigint' ? amount.toString() : Number(amount);
    }
    return request<FundResult>('post', '/fund', payload);
  },
};
