/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable global-require */
import { loggers, LoggerUtil } from './__tests__/integration/utils/logger.util';
import config from './src/config';
import { TX_MINING_URL } from './__tests__/integration/configuration/test-constants';
import {
  precalculationHelpers, WalletPrecalculationHelper
} from './__tests__/integration/helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from './__tests__/integration/helpers/genesis-wallet.helper';
import { waitNextBlock } from './__tests__/integration/helpers/wallet.helper';

config.setTxMiningUrl(TX_MINING_URL);

// This function will run before each test file is executed
beforeAll(async () => {
  // Initializing the Transaction Logger with the test name obtained by our jest-circus Custom Env
  const { testName } = global;
  const testLogger = new LoggerUtil(testName);
  testLogger.init({ filePrettyPrint: true });
  loggers.test = testLogger;

  // Loading pre-calculated wallets
  precalculationHelpers.test = new WalletPrecalculationHelper('./tmp/wallets.json');
  await precalculationHelpers.test.initWithWalletsFile();

  // Await first block to be mined to release genesis reward lock
  const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
  try {
    await waitNextBlock(gWallet.storage);
  } catch (err) {
    // When running jest with jasmine there's a bug (or behavior)
    // that any error thrown inside beforeAll methods don't stop the tests
    // https://github.com/jestjs/jest/issues/2713
    // The solution for that is to capture the error and call process.exit
    // https://github.com/jestjs/jest/issues/2713#issuecomment-319822476
    // The downside of that is that we don't get logs, however is the only
    // way for now. We should stop using jasmine soon (and change for jest-circus)
    // when we do some package upgrades
    process.exit(1);
  }
});

afterAll(async () => {
  // Storing data about used precalculated wallets for the next test suites
  await precalculationHelpers.test.storeDbIntoWalletsFile();
});

expect.extend({
  toMatchBuffer(received, expected) {
    let pass;
    if ((received instanceof Buffer === false) || (expected instanceof Buffer === false)) {
      pass = false;
    } else {
      pass = expected.equals(received);
    }
    if (pass) {
      return {
        message: () => `expected Buffer(${received && received.toString('hex')}) to not match Buffer(${expected.toString('hex')})`,
        pass: true,
      }
    } else {
      return {
        message: () => `expected Buffer(${received && received.toString('hex')}) to match Buffer(${expected.toString('hex')})`,
        pass: false,
      }
    }
  }
});
