/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable global-require */
import http from 'http';
import https from 'https';
import axios from 'axios';
import fs from 'fs';
import { loggers, LoggerUtil } from './__tests__/integration/utils/logger.util';
import config from './src/config';
import { TX_MINING_URL, WALLET_CONSTANTS } from './__tests__/integration/configuration/test-constants';
import {
  precalculationHelpers, WalletPrecalculationHelper
} from './__tests__/integration/helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from './__tests__/integration/helpers/genesis-wallet.helper';
import { generateWalletHelper, waitNextBlock, waitTxConfirmed, waitUntilNextTimestamp } from './__tests__/integration/helpers/wallet.helper';
import { stopGLLBackgroundTask } from './src/sync/gll';
import Transaction from './src/models/transaction';

config.setTxMiningUrl(TX_MINING_URL);

// Retry flaky tests locally to improve dev ergonomics. Always disabled in CI so flakiness
// surfaces instead of being masked. Override the local count with FLAKY_RETRIES=N (default: 2).
const flakyRetries = process.env.CI ? 0 : Number(process.env.FLAKY_RETRIES ?? 2);
if (flakyRetries > 0) {
  jest.retryTimes(flakyRetries, { logErrorsBeforeRetry: true });
}

// Mock calculateWeight to always return 1 for faster mining in integration tests
Transaction.prototype.calculateWeight = function () {
  return 1;
};


/**
 * Disable HTTP keep-alive for axios to prevent "socket hang up" errors in Jest.
 *
 * The issue: Node.js 19+ enables keep-alive by default. When Jest runs tests sequentially,
 * there are gaps between tests where connections go idle. The serverless-offline server
 * closes idle connections after 5 seconds (Node.js default). When the next test runs,
 * axios tries to reuse the closed connection, causing "socket hang up" errors.
 *
 * This only affects Jest because:
 * 1. Tests have natural pauses between them (setup, teardown, Jest processing)
 * 2. These pauses often exceed the server's 5-second keep-alive timeout
 * 3. Production traffic typically keeps connections active
 */
axios.defaults.httpAgent = new http.Agent({ keepAlive: false });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: false });

