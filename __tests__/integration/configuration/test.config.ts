/*
 * This file contains the configurations specific for the integration tests on the Wallet Headless.
 * Those values are also editable via environment variables.
 *
 * Timing values are calibrated for DevMiner with --block-interval=1000.
 * Values were set based on measured p90 data from full integration suite runs.
 */

export const testConfig = {
  // On CI, should match .github/workflows/integration-test.yml -> upload-artifact
  logOutputFolder: process.env.TEST_LOG_OUTPUT_FOLDER || 'tmp/',

  // Console level used on winston
  consoleLevel: process.env.TEST_CONSOLE_LEVEL || 'silly',

  // === DevMiner Timing Configuration ===

  // Block interval from docker --block-interval flag (ms)
  blockIntervalMs: Number(process.env.TEST_BLOCK_INTERVAL_MS) || 1000,

  // waitForTxReceived: poll interval and timeout (ms)
  // Measured p50=100ms with 100ms poll — the p50 reflects the poll interval itself.
  // Most txs arrive near-instantly; 50ms poll balances fast detection vs CPU overhead.
  txReceivedPollIntervalMs: Number(process.env.TEST_TX_RECEIVED_POLL_MS) || 50,
  txReceivedTimeoutMs: Number(process.env.TEST_TX_RECEIVED_TIMEOUT_MS) || 5000,

  // waitNextBlock: poll interval and timeout (ms)
  // Blocks arrive every 1000ms; 200ms poll catches them quickly
  nextBlockPollIntervalMs: Number(process.env.TEST_NEXT_BLOCK_POLL_MS) || 200,
  nextBlockTimeoutMs: Number(process.env.TEST_NEXT_BLOCK_TIMEOUT_MS) || 5000,

  // waitTxConfirmed: poll interval and default timeout (ms)
  // Measured p50=1015ms (dominated by block interval)
  txConfirmedPollIntervalMs: Number(process.env.TEST_TX_CONFIRMED_POLL_MS) || 200,
  txConfirmedTimeoutMs: Number(process.env.TEST_TX_CONFIRMED_TIMEOUT_MS) || 5000,

  // waitForWalletReady: timeout (ms)
  // Measured p50=9ms, max=27272ms; 60s provides headroom for CI variance
  walletReadyTimeoutMs: Number(process.env.TEST_WALLET_READY_TIMEOUT_MS) || 60000,

  // Connection timeout (ms)
  connectionTimeoutMs: Number(process.env.TEST_CONNECTION_TIMEOUT_MS) || 15000,

  // Genesis wallet post-creation delay (ms)
  genesisPostCreationDelayMs: Number(process.env.TEST_GENESIS_DELAY_MS) || 200,

  // Service-facade polling: pollForTx
  // Measured p50=130ms; already fast with 100ms poll
  pollForTxIntervalMs: Number(process.env.TEST_POLL_TX_INTERVAL_MS) || 100,
  pollForTxMaxAttempts: Number(process.env.TEST_POLL_TX_MAX_ATTEMPTS) || 50,

  // Service-facade polling: pollForNcState
  pollForNcStateIntervalMs: Number(process.env.TEST_POLL_NC_INTERVAL_MS) || 500,
  pollForNcStateMaxAttempts: Number(process.env.TEST_POLL_NC_MAX_ATTEMPTS) || 10,

  // Service-facade polling: pollForTokenDetails
  pollForTokenDetailsIntervalMs: Number(process.env.TEST_POLL_TOKEN_INTERVAL_MS) || 1000,
  pollForTokenDetailsMaxAttempts: Number(process.env.TEST_POLL_TOKEN_MAX_ATTEMPTS) || 30,

  // Serverless readiness polling
  pollServerlessIntervalMs: Number(process.env.TEST_POLL_SERVERLESS_INTERVAL_MS) || 2000,
  pollServerlessTimeoutMs: Number(process.env.TEST_POLL_SERVERLESS_TIMEOUT_MS) || 30000,
};
