# Hathor Wallet Lib

This library can be used to easily create a new Hathor Wallet. It handles all communication with the server and exposes an easy-to-use API. It is used by Hathor Wallet for iOS, Android, Linux, macOS, and Windows. It is also used by a headless Hathor Wallet.

## How to install?

`npm install @hathor/wallet-lib`

## How to use?

The wallet requires a backend server with both an HTTP API and a WebSocket Server. Usually, Hathor's full-node implement both services and is used as a backend server.

The connection has four possible states:

- `CLOSED`: When it is not connected to the server, and it is not trying to connect.
- `CONNECTING`: When it is still trying to connect to the server.
- `SYNCING`: When it has already connected but it is still downloading the transaction history.
- `READY`: When the wallet is fully synced and ready to be used.

The wallet automatically reconnects when the connection is down.

### Initializing your wallet

To initialize your wallet, you will need to know your seed. A seed is a string of 24 word, e.g., `'range wonder roof trumpet soon urge unaware satisfy confirm kidney critic rookie wild used merry teach smooth puzzle salute desk pepper jeans creek valve'`.

### Example

```js
const seed = 'range wonder roof trumpet soon urge unaware satisfy confirm kidney critic rookie wild used merry teach smooth puzzle salute desk pepper jeans creek valve';

const wallet = new Wallet({
  network: 'mainnet',
  server: 'https://node1.mainnet.hathor.network/v1a/',
  seed: seed,
  tokenUid: '0000035f21f454686b3a01b59ae1345011501d0fcd8973d25d3d6ebe6f1c00bb',
});

wallet.on('state', (state) => {
  if (wallet.isReady()) {
    console.log('Wallet is READY!');
    console.log(`Address: ${wallet.getCurrentAddress()}`);
    console.log(`Balance: ${wallet.getBalance()}`);
  } else {
    console.log(`Wallet is ${Wallet.getHumanState(state)}`);
  }
});

wallet.start(); // This will start the wallet and load its data from the server
```

## Wallet Object

### Constructor

`Wallet({ network, server, seed, tokenUid }`

*Parameters:*

- `network`: Network you want the wallet connected to. E.g., 'testnet' or 'mainnet'.
- `server`: Server you want to connect to. E.g., 'https://node1.mainnet.hathor.network/v1a/'.
- `seed`: 24 words of this wallet in a string separated by space.
- `tokenUid`: Optional parameter if you want this wallet to work with an specific token only. E.g., '0000035f21f454686b3a01b59ae1345011501d0fcd8973d25d3d6ebe6f1c00bb'.

### Constants

| Constant            | Value |
|---------------------|-------|
| `Wallet.CLOSED`     |     0 |
| `Wallet.CONNECTING` |     1 |
| `Wallet.SYNCING`    |     2 |
| `Wallet.READY`      |     3 |

### Properties

- `network`: The network it is connected to. E.g., `'mainnet'` or `'testnet'`.
- `server`: The backend server it is connected to.
- `state`: The current state of the connection.
- `serverInfo`: An object with the information received by the server.
- `tokenUid`: The default token used by this wallet.

### Methods

- `getCurrentAddress({ markAsUsed })`: Get wallet's current address. You can either mark as used or not. If you don't, it will return the same address until at least one transaction arrives to that address. If you mark as used, it will return a new address in the next call.

- `getBalance(tokenUid)`: It returns an object `{ available, locked }`. The values are integers in cents, i.e., 123 means 1.23 HTR. If `tokenUid` is given, it returns the balance for the token. Otherwise, it returns the balance for HTR.

- `getTxHistory()`

- `sendMultiTokenTransaction(data)`

- `sendTransaction(address, value, token)`: Send a transaction to exactly one output. You must provide both the `address` and the `value`. The `value` parameter must be an integer with the value in cents, i.e., 123 means 1.23 HTR. You can optionally chose the token, e.g., `{uid: '00', name: 'Hathor', symbol: 'HTR'}`.

- `start()`: Connect to the backend server and start emitting events.

- `stop()`: Disconnect from the backend server and stops emitting events.

- `getTxBalance(tx)`

- `getTokenData()`

- `isReady()`: Return if the wallet is ready to be used.


### Events

The wallet emits the following events:

- `state`
  Fired when the state is changed. The event handler receives the new state.

- `new-tx`
  Fired when a new transaction arrives. The event handler receives the transaction.

- `update-tx`
  Fired when a transaction is updated. The event handler receives the updated transaction. A transaction is updated when either an output has been spent or its state has changed.