async function createOCBs(sharedState) {
  const { seed } = WALLET_CONSTANTS.ocb;
  const ocbWallet = await generateWalletHelper({ seed });
  const address0 = await ocbWallet.getAddressAtIndex(0);
  await GenesisWalletHelper.injectFunds(ocbWallet, address0, 1000n);

  const codeBet = fs.readFileSync('./__tests__/integration/configuration/blueprints/bet.py', 'utf8');
  const txBet = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeBet, address0);
  await waitTxConfirmed(ocbWallet, txBet.hash, null);
  // Advance the wall clock past this blueprint tx before creating the next one.
  // The blueprint txs are created back-to-back and each may select the previous
  // as a DAG parent; a tx may not share its parent's timestamp (1-second
  // granularity), so without this the fullnode intermittently rejects the next
  // tx with "full validation failed: tx.timestamp == parent.timestamp". Waiting
  // for the confirming block is not enough — the dev miner can confirm within the
  // same second.
  await waitUntilNextTimestamp(ocbWallet, txBet.hash);
  sharedState.blueprintIds.BET_BLUEPRINT_ID = txBet.hash;

  const codeAuthority = fs.readFileSync('./__tests__/integration/configuration/blueprints/authority.py', 'utf8');
  const txAuthority = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeAuthority, address0);
  await waitTxConfirmed(ocbWallet, txAuthority.hash, null);
  await waitUntilNextTimestamp(ocbWallet, txAuthority.hash);
  sharedState.blueprintIds.AUTHORITY_BLUEPRINT_ID = txAuthority.hash;

  const codeFull = fs.readFileSync('./__tests__/integration/configuration/blueprints/full_blueprint.py', 'utf8');
  const txFull = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeFull, address0);
  await waitTxConfirmed(ocbWallet, txFull.hash, null);
  await waitUntilNextTimestamp(ocbWallet, txFull.hash);
  sharedState.blueprintIds.FULL_BLUEPRINT_ID = txFull.hash;

  const codeParent = fs.readFileSync(
    './__tests__/integration/configuration/blueprints/test_parent.py',
    'utf8'
  );

  const txParent = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeParent, address0);
  await waitTxConfirmed(ocbWallet, txParent.hash);
  await waitUntilNextTimestamp(ocbWallet, txParent.hash);
  sharedState.blueprintIds.PARENT_BLUEPRINT_ID = txParent.hash;

  const codeChildren = fs.readFileSync(
    './__tests__/integration/configuration/blueprints/test_children.py',
    'utf8'
  );
  const txChildren = await ocbWallet.createAndSendOnChainBlueprintTransaction(
    codeChildren,
    address0
  );
  await waitTxConfirmed(ocbWallet, txChildren.hash);
  await waitUntilNextTimestamp(ocbWallet, txChildren.hash);
  sharedState.blueprintIds.CHILDREN_BLUEPRINT_ID = txChildren.hash;

  const codeFee = fs.readFileSync(
    './__tests__/integration/configuration/blueprints/fee.py',
    'utf8'
  );
  const txFee = await ocbWallet.createAndSendOnChainBlueprintTransaction(codeFee, address0);
  await waitTxConfirmed(ocbWallet, txFee.hash, null);
  await waitUntilNextTimestamp(ocbWallet, txFee.hash);
  sharedState.blueprintIds.FEE_BLUEPRINT_ID = txFee.hash;

  const codeUpgradeV1 = fs.readFileSync(
    './__tests__/integration/configuration/blueprints/upgrade_test_v1.py',
    'utf8'
  );
  const txUpgradeV1 = await ocbWallet.createAndSendOnChainBlueprintTransaction(
    codeUpgradeV1,
    address0
  );
  await waitTxConfirmed(ocbWallet, txUpgradeV1.hash, null);
  await waitUntilNextTimestamp(ocbWallet, txUpgradeV1.hash);
  sharedState.blueprintIds.UPGRADE_TEST_V1_BLUEPRINT_ID = txUpgradeV1.hash;

  const codeUpgradeV2 = fs.readFileSync(
    './__tests__/integration/configuration/blueprints/upgrade_test_v2.py',
    'utf8'
  );
  const txUpgradeV2 = await ocbWallet.createAndSendOnChainBlueprintTransaction(
    codeUpgradeV2,
    address0
  );
  await waitTxConfirmed(ocbWallet, txUpgradeV2.hash, null);
  await waitUntilNextTimestamp(ocbWallet, txUpgradeV2.hash);
  sharedState.blueprintIds.UPGRADE_TEST_V2_BLUEPRINT_ID = txUpgradeV2.hash;
}

// This function will run before each test file is executed
beforeAll(async () => {
  // Per-file setup: Initializing the Transaction Logger with the test name obtained by our jest-circus Custom Env
  const { testName } = global;
  const testLogger = new LoggerUtil(testName);
  testLogger.init({ filePrettyPrint: true });
  loggers.test = testLogger;

  // Per-file setup: the wallet helper fetches wallets from the provider service
  precalculationHelpers.test = new WalletPrecalculationHelper();

  // One-time setup: Run only once across all test files (using shared state from CustomEnvironment)
  const sharedState = global.__SHARED_STATE__;
  if (!sharedState.setupDone) {
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

    await createOCBs(sharedState);

    sharedState.setupDone = true;
  }

  // Copy blueprint IDs from shared state to global for test access
  global.BET_BLUEPRINT_ID = sharedState.blueprintIds.BET_BLUEPRINT_ID;
  global.AUTHORITY_BLUEPRINT_ID = sharedState.blueprintIds.AUTHORITY_BLUEPRINT_ID;
  global.FULL_BLUEPRINT_ID = sharedState.blueprintIds.FULL_BLUEPRINT_ID;
  global.PARENT_BLUEPRINT_ID = sharedState.blueprintIds.PARENT_BLUEPRINT_ID;
  global.CHILDREN_BLUEPRINT_ID = sharedState.blueprintIds.CHILDREN_BLUEPRINT_ID;
  global.FEE_BLUEPRINT_ID = sharedState.blueprintIds.FEE_BLUEPRINT_ID;
  global.UPGRADE_TEST_V1_BLUEPRINT_ID = sharedState.blueprintIds.UPGRADE_TEST_V1_BLUEPRINT_ID;
  global.UPGRADE_TEST_V2_BLUEPRINT_ID = sharedState.blueprintIds.UPGRADE_TEST_V2_BLUEPRINT_ID;
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

// Stop gll interval to avoid background tasks during tests
stopGLLBackgroundTask();
