/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { TIMEOUT } from '../../constants';
import helpers from '../../utils/helpers';
import HathorWalletServiceWallet from '../wallet';
import config from '../../config';

/**
 * Method that creates an axios instance
 *
 * @module Axios
 */

/**
 * Extending AxiosRequestConfig to include a retry count for our interceptor
 */
type AxiosRequestConfigWithRetry = InternalAxiosRequestConfig & {
  _retryCount?: number;
};

const SLOW_WALLET_MAX_RETRIES = 10;
const SLOW_WALLET_RETRY_DELAY_BASE_MS = 100;
const SLOW_WALLET_RETRY_DELAY_MAX_MS = 1000;

/**
 * Create an axios instance to be used when sending requests
 *
 * @param {HathorWalletServiceWallet} wallet - The wallet instance
 * @param {boolean} needsAuth - Whether authentication is required
 * @param {number} timeout - Timeout in milliseconds for the main request
 */
export const axiosInstance = async (
  wallet: HathorWalletServiceWallet,
  needsAuth: boolean,
  timeout: number = TIMEOUT
) => {
  // TODO How to allow 'Retry' request?
  const defaultOptions: {
    headers: {
      Authorization?: string;
      'Content-Type': string;
    };
    baseURL: string;
    validateStatus: (status) => boolean;
    timeout: number;
  } = {
    baseURL: config.getWalletServiceBaseUrl(),
    timeout,
    // `validateStatus` defines whether to resolve or reject the promise for a given
    // HTTP response status code. If `validateStatus` returns `true` (or is set to `null`
    // or `undefined`), the promise will be resolved; otherwise, the promise will be
    // rejected. The default behaviour of axios is to reject anything different than 2xx
    // We need to handle some 400 manually (e.g. create wallet might already be loaded)
    validateStatus: status => status >= 200 && status < 500,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (needsAuth) {
    // Then we need the auth token
    await wallet.validateAndRenewAuthToken();
    defaultOptions.headers.Authorization = `Bearer ${wallet.getAuthToken()}`;
  }

  const instance = axios.create(defaultOptions);

  // Add retry interceptor for socket hang up errors
  instance.interceptors.response.use(
    // Success response handler
    response => response,
    // Error response handler with retry logic
    async error => {
      // Fetching the retry count from the request config, or initializing it if not present
      const requestConfig = ((error as AxiosError).config as AxiosRequestConfigWithRetry)!;
      const currentRetryCount = requestConfig._retryCount || 0;

      // Check if we should retry
      const shouldRetry =
        wallet._expectSlowLambdas &&
        error.message === 'socket hang up' &&
        currentRetryCount < SLOW_WALLET_MAX_RETRIES;

      // Throw any error found if we shouldn't retry
      if (!shouldRetry) {
        // eslint-disable-next-line no-console
        console.error(`Failed request to ${requestConfig.url}: ${error.message}`);
        return Promise.reject(error);
      }

      // Modifying the request config for the retry and attempting a new request
      requestConfig._retryCount = currentRetryCount + 1;

      // Wait before retrying: 100ms, 200ms, 400ms, 800ms and then 1000ms
      await helpers.sleep(
        Math.min(
          SLOW_WALLET_RETRY_DELAY_BASE_MS * 2 ** currentRetryCount,
          SLOW_WALLET_RETRY_DELAY_MAX_MS
        )
      );

      // Retry the request
      return instance(requestConfig);
    }
  );

  return instance;
};

export default axiosInstance;
