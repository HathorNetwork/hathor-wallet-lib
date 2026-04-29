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

## Contributing

### Pre-commit hooks

The repository uses `husky` + `lint-staged` to run `eslint --fix` and
`prettier --write` on staged JS/TS files before each commit. Setup is
automatic — running `npm install` triggers the `prepare` script which
wires the hooks. To skip the hook for a one-off commit, use
`git commit --no-verify`.

### Bulk reformat history

Import ordering and trailing-comma style were rolled out in a single
mass-reformat commit recorded in `.git-blame-ignore-revs`. To make
local `git blame` skip that commit and surface real authors, run once
per clone:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

GitHub's web blame view honors this file automatically.

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
