/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable global-require */
import fs from 'fs';
import { loggers, LoggerUtil } from './__tests__/integration/utils/logger.util';
import config from './src/config';
import { TX_MINING_URL, WALLET_CONSTANTS } from './__tests__/integration/configuration/test-constants';
import {
  precalculationHelpers, WalletPrecalculationHelper
} from './__tests__/integration/helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from './__tests__/integration/helpers/genesis-wallet.helper';
import { generateWalletHelper, waitNextBlock, waitTxConfirmed } from './__tests__/integration/helpers/wallet.helper';

config.setTxMiningUrl(TX_MINING_URL);

async function createOCBs() {
  const { seed } = WALLET_CONSTANTS.ocb;
  const ocbWallet = await generateWalletHelper({ seed });
  const address0 = await ocbWallet.getAddressAtIndex(0);
  await GenesisWalletHelper.injectFunds(ocbWallet, address0, 1000n);

  const codeBet = fs.readFileSync('./__tests__/integration/configuration/blueprints/bet.py', 'utf8');
  const txBet = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeBet, address0);
  await waitTxConfirmed(ocbWallet, txBet.hash, null);
  global.BET_BLUEPRINT_ID = txBet.hash;

  const codeAuthority = fs.readFileSync('./__tests__/integration/configuration/blueprints/authority.py', 'utf8');
  const txAuthority = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeAuthority, address0);
  await waitTxConfirmed(ocbWallet, txAuthority.hash, null);
  global.AUTHORITY_BLUEPRINT_ID = txAuthority.hash;

  const codeFull = fs.readFileSync('./__tests__/integration/configuration/blueprints/full_blueprint.py', 'utf8');
  const txFull = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeFull, address0);
  await waitTxConfirmed(ocbWallet, txFull.hash, null);
  global.FULL_BLUEPRINT_ID = txFull.hash;
}

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
    // await waitNextBlock(gWallet.storage);
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

  // await createOCBs();
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
