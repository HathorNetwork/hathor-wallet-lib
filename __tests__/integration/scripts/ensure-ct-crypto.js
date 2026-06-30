#!/usr/bin/env node
/**
 * Ensures the native shielded crypto provider (@hathor/ct-crypto-node) is
 * present before the shielded integration suite runs.
 *
 * It is intentionally NOT a declared dependency of wallet-lib: it is a
 * platform-specific native (NAPI) addon needed ONLY by the shielded
 * integration tests. Declaring it would pull a native binary on every
 * `npm install` — and break installs on any platform without a published
 * prebuild — for contributors who only run unit tests or build the library.
 *
 * Wired as the `pretest_network_integration` npm hook, so `npm run
 * test_network_integration` (and `npm run test_integration`) install it on
 * demand. The install is `--no-save` (keeps package.json / package-lock.json
 * clean) and cached after the first run.
 */
const { execFileSync } = require('child_process');

const PKG = '@hathor/ct-crypto-node';
// Exact pin — must match the published prebuild the suite is validated against.
const VERSION = '0.0.1-shielded';
const SPEC = `${PKG}@${VERSION}`;

try {
  require.resolve(PKG);
  // eslint-disable-next-line no-console
  console.log(`[ensure-ct-crypto] ${PKG} already present — skipping install.`);
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  // eslint-disable-next-line no-console
  console.log(
    `[ensure-ct-crypto] ${SPEC} not found — installing on demand (integration-only, --no-save)…`
  );
  execFileSync('npm', ['install', '--no-save', SPEC], { stdio: 'inherit' });
  // eslint-disable-next-line no-console
  console.log(`[ensure-ct-crypto] installed ${SPEC}.`);
}
