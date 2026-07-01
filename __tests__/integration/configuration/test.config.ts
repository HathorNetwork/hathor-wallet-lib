/*
 * This file contains the configurations specific for the integration tests on the wallet-lib.
 * Those values are also editable via environment variables
 */

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
  ithTimeoutMs: Number(process.env.ITH_TIMEOUT_MS || 15000),
  ithMaxRetries: Number(process.env.ITH_MAX_RETRIES || 5),
  ithRetryBaseDelayMs: Number(process.env.ITH_RETRY_BASE_DELAY_MS || 500),
};
