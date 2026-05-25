# Integration test setup

Integration tests for wallet-lib run against a Docker-based Hathor network
(see `configuration/docker-compose.yml`). The shielded-output suite additionally
requires the native crypto provider, which is **not** declared as a dependency
of wallet-lib.

## One-time setup

### 1. Build the ct-crypto-node native artifact

Clone `hathor-ct-crypto-node` as a sibling of `hathor-wallet-lib`:

```bash
cd ..
git clone git@github.com:HathorNetwork/hathor-ct-crypto-node.git hathor-ct-crypto
cd hathor-ct-crypto
npm run build              # builds the NAPI addon
```

Assemble the npm-publishable artifact at `hathor-ct-crypto/npm-package/`. CI
normally produces this from prebuilt platform binaries; for local dev you can
either fetch the latest prebuild artifact from the repo's GitHub Actions or
build for your platform and copy the result yourself:

```bash
mkdir -p npm-package/prebuilds/$(node -p '`${process.platform}-${process.arch}`')
cp target/release/libct_crypto.dylib \
   npm-package/prebuilds/$(node -p '`${process.platform}-${process.arch}`')/ct-crypto.node
cp index.js index.d.ts provider.js package.json npm-package/
```

(Substitute `.dylib` with `.so` on Linux, `.dll` on Windows.)

### 2. Install the artifact into wallet-lib

```bash
cd ../hathor-wallet-lib
npm install ../hathor-ct-crypto/npm-package --no-save
```

`--no-save` keeps `package.json` clean. The package is wired up under
`node_modules/@hathor/ct-crypto-node/` and resolves the import in
`__tests__/integration/helpers/wallet.helper.ts`.

## Running the suite

```bash
npm run test_network_up           # start the Docker network
npm run test_network_integration  # run all integration tests
npm run test_network_down         # tear down the Docker network
```

A specific test file:

```bash
SPECIFIC_INTEGRATION_TEST_FILE=shielded_outputs/core.test.ts \
  npm run test_network_integration
```

## Why is ct-crypto-node not a declared dependency?

`@hathor/ct-crypto-node` is not yet published to npm — it's still under active
development. Declaring it in `package.json` with a `file:` link or `git+` URL
would either fragility-bind wallet-lib to a specific local layout (`file:`) or
fetch the source tree without the prebuilt NAPI binary (`git+`), breaking
runtime. Manual install gives consumers full control over which version /
prebuild they pin to without locking wallet-lib into a particular workflow.

Once ct-crypto-node ships to npm (or a private registry), this section will
collapse into a normal `npm install`.
