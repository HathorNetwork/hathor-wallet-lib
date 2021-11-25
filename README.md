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
