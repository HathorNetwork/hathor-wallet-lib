# Integration test setup

Integration tests for wallet-lib run against a Docker-based Hathor network
(see `configuration/docker-compose.yml`). The shielded-output suite additionally
requires the native crypto provider `@hathor/ct-crypto-node`, which is installed
**on demand, only for the integration suite** (it is not a declared dependency —
see below).

## Crypto provider — installed automatically

`@hathor/ct-crypto-node` is a native (NAPI) addon published to npm with platform
prebuilds. You do **not** need to install it manually: the
`pretest_network_integration` hook runs
`__tests__/integration/scripts/ensure-ct-crypto.js` before the suite, which
installs the pinned version (`--no-save`) if it isn't already present. The first
integration run fetches it; later runs reuse the cached copy.

To install it by hand (e.g. to pin a different prebuild):

```bash
npm install --no-save @hathor/ct-crypto-node@0.0.1-shielded
```

The package resolves under `node_modules/@hathor/ct-crypto-node/` and satisfies
the import in `__tests__/integration/helpers/wallet.helper.ts`.

## Running the suite

```bash
npm run test_network_up           # start the Docker network
npm run test_network_integration  # auto-installs the provider, then runs the suite
npm run test_network_down         # tear down the Docker network
```

Or all three in sequence:

```bash
npm run test_integration
```

A specific test file (the value is matched as `**/<value>.test.ts`, so omit the
`.test.ts` suffix):

```bash
SPECIFIC_INTEGRATION_TEST_FILE=shielded_outputs/core \
  npm run test_network_integration

# the whole shielded suite (23 files):
SPECIFIC_INTEGRATION_TEST_FILE='shielded_outputs/*' \
  npm run test_network_integration
```

## Why is ct-crypto-node not a declared dependency?

`@hathor/ct-crypto-node` is a platform-specific native addon needed **only** by
the shielded integration suite. Declaring it as a (dev)dependency would pull the
native binary on every `npm install` — and *break* `npm install` on any platform
without a published prebuild (npm falls back to building from source, which needs
a Rust toolchain) — for contributors who only run unit tests or build the
library. Unit tests never use it; they register a mock provider.

Keeping it out of `package.json` and installing it on demand via the
`pretest_network_integration` hook means a normal `npm install` never touches it,
while the integration suite still gets it transparently. ESLint is told the
module is available via `settings['import/core-modules']` in `.eslintrc.js`, so
the integration helper's import doesn't trip `import/no-unresolved` at lint time.
