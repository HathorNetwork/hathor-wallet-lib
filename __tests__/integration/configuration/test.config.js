/*
 * This file contains the configurations specific for the integration tests on the Wallet Headless.
 * Those values are also editable via envrionment variables
 */

module.exports = {
  // On CI, should match .github/workflows/integration-test.yml -> upload-artifact
  logOutputFolder: process.env.TEST_LOG_OUTPUT_FOLDER || 'tmp/',

  // Console level used on winston
  consoleLevel: process.env.TEST_CONSOLE_LEVEL || 'silly',

  // Defines how long tests should wait before consulting balances after transactions
  wsUpdateDelay: process.env.TEST_WS_UPDATE_DELAY || 1000,

  // Defines for how long the startMultipleWalletsForTest can run
  walletStartTimeout: process.env.TEST_WALLET_START_TIMEOUT || 300000,
};
