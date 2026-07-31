/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Jest globalSetup for the integration suite — blocks until the
 * integration-test-helper reports ready.
 *
 * `npm run test_network_up` is `docker compose up -d`, which returns as soon as
 * containers *start*. Nothing declares `depends_on: wallet-provider`, so the
 * helper's own healthcheck gates nothing outside compose's internal ordering
 * and jest can otherwise begin while the helper is still answering 503. Gating
 * here also covers the case where the helper was started outside compose.
 *
 * Runs once for the whole suite, before any test file is loaded.
 */
import { ithService } from '../helpers/ith-service';

/**
 * Fail fast, and accurately, if anything in this file's import graph pulled in
 * bitcore-lib.
 *
 * Jest builds every test environment *after* globalSetup returns, copying own
 * properties off the real global into each new context. bitcore-lib refuses to
 * evaluate a second time against a global already carrying its marker, and each
 * test file gets a fresh module registry — so it evaluates again and throws.
 * The registry resets per file; `global._bitcore` does not.
 *
 * The rule this enforces: **this file must not transitively import `src/`,
 * `bitcore-lib` or `bitcore-mnemonic`.** `src/models/network.ts` imports
 * bitcore-lib legitimately, so any import from `src/` is enough to trip it.
 * That is why `delay` comes from `utils/time.util` and not `utils/core.util`,
 * which reaches bitcore through its key-derivation helpers.
 *
 * Without this check the symptom is every suite failing before a single test
 * runs, carrying bitcore's own message blaming duplicate installs — which sends
 * you hunting for a second copy in node_modules that does not exist.
 */
function assertGlobalSetupStayedLight(): void {
  if ((global as unknown as Record<string, unknown>)._bitcore) {
    throw new Error(
      'Integration globalSetup loaded bitcore-lib. Something in its import graph ' +
        'reaches src/ or bitcore-*, which makes every test suite fail before it ' +
        'starts, with a misleading "more than one instance of bitcore-lib" error. ' +
        'Keep this file dependency-light — see __tests__/integration/utils/time.util.ts.'
    );
  }
}

export default async function globalSetup(): Promise<void> {
  assertGlobalSetupStayedLight();

  const startedAt = Date.now();
  const status = await ithService.waitUntilReady();
  const waitedMs = Date.now() - startedAt;

  // globalSetup runs before the winston test loggers exist, so this is console
  // by necessity. Kept to one line, and only on success — the failure path
  // throws with its own detail and aborts the run.
  // eslint-disable-next-line no-console
  console.log(
    `[itest] integration-test-helper ready after ${waitedMs}ms ` +
      `(testUtxos: ${status.testUtxos ?? 'n/a'})`
  );
}
