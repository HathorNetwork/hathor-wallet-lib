/*
 * This file contains the configurations specific for the integration tests on the wallet-lib.
 * Those values are also editable via environment variables
 */

/**
 * Read a numeric env var, failing loudly on anything that is not a usable number.
 *
 * `Number(process.env.X || fallback)` is the trap this replaces: it yields NaN
 * for a typo'd value, and NaN cannot be caught by a `??` default downstream
 * because NaN is not nullish. A NaN retry count silently skips the retry loop
 * entirely; a `'0'` timeout is read by axios as "no timeout at all". Both are
 * far worse than refusing to start.
 */
function positiveIntEnv(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}, got: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

module.exports = {
  // On CI, should match .github/workflows/integration-test.yml -> upload-artifact
  logOutputFolder: process.env.TEST_LOG_OUTPUT_FOLDER || 'tmp/',

  // Console level used on winston (defaults to 'warn' for quieter CI output)
  consoleLevel: process.env.TEST_CONSOLE_LEVEL || 'warn',

  // File level used on winston (defaults to 'silly' for complete debugging in artifacts)
  fileLevel: process.env.TEST_FILE_LEVEL || 'silly',

  // Base URL of the integration-test-helper wallet provider service.
  // On CI, must match the service exposed in docker-compose.yml (port 3020).
  walletProviderUrl: process.env.WALLET_PROVIDER_URL || 'http://localhost:3020',

  // ithService safeguards (see helpers/ith-service.ts). Timeouts/retries/backoff
  // for all HTTP calls to the integration-test-helper.
  //
  // Must exceed the helper's own FUND_TIMEOUT_MS (30s by default) plus mining:
  // below that, the client aborts first and turns the helper's own orderly
  // FUND_TIMEOUT into an ambiguous transport failure.
  ithTimeoutMs: positiveIntEnv('ITH_TIMEOUT_MS', 45000),
  ithMaxRetries: positiveIntEnv('ITH_MAX_RETRIES', 5, { min: 0 }),
  ithRetryBaseDelayMs: positiveIntEnv('ITH_RETRY_BASE_DELAY_MS', 500),

  // Readiness gate (see configuration/global-setup.ts). The helper reports 503
  // until it has synced the genesis wallet and split the funding pool, which on
  // a cold private network waits out genesis reward-lock maturity — hence the
  // generous default ceiling.
  ithReadyTimeoutMs: positiveIntEnv('ITH_READY_TIMEOUT_MS', 300000),
  ithReadyPollIntervalMs: positiveIntEnv('ITH_READY_POLL_INTERVAL_MS', 2000),
};
