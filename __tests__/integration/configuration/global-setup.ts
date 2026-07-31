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

export default async function globalSetup(): Promise<void> {
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
