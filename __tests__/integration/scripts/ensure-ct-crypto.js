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
 * clean) and cached after the first run; any other installed version is
 * replaced by the pinned one.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG = '@hathor/ct-crypto-node';
// Exact pin — must match the published prebuild the suite is validated against.
const VERSION = '0.5.0';
const SPEC = `${PKG}@${VERSION}`;

/**
 * The installed version of the package, or null when it isn't installed. Read
 * from the package.json next to its entry point, because the package's
 * `exports` map doesn't expose `./package.json`.
 */
function installedVersion() {
  let entry;
  try {
    entry = require.resolve(PKG);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8')
  );
  return manifest.name === PKG ? manifest.version : null;
}

const installed = installedVersion();
if (installed === VERSION) {
  // eslint-disable-next-line no-console
  console.log(`[ensure-ct-crypto] ${SPEC} already present — skipping install.`);
} else {
  // eslint-disable-next-line no-console
  console.log(
    installed
      ? `[ensure-ct-crypto] found ${PKG}@${installed}, but the suite is pinned to ${VERSION} — reinstalling (integration-only, --no-save)…`
      : `[ensure-ct-crypto] ${SPEC} not found — installing on demand (integration-only, --no-save)…`
  );
  execFileSync('npm', ['install', '--no-save', SPEC], { stdio: 'inherit' });
  // eslint-disable-next-line no-console
  console.log(`[ensure-ct-crypto] installed ${SPEC}.`);
}
