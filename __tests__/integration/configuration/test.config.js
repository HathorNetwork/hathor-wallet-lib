/*
 * This file contains the configurations specific for the integration tests on the Wallet Headless.
 * Those values are also editable via envrionment variables
 */

module.exports = {
  // On CI, should match .github/workflows/integration-test.yml -> upload-artifact
  logOutputFolder: process.env.TEST_LOG_OUTPUT_FOLDER || 'tmp/',

  // Console level used on winston
  consoleLevel: process.env.TEST_CONSOLE_LEVEL || 'silly',
};
