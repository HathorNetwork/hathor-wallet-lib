# Hathor Wallet Library

Library used by [Hathor Wallet](https://github.com/HathorNetwork/hathor-wallet). More information at Hathor Network [website](https://hathor.network/).

## Install

`npm install @hathor/wallet-lib`

## Setting storage

This lib requires a storage to be set so it can persist data. Take a look at `src/storage.js` for the methods this storage object should implement.
```
const hathorLib = require('@hathor/wallet-lib');
hathorLib.storage.setStore(storageFactory);
```

## Release Process (Claude Code)

This project includes a Claude Code skill for managing releases. Available commands:

### Initiate Release

```
/hathor-release init <version>
```

Creates a PR from `master` to `release` branch with the proper template, assigns reviewers (code owner + recent contributor), adds the `enhancement` label, and adds the PR to the Hathor Network project.

### Bump Version

```
/hathor-release bump <type>
```

Where `<type>` is `minor`, `patch`, or `major`. Checks out the `release` branch, runs `npm version <type> --no-git-tag-version`, and creates a PR with the version bump.

## Single-key wallets (Web3Auth)

`HathorWallet` supports wallets keyed by a single raw secp256k1 private key
(no BIP32 hierarchy), intended for social-login onboarding via Web3Auth.

```ts
import { HathorWallet, SCANNING_POLICY } from '@hathor/wallet-lib';

const wallet = new HathorWallet({
  connection,
  privateKey: '<32-byte hex>',
  publicKey: '<33-byte compressed hex>',
  preCalculatedAddresses: ['<base58 address>'],
  pinCode: '<pin>',
  scanPolicy: { policy: SCANNING_POLICY.SINGLE_ADDRESS },
});

await wallet.start({ pinCode: '<pin>' });
```

By default, transactions are signed locally with the raw private key held in
storage. For Web3Auth flows where the key lives inside a trusted environment
and cannot be exposed to wallet-lib, register an external signer:

```ts
wallet.setExternalTxSigningMethod(async (tx, storage, pinCode) => {
  // delegate to the Web3Auth SDK; storage.getSingleKeyPrivateKey is not
  // available because the key never reaches wallet-lib's storage.
});
```

Constraints (wallets without derivation capability — raw single-key only):
- Exactly one address (index 0).
- `setGapLimit`, `enableMultiAddressMode`, `indexLimitLoadMore`,
  `indexLimitSetEndIndex`, `getNextAddress`, and `getAddressAtIndex(N>0)` all
  throw because they require an xpub/xpriv to derive higher indexes.
- `HathorWalletServiceWallet` (wallet-service mode) does not support
  single-key wallets in Phase 1 — use `HathorWallet` directly.

HD wallets (seed/xpriv/xpub) running under `SCANNING_POLICY.SINGLE_ADDRESS`
are NOT affected by the constraints above — they still hold an xpub and
retain full derivation capability, which is required by
`hasTxOutsideFirstAddress` and other safety checks.

See `internal-rfcs/projects/wallet-mobile/0003-web3auth-single-key-wallet.md`
for the design and `__tests__/new/singleKeyWallet.test.ts` for usage examples.
