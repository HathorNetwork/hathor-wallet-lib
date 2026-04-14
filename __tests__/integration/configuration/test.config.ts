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
};
