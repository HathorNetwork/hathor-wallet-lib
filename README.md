# Hathor Wallet Library

Library used by [Hathor Wallet](https://github.com/HathorNetwork/hathor-wallet). More information at Hathor Network [website](https://hathor.network/).

## Install

`npm install @hathor/wallet-lib`

# Setting storage

The lib requires a storage to be passed to it. Take a look at `src/storage.js` for the methods this storage object should implement.
```
const hathorLib = require('@hathor/wallet-lib');
hathorLib.storage.setStorage(storageFactory);
```
