/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as path from 'path';

// eslint-disable-next-line import/no-extraneous-dependencies
const NodeEnvironment = require('jest-environment-node').TestEnvironment;

/**
 * Extracts the test name from an absolute path received by the context
 * @param {string} filePath Absolute path
 * @returns {string} Test filename without directories, test suffixes or extensions
 * @example
 * const name = getTestName('/home/user/code/address-info.test.js')
 * assert(name == 'address-info')
 */
function getTestName(filePath) {
  const baseName = path.basename(filePath);
  const extName = path.extname(filePath);

  return baseName.replace(`.test${extName}`, '');
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
  }

  /*
   * For debugging purposes, some helper methods can be added to this class, such as:
   * - getVmContext()
   * - teardown()
   * - runScript(script)
   * - handleTestEvent(event)
   *
   * @see https://jestjs.io/docs/configuration#testenvironment-string
   */
}
