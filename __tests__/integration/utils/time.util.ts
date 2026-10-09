/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Timing helpers, deliberately dependency-free.
 *
 * Safe to import from jest `globalSetup`, which runs before any test
 * environment exists. `core.util` is not: it imports `bitcore-mnemonic` for its
 * key-derivation helpers, and loading bitcore-lib from `globalSetup` as well as
 * from `setupTests-integration` trips bitcore's "more than one instance" guard,
 * failing every suite before a single test runs.
 *
 * Keep this module free of heavyweight imports for that reason. `core.util`
 * re-exports `delay`, so either import path works from test code.
 */

/**
 * Simple way to wait asynchronously before continuing the function. Does not block the JS thread.
 * @param ms Amount of milliseconds to delay
 */
export async function delay(ms: number): Promise<unknown> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
