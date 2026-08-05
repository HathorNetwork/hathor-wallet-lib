/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as path from 'path';

// eslint-disable-next-line import/no-extraneous-dependencies
const NodeEnvironment = require('jest-environment-node').TestEnvironment;

// Module-level state that persists across all test environments in the same worker
const sharedState = {
  setupDone: false,
  blueprintIds: {}
};

/**
 * Extracts the test name from an absolute path received by the context.
 *
 * The name is built from the path relative to `__tests__/integration`, not the
 * basename alone: several test files share a basename across directories
 * (shared/utxos, fullnode-specific/utxos, ...), and parallel workers starting
 * two of those in the same second would otherwise open one log file from two
 * processes.
 * @param {string} filePath Absolute path
 * @returns {string} Test path without root directories, test suffixes or extensions
 * @example
 * const name = getTestName('/home/user/code/__tests__/integration/shared/utxos.test.ts')
 * assert(name == 'shared_utxos')
 */
function getTestName(filePath) {
  const integrationRoot = `${path.sep}__tests__${path.sep}integration${path.sep}`;
  const rootIndex = filePath.lastIndexOf(integrationRoot);
  const relativePath =
    rootIndex === -1 ? path.basename(filePath) : filePath.slice(rootIndex + integrationRoot.length);
  const extName = path.extname(relativePath);

  return relativePath.replace(`.test${extName}`, '').split(path.sep).join('_');
}

/**
 * This custom environment based on the Node environment is used to obtain the test name that is
 * currently being executed, an important piece of information used on `setupTests-integration.js`.
 * @see https://jestjs.io/docs/configuration#testenvironment-string
 */
export default class CustomEnvironment extends NodeEnvironment {
  /**
   * The testname is obtained from the constructor context
   * @param config
   * @param context
   */
  constructor(config, context) {
    super(config, context);
    this.testName = getTestName(context.testPath);
  }

  /**
   * The local testname is injected on the global environment for this specific test on setup
   * @returns {Promise<void>}
   */
  async setup() {
    await super.setup();
    this.global.testName = this.testName;
    // Expose shared state to test environment (persists across test files in same worker)
    this.global.__SHARED_STATE__ = sharedState;
  }

  /**
   * Sanitizes failure payloads so jest's worker IPC can carry them.
   *
   * jest-runner forwards circus events (test failures included) to the main
   * process as the suite runs. With workerThreads that channel uses the
   * structured clone algorithm, which throws on functions — and a raw
   * AxiosError drags several along inside `config`/`request`. The throw kills
   * the worker mid-suite: jest reports the whole file as "Test suite failed
   * to run (DataCloneError)" and the actual failing test is never shown.
   *
   * Deleting only the own properties that structured clone rejects keeps the
   * error's message, stack and any plain data — everything a reporter shows.
   * Mutation is in place on purpose: circus stores this same object reference
   * and serializes it later.
   */
  handleTestEvent(event) {
    if (event.error && typeof event.error === 'object') {
      for (const key of Object.keys(event.error)) {
        try {
          structuredClone(event.error[key]);
        } catch {
          delete event.error[key];
        }
      }
    }
  }

  /*
   * For debugging purposes, some helper methods can be added to this class, such as:
   * - getVmContext()
   * - teardown()
   * - runScript(script)
   *
   * @see https://jestjs.io/docs/configuration#testenvironment-string
   */
}
