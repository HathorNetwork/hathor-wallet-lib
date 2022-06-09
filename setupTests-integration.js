/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable global-require */
import { parse } from 'path';
import { loggers, LoggerUtil } from './__tests__/integration/utils/logger.util';
import config from './src/config';
import {
  FULLNODE_URL,
  TX_MINING_URL,
} from './__tests__/integration/configuration/test-constants';
import {
  precalculationHelpers, WalletPrecalculationHelper
} from './__tests__/integration/helpers/wallet-precalculation.helper';

// Creating memory storage to be used in the place of localStorage
class MemoryOnlyStore {
  constructor() {
    this.hathorMemoryStorage = {};
  }

  getItem(key) {
    const ret = this.hathorMemoryStorage[key];
    if (ret === undefined) {
      return null;
    }
    return ret;
  }

  setItem(key, value) {
    this.hathorMemoryStorage[key] = value;
  }

  removeItem(key) {
    delete this.hathorMemoryStorage[key];
  }

  clear() {
    this.hathorMemoryStorage = {};
  }
}

const storage = require('./src/storage').default;

storage.setStore(new MemoryOnlyStore());
storage.setItem('wallet:server', FULLNODE_URL);
config.setTxMiningUrl(TX_MINING_URL);

/**
 * Gets the name of the test being executed from a Jasmine's global variable.
 * @returns {string} Test name
 */
function getTestNameFromGlobalJasmineInstance() {
  // eslint-disable-next-line no-undef
  const { testPath } = jasmine;
  const testFileName = parse(testPath).name;
  return testFileName.indexOf('.') > -1
    ? testFileName.split('.')[0]
    : testFileName;
}

// This function will run before each test file is executed
beforeAll(async () => {
  // Initializing the Transaction Logger with the test name
  const testName = getTestNameFromGlobalJasmineInstance();
  const testLogger = new LoggerUtil(testName);
  testLogger.init({ filePrettyPrint: true });
  loggers.test = testLogger;

  // Loading pre-calculated wallets
  precalculationHelpers.test = new WalletPrecalculationHelper('./tmp/wallets.json');
  await precalculationHelpers.test.initWithWalletsFile();
});

afterAll(async () => {
  // Storing data about used precalculated wallets for the next test suites
  await precalculationHelpers.test.storeDbIntoWalletsFile();
});
